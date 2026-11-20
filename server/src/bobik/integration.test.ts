import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { bobikPublicPaths, bobikRequestPaths } from './integration.js';

test('portal prefix and media URLs round-trip without changing lyrics', async () => {
  const app = express();
  bobikPublicPaths(app);
  app.use(express.json());
  bobikRequestPaths(app);
  app.post('/api/echo', (req, res) => res.json({
    request: req.body, received: req.body.sourceAudioUrl, native: req.body.sourceAudioUrl === '/audio/source.wav',
    audio: '/audio/result.wav',
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/manage/music/api/echo`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceAudioUrl: '/manage/music/audio/source.wav', lyrics: 'Русский текст' }),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.equal(result.request.lyrics, 'Русский текст');
    assert.equal(result.native, true);
    assert.equal(result.audio, '/manage/music/audio/result.wav');
    // Response middleware prefixes all native media strings, including this echo.
    assert.equal(result.received, '/manage/music/audio/source.wav');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
