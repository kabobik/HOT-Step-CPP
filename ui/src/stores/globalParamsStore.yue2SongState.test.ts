import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { yue2SongStateForLyrics } from '../../../server/src/contracts/yue2SongState';
register('data:text/javascript,' + encodeURIComponent(
  'export async function load(url, ctx, next) { if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }; return next(url, ctx); }'));
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
} });
const { useGlobalParamsStore, setBackendParamFor, clearYue2SongState } = await import('./globalParamsStore');
const { useBackendStore } = await import('./backendStore');
const { generateApi } = await import('../services/api');
const { queryClient } = await import('../queries/client');

test('Edit score is excluded from fresh requests but survives explicit same-song replay', async () => {
  useBackendStore.setState({ activeBackendId: 'yue2' });
  useGlobalParamsStore.setState({ backendParams: {} });
  const set = (key: string, value: unknown) => setBackendParamFor('yue2', key, value);
  set('yue2Abc', 'X:1\nK:C\nC4|');
  set('yue2NoiseSeed', 7);
  set('yue2ScoreLyrics', '[Verse]\nOld words');
  set('yue2OdeSteps', 64);
  set('yue2LyricSchedule', 'bias');
  set('yue2Cover', { sourceId: 'old-song' });
  const gp = () => useGlobalParamsStore.getState();
  const original = gp().backendParams;
  const fresh = gp().getGlobalParams() as Record<string, unknown>;
  for (const key of ['yue2Abc', 'yue2NoiseSeed', 'yue2ScoreOrigin', 'yue2ScoreLyrics', 'yue2Cover']) {
    assert.equal(key in fresh, false, key);
  }
  assert.equal(fresh.yue2OdeSteps, 64);
  assert.equal(fresh.yue2LyricSchedule, 'bias');
  assert.equal(gp().backendParams, original, 'another page must not destroy Create replay');
  const replay = yue2SongStateForLyrics(original, '[Verse]\nOld words');
  assert.equal(replay.yue2Abc, original.yue2Abc);
  assert.equal(replay.yue2NoiseSeed, 7);
  assert.equal('yue2ScoreLyrics' in replay, false);
  assert.deepEqual(yue2SongStateForLyrics(original, '[Verse]\nNew words'), {});
  assert.deepEqual(yue2SongStateForLyrics(original, '[Instrumental]'), {});
  assert.deepEqual(yue2SongStateForLyrics({ yue2Abc: 'legacy stale score' }, 'New words'), {});
  const previousFetch = globalThis.fetch;
  const submitted: any[] = [];
  globalThis.fetch = async (_url, init) => {
    submitted.push(JSON.parse(String(init?.body)));
    return Response.json({ jobId: 'score-check', status: 'pending' });
  };
  try {
    await generateApi.submit({ ...fresh, caption: 'rock', lyrics: 'New words' } as never);
    await generateApi.submit({ ...fresh, ...replay, lyrics: '[Verse]\nOld words' } as never);
    assert.equal('yue2Abc' in submitted[0], false);
    assert.equal(submitted[1].yue2Abc, original.yue2Abc);
    assert.equal(submitted[1].yue2NoiseSeed, 7);
  } finally { globalThis.fetch = previousFetch; queryClient.clear(); }
  clearYue2SongState();
  assert.equal(gp().backendParams.yue2Cover, undefined);
  assert.equal(gp().backendParams.yue2Abc, undefined);
  assert.equal(gp().backendParams.yue2OdeSteps, 64);
  storage.set('hs-lyrics', JSON.stringify('New words'));
  set('yue2Abc', 'manually pasted new score');
  assert.equal(yue2SongStateForLyrics(gp().backendParams, 'New words').yue2Abc, 'manually pasted new score');
  assert.equal(gp().backendParams.yue2NoiseSeed, undefined);
});
