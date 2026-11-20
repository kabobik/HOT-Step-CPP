import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { mapOfficialRequest } from './request.js';
import { renderOfficial } from './client.js';

test('official inputs preserve Russian lyrics and ignore unrelated native knobs', () => {
  const p = { prompt: 'Тяжёлый рок', lyrics: '[Verse]\nЗимний вечер', duration: -1, seed: 7,
    mm3Steps: 8, mm3CfgFlow: 9, inferenceSteps: 5, yue2Abc: 'stale', mm3OfficialSteps: 40 };
  assert.deepEqual(mapOfficialRequest(p), { caption: p.prompt, lyrics: p.lyrics, duration: 300, seed: 7, steps: 40 });
  assert.equal(mapOfficialRequest({ ...p, instrumental: true }).lyrics, '');
  assert.equal(mapOfficialRequest({ ...p, randomSeed: true }).seed, undefined);
  for (const patch of [{ duration: 600 }, { duration: NaN }, { seed: -2 }, { steps: 5, mm3OfficialSteps: 5 }, { batchSize: 2 }, { taskType: 'cover' }]) {
    assert.throws(() => mapOfficialRequest({ ...p, ...patch }));
  }
});

test('cancellation during submit retains id and waits for child exit acknowledgement', async () => {
  const controller = new AbortController();
  let exited = false;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') {
      controller.abort();
      setTimeout(() => res.end(JSON.stringify({ id: '11111111-1111-1111-1111-111111111111' })), 30);
    } else if (req.method === 'DELETE') {
      setTimeout(() => { exited = true; res.end(JSON.stringify({ process_exited: true })); }, 40);
    } else { res.statusCode = 500; res.end('{}'); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const old = process.env.BOBIK_MM3_OFFICIAL_URL;
  process.env.BOBIK_MM3_OFFICIAL_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    await assert.rejects(renderOfficial({}, controller.signal, () => {}));
    assert.equal(exited, true, 'queue must not advance before CUDA process exit');
  } finally {
    if (old === undefined) delete process.env.BOBIK_MM3_OFFICIAL_URL; else process.env.BOBIK_MM3_OFFICIAL_URL = old;
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
  }
});


test('official seeds match the panel uint64 contract without rounding or truncation', () => {
  const base = { caption: 'Russian rock', lyrics: '[Verse] Снег' };
  for (const seed of [0, 2147483648, 4294967295, Number.MAX_SAFE_INTEGER,
    '9007199254740992', '16302813008879570944', '18446744073709551615']) {
    assert.equal(mapOfficialRequest({ ...base, seed }).seed, seed);
    assert.equal(mapOfficialRequest({ ...base, seed, randomSeed: true }).seed, undefined);
  }
  assert.equal(mapOfficialRequest({ ...base, seed: '4294967295' }).seed, 4294967295);
  assert.equal(mapOfficialRequest({ ...base, seed: '-1' }).seed, undefined);
  for (const seed of [-2, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    '18446744073709551616', '-2', '1e5', '', null, true]) {
    assert.throws(() => mapOfficialRequest({ ...base, seed }));
  }
});
