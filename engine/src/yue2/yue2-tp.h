#pragma once
#include <string_view>
#if defined(__linux__)
#include <cerrno>
#include <spawn.h>
#include <sys/wait.h>
extern char ** environ;
#endif

// Sites can check live reservations immediately before allocating a second GPU.
static bool yue2_tp_peer_available() {
    const char * guard = std::getenv("YUE2_TP_DEVICE_GUARD");
    if (!guard) return true;
#if defined(__linux__)
    if (guard[0] != '/') return false;
    pid_t child;
    char * argv[] = {const_cast<char *>(guard), nullptr};
    if (posix_spawn(&child, guard, nullptr, nullptr, argv, environ) != 0) return false;
    int status = 0;
    pid_t result;
    do { result = waitpid(child, &status, 0); } while (result < 0 && errno == EINTR);
    return result == child && WIFEXITED(status) && WEXITSTATUS(status) == 0;
#else
    return false;
#endif
}

static ggml_backend_meta_split_state yue2_tp_layout(const ggml_tensor * t, void *) {
    using namespace std::literals;
    std::string_view name(t->name);
    auto axis = GGML_BACKEND_SPLIT_AXIS_MIRRORED;
    for (auto suffix : {".nar_attn_q.weight"sv, ".nar_attn_k.weight"sv, ".nar_attn_v.weight"sv,
                        ".nar_ffn_gate.weight"sv, ".nar_ffn_up.weight"sv}) {
        if (name.find(suffix) != name.npos) axis = GGML_BACKEND_SPLIT_AXIS_1;
    }
    if (name.find(".nar_attn_output.weight") != name.npos || name.find(".nar_ffn_down.weight") != name.npos) {
        axis = GGML_BACKEND_SPLIT_AXIS_0;
    }
    if (name == "tp_prefix_k" || name == "tp_prefix_v") axis = GGML_BACKEND_SPLIT_AXIS_2;
    ggml_backend_meta_split_state s = {axis, {}, {1}, 1};
    if (axis != GGML_BACKEND_SPLIT_AXIS_MIRRORED) {
        GGML_ASSERT(t->ne[axis] % 2 == 0);
        s.ne[0] = s.ne[1] = t->ne[axis] / 2;
    }
    return s;
}

static bool yue2_tp_copy_cache(ggml_backend_t dest, const Yue2ArKvCache & src, Yue2ArKvCache & dst,
                               int64_t set = 0) {
    if (set < 0 || set >= src.n_sets || (size_t) set >= src.filled.size()) return false;
    const int64_t rows = src.filled[set];
    if (rows <= 0 || rows > src.capacity) return false;
    dst.capacity = rows;
    dst.n_sets = 1;
    dst.filled = {rows};
    dst.ctx = ggml_init({2 * src.k.size() * ggml_tensor_overhead() + 1024, nullptr, true});
    if (!dst.ctx) return false;
    auto tensor = [&](ggml_tensor * from, const char * name) {
        auto * t = ggml_new_tensor_4d(dst.ctx, from->type, from->ne[0], rows, from->ne[2], 1);
        ggml_set_name(t, name);
        return t;
    };
    for (size_t l = 0; l < src.k.size(); ++l) {
        dst.k.push_back(tensor(src.k[l], "tp_prefix_k"));
        dst.v.push_back(tensor(src.v[l], "tp_prefix_v"));
    }
    dst.buf = ggml_backend_alloc_ctx_tensors(dst.ctx, dest);
    if (!dst.buf) return false;
    std::vector<uint8_t> staging;
    auto upload = [&](ggml_tensor * from, ggml_tensor * to) {
        const size_t head_bytes = rows * from->nb[1], offset = set * from->nb[3];
        staging.resize(ggml_nbytes(to));
        if (head_bytes == from->nb[2]) {
            ggml_backend_tensor_get(from, staging.data(), offset, staging.size());
        } else {
            // Heads in the source are padded to the longest prefix in the batch.
            for (int64_t h = 0; h < from->ne[2]; ++h) {
                ggml_backend_tensor_get(from, staging.data() + h * head_bytes, offset + h * from->nb[2], head_bytes);
            }
        }
        ggml_backend_tensor_set(to, staging.data(), 0, staging.size());
    };
    for (size_t l = 0; l < src.k.size(); ++l) {
        upload(src.k[l], dst.k[l]);
        upload(src.v[l], dst.v[l]);
    }
    return true;
}

// Called after the composer has sealed the cache. All scratch and split weights
// belong to this request; the caller retains the original cache for fallback.
static bool yue2_try_tp_nar(Yue2Model & primary, const Yue2Request & req, Yue2ArHandoff & ho,
                            const Yue2ProgressFn & progress, std::atomic<bool> * cancel,
                            std::vector<std::vector<std::vector<float>>> & latents, std::string & error) {
    const char * enabled = std::getenv("YUE2_NAR_TENSOR_PARALLEL");
    if (!enabled || std::strcmp(enabled, "1") != 0) return false;
    // These are the graph shapes and numerical path validated on the V100s.
    const size_t songs = ho.songs.size();
    if (songs == 0 || songs > 2 || ho.M != 1 || ho.plan.size() != songs ||
            ho.nar_cache.n_sets != (int64_t) songs || ho.nar_cache.filled.size() != songs ||
            primary.lm_file.name != "yue2-lm-bf16.gguf" ||
            primary.lm_cfg.head_count != 16 || primary.lm_cfg.head_count_kv != 8 ||
            primary.lm_cfg.feed_forward_length % 2 != 0 ||
            yue2_lm_use_flash(primary.backend) || g_yue2_imatrix.armed ||
            !req.nar_solver.empty() || !req.nar_scheduler.empty() ||
            !primary.lm_adapter_want.empty()) {
        error = "request uses a model, solver, adapter or batch outside the tensor-parallel path";
        return false;
    }
    // Very low step counts amplify small changes in reduction order in PCM.
    if (req.ode_steps > 0 && req.ode_steps <= 2 && req.plugin_params.count("yue2:plan_cfg")) {
        error = "low-step Plan CFG uses the reference solver on one GPU";
        return false;
    }
    if (primary.companion_enabled) {
        for (const auto & dir : primary.search_dirs) {
            HS_STAT_T st;
            if (hs_stat((dir + YUE2_SEP + YUE2_COMPANION_FILE).c_str(), &st) == 0) {
                error = "installed companion uses the primary decoder";
                return false;
            }
        }
    }
    for (const auto & kv : req.plugin_params) {
        if (kv.first.compare(0, 13, "yue2:plan_cfg") != 0) {
            error = "plugin uses the primary NAR path: " + kv.first;
            return false;
        }
    }
    // Select the F32 peer-copy + add reduction; large NCCL reductions in this
    // pinned ggml otherwise compress to BF16. Never change process-global knobs here.
    const char * reduce = std::getenv("GGML_CUDA_ALLREDUCE");
    ggml_backend_dev_t devs[] = {ggml_backend_dev_by_name("CUDA0"), ggml_backend_dev_by_name("CUDA1")};
    const char * bf16_threshold = std::getenv("GGML_CUDA_AR_BF16_THRESHOLD");
    const bool fp32_reduce = reduce && (std::strcmp(reduce, "none") == 0 ||
        (std::strcmp(reduce, "internal") == 0 && bf16_threshold && std::strcmp(bf16_threshold, "0") == 0));
    if (!fp32_reduce || !devs[0] || !devs[1] ||
            ggml_backend_dev_by_name("CUDA2") || ggml_backend_get_device(primary.backend) != devs[0]) {
        error = "requires two visible CUDA devices and an FP32 reduction";
        return false;
    }
    if (!yue2_tp_peer_available()) {
        error = "secondary GPU unavailable";
        return false;
    }
    using MemoryPolicy = bool (*)(bool);
    auto memory_policy = reinterpret_cast<MemoryPolicy>(ggml_backend_reg_get_proc_address(
        ggml_backend_dev_backend_reg(devs[0]), "ggml_cuda_set_device_memory_only"));
    if (!memory_policy) {
        error = "CUDA backend lacks scoped device-memory allocation";
        return false;
    }
    struct DeviceMemory {
        MemoryPolicy set;
        bool previous;
        ~DeviceMemory() { set(previous); }
    } scope{memory_policy, memory_policy(true)};
    // Upper bounds exercised on these 16 GiB cards. Larger requests retain
    // the spill-capable serial path until their scratch footprint is known.
    const char * tile = std::getenv("BOBIK_YUE2_ATTN_QUERY_TILE");
    unsigned seen_songs = 0, seen_sets = 0;
    for (const auto & cp : ho.plan) {
        const int64_t frames = cp.b - cp.a;
        if (cp.song < 0 || (size_t) cp.song >= songs || cp.set < 0 || (size_t) cp.set >= songs ||
                (seen_songs & (1u << cp.song)) || (seen_sets & (1u << cp.set)) ||
                frames <= 0 || frames > 7397 || ho.nar_cache.filled[cp.set] > 11412 ||
                (frames > 1022 && (!tile || strcmp(tile, "1024")))) {
            error = "shape outside the validated V100 scratch budget";
            return false;
        }
        seen_songs |= 1u << cp.song;
        seen_sets |= 1u << cp.set;
    }
    struct Resources {
        Yue2Model nar;
        Yue2ArKvCache cache;
        ~Resources() {
            yue2_ar_kv_cache_free(&cache);
            yue2_unload(&nar);
        }
    } ctx;
    // Reuse the exact discovered file/config without rediscovery or a model switch.
    ctx.nar.lm_file = primary.lm_file;
    ctx.nar.lm_cfg = primary.lm_cfg;
    ctx.nar.lm_type_want = primary.lm_type_want;
    auto meta = ggml_backend_meta_device(devs, 2, yue2_tp_layout, nullptr);
    ctx.nar.nar_tp = ggml_backend_dev_init(meta, nullptr);
    if (!ctx.nar.nar_tp) {
        error = "could not initialize the split backend";
        return false;
    }
    if (!yue2_load_parts(&ctx.nar, false, true, false, req.vae_variant, false, &error)) return false;
    fprintf(stderr, "[YuE2-TP] rendering %s on CUDA0 + CUDA1\n", songs == 1 ? "one song" : "two songs");
    auto prepare_prefix = [&](const Yue2ChunkPlan & cp) -> Yue2ArKvCache * {
        yue2_ar_kv_cache_free(&ctx.cache);
        if (!yue2_tp_copy_cache(ctx.nar.nar_tp, ho.nar_cache, ctx.cache, cp.set)) return nullptr;
        fprintf(stderr, "[YuE2-TP] song=%d set=%lld frames=%lld prefix=%lld\n", cp.song,
                (long long) cp.set, (long long) (cp.b - cp.a), (long long) ctx.cache.capacity);
        return &ctx.cache;
    };
    std::vector<std::vector<std::vector<float>>> candidate;
    if (!yue2_run_nar_stage(ctx.nar, req, ho.songs, ho.nar_cache, ho.plan, 1, cancel, progress,
                             &candidate, &error, prepare_prefix)) return false;
    latents.swap(candidate);
    return true;
}
