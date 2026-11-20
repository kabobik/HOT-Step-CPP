import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
  'export async function load(url, ctx, next) { if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }; return next(url, ctx); }'));
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
} });
const { useGlobalParamsStore } = await import('./globalParamsStore');
const { useBackendStore } = await import('./backendStore');
const { createContentParams, createContentFromDraft } = await import('../components/create/createContent');
const { generateApi } = await import('../services/api');
const { mapOfficialRequest } = await import('../../../server/src/services/backends/minimaxOfficial/request');
const { queryClient } = await import('../queries/client');

test('Official MiniMax preserves the panel uint64 seed in the submitted browser request', async () => {
  const previousFetch = globalThis.fetch;
  let submitted: any;
  globalThis.fetch = async (_url, init) => {
    submitted = JSON.parse(String(init?.body));
    return Response.json({ jobId: 'seed-check', status: 'pending' });
  };
  try {
    useBackendStore.setState({ activeBackendId: 'minimax-official' });
    const gp = useGlobalParamsStore.getState();
    gp.setRandomSeed(false);
    for (const seed of ['16302813008879570944', '18446744073709551615']) {
      gp.setSeed(seed);
      const params = useGlobalParamsStore.getState().getGlobalParams();
      assert.equal(params.seed, seed);
      await generateApi.submit(params as never);
      assert.equal(submitted.seed, seed);
      assert.equal(submitted.backend, 'minimax-official');
      assert.equal(mapOfficialRequest({ ...submitted, caption: 'Russian rock' }).seed, seed);
    }
    gp.setSeed(4294967295);
    assert.equal(useGlobalParamsStore.getState().getGlobalParams().seed, 4294967295);
  } finally {
    globalThis.fetch = previousFetch;
    queryClient.clear();
  }
});
