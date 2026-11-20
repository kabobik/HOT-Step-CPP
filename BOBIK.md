# Bobik maintained fork

Upstream baseline: scragnog/HOT-Step-CPP v1.5.2,
`cdef1b0d67afa96b4b202ce69d0aed793af2be2e`. Production development uses
`bobik/main`. `master` remains the upstream line; merge upstream deliberately,
review conflicts, build and test before updating the deployed revision.

Changes live in TypeScript, React and C++ source. Do not patch `ui/dist` or
compiled server chunks. Preserve upstream MIT notices. The ggml submodule points
to kabobik/HOT-ggml and pins its opt-in CUDA unified-memory pool change.

## Build and check

Use Node 22.16.0 for the web build, Python 3 and g++ for the boundary test:

```sh
git submodule update --init engine/ggml
npm ci --prefix server
npm ci --prefix ui
npm ci --prefix release
bash tools/bobik/check.sh
```

The checks use temporary fixtures and a fake activity lease, without a GPU or
the production library. The native CUDA build, packaging, host integration and
deployment belong to TeslaBobik's `integrations/hot-step/`. That repository pins
this fork as a submodule and records release checksums and rollback instructions.

## Preserved behavior

- YuE2: optional RAM allocation, 1024-query attention tiling, 600-second NAR
  ceiling, composer cap 15000 frames; current host batch is two songs and one
  variation. The earlier 600-second capacity validation used one song.
- UI: restore saved model/adapter, sampler, seed, score and postprocessing on
  Edit; reset stale score when AI changes lyrics; retain the current batch
  persistence migration.
- Playback: fall back from an unreadable mastered variant to the same original;
  report failures without skipping playlist tracks.
- Downloads: preserve Unicode titles and safely encode attachment headers.
- Portal: `/manage/music/`, media URL round-trip, no root service worker, and
  the existing host activity lease around GPU work.
- Preserve inactive MiniMax single-take safeguards and native RS-x3 support.
  The RS-x3 weights and model selection remain external runtime state.

`BOBIK_ACTIVITY_LEASE_SCRIPT` can specify the host lease helper; its default is
`/opt/teslabobik-hot-step/activity_lease.py`. A missing helper fails GPU work
closed. Tests select the fixture explicitly. Linux packages use updater protocol
0: install reviewed Bobik releases through TeslaBobik, not upstream installers.

The imported upstream adapter-home test exposed Windows path parsing on Linux;
normalizing separators makes imported adapter metadata platform-independent.
