import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { config } from '../../../config.js';
import { getDb } from '../../../db/database.js';
import { wavDurationSec } from '../../audioCrop.js';
import { startGenerationLog, logGenerationParams, finishGenerationLog, failGenerationLog } from '../../logger.js';
import { mapOfficialRequest, MODEL_REVISION, OFFICIAL_ID, type OfficialRequest } from './request.js';
import { officialFetch, renderOfficial } from './client.js';
import type { EngineBackend, GenerationArtifact } from '../types.js';

let ready = false;
export const minimaxOfficialBackend: EngineBackend = {
  id: OFFICIAL_ID, displayName: 'MiniMax-Music3 · Official', resourcePool: 'gpu',
  lifecycle: { async start() {}, async stop() {}, status: () => ready ? 'ready' : 'down' },
  async capabilities() {
    try { ready = (await (await officialFetch('/health', { signal: AbortSignal.timeout(2000) })).json() as { ready: boolean }).ready; }
    catch { ready = false; }
    return {
      backend: OFFICIAL_ID, up: ready,
      core: { duration: { max: 300, auto: true }, bpm: false, keyscale: false, negativePrompt: false,
        batch: { max: 1 }, seed: true, captionSource: 'none', captionFormat: 'structured', languageMeans: 'lyrics',
        notice: 'Official MiniMax-Music3 · до 5 минут. Исходные веса без квантования; ОЗУ помогает вместить модель. Генерация медленнее.',
      },
      features: { models: false, lm: false, plugins: false, samplerPlugins: false, adapters: false,
        lmAdapters: false, lmAdapterSelectable: false, postProcess: false, stableStep: false,
        whisper: false, lyricTimestamps: false, forcedAlignment: false, cover: false,
        repaint: false, lego: false, extract: false, streaming: false, training: false,
        midi: false, stems: false, understand: false, conceptSteering: false },
      extensions: [{ key: 'mm3OfficialSteps', type: 'slider', label: 'Flow steps', min: 20, max: 60, step: 1, default: 30,
        hint: 'Official Euler synthesis steps per window. Reference default: 30.' }],
    };
  },
  async models() { return { buckets: {}, defaults: {} }; },
  operations: ['text2music'],
  resolveRequest(submission) {
    const wire = mapOfficialRequest(submission);
    return { operation: 'text2music', common: { caption: wire.caption, lyrics: wire.lyrics, duration: wire.duration,
      ...(typeof wire.seed === 'number' ? { seed: wire.seed } : {}), batchSize: 1 },
      models: { model: 'MiniMaxAI/MiniMax-Music3', revision: MODEL_REVISION },
      options: { ...wire }, policy: { retry: { maxAttempts: 1, reseedOnRetry: false }, timeoutMinutes: 180 } };
  },
  async generate(job, ctx) {
    const task = 'minimax-official-text2music';
    const started = performance.now();
    startGenerationLog(job.id, task);
    let filepath: string | undefined;
    try {
      const wire = { ...ctx.envelope.options[OFFICIAL_ID] } as unknown as OfficialRequest;
      wire.seed ??= Math.floor(Math.random() * 2147483647);
      job.params.seed = wire.seed;
      ctx.attempt.effective.seed = wire.seed;
      ctx.attempt.effective.models = { ...ctx.envelope.models };
      logGenerationParams(job.id, { ...wire, modelRevision: MODEL_REVISION });
      job.status = 'synth_running'; job.stage = 'Loading official MiniMax-Music3...'; job.progress = 1;
      const { audio, detail } = await renderOfficial(wire, ctx.signal, status => {
        job.stage = status.stage || 'MiniMax-Music3';
        if (status.frames !== undefined) job.stage += ` · ${status.frames} / ${status.cap_frames} frames`;
        if (status.cap_frames) job.progress = Math.max(job.progress ?? 1, Math.min(65, 2 + 63 * (status.frames ?? 0) / status.cap_frames));
        if (status.stage === 'Synthesizing audio') job.progress = 70;
        if (status.stage === 'Decoding audio') job.progress = 90;
      });
      if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('MiniMax returned invalid WAV audio');
      ctx.signal.throwIfAborted();
      job.status = 'saving'; job.stage = 'Saving audio...'; job.progress = 95;
      const filename = `${randomUUID()}.wav`;
      filepath = path.join(config.data.audioDir, filename);
      fs.writeFileSync(filepath, audio);
      const duration = wavDurationSec(filepath);
      if (!duration || !Number.isFinite(duration)) throw new Error('Invalid MiniMax audio duration');
      const audioUrl = `/audio/${filename}`;
      const songId = randomUUID();
      const totalMs = Math.round(performance.now() - started);
      const timing = [{ name: 'Official MiniMax-Music3', ms: detail.result!.total_ms }, { name: 'TOTAL', ms: totalMs }];
      const params = { ...job.params, backend: OFFICIAL_ID, seed: wire.seed, randomSeed: false,
        duration: wire.duration, mm3OfficialSteps: wire.steps, batchSize: 1, postProcessingEnabled: false,
        mm3OfficialRequest: wire, mm3OfficialResult: detail.result };
      getDb().prepare(`INSERT INTO songs
        (id, user_id, title, lyrics, style, caption, audio_url, duration, tags, dit_model, generation_params, mastered_audio_url, backend)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        songId, job.userId, job.params.title || wire.caption.slice(0, 60), wire.lyrics,
        wire.caption, wire.caption, audioUrl, duration, '[]', 'MiniMax-Music3 Official', JSON.stringify(params), '', OFFICIAL_ID);
      const artifacts: GenerationArtifact[] = [{ kind: 'audio', trackIndex: 0, url: audioUrl }];
      ctx.hooks.onArtifact(artifacts[0]);
      job.result = { audioUrls: [audioUrl], songIds: [songId], duration, timing, totalMs };
      job.status = 'succeeded'; job.stage = 'Complete!'; job.progress = 100;
      finishGenerationLog(job.id, task);
      return { endReason: 'completed', stages: timing, artifacts, songIds: [songId], result: job.result };
    } catch (error) {
      if (filepath) fs.rmSync(filepath, { force: true });
      const cancelled = ctx.signal.aborted;
      job.status = cancelled ? 'cancelled' : 'failed'; job.stage = cancelled ? 'Cancelled' : 'Failed';
      job.error = error instanceof Error ? error.message : String(error);
      failGenerationLog(job.id, job.error, task);
      return { endReason: cancelled ? 'cancelled' : 'failed', stages: [], artifacts: [], songIds: [], error: job.error };
    }
  },
  // Each render waits for its child to exit before returning, so no idle CUDA residency.
};
