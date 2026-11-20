// Exercise the actual bundled deliver() with the release's Express implementation.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import express from 'express';
import ts from 'typescript';
import test from 'node:test';
test('Unicode exports preserve filenames, content and save parity', async () => {
const source = fs.readFileSync(new URL('../routes/download.ts', import.meta.url), 'utf8');
const deliverText = ts.transpileModule(source.slice(source.indexOf('function deliver('), source.indexOf('// GET /api/download/:id?')), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bobik-download-test-'));
const file = path.join(dir, 'fixture.flac');
const payload = Buffer.from('fLaC test payload');
fs.writeFileSync(file, payload);
let saved = '';
const context = vm.createContext({fs, path, console,
  config: {data: {downloadDir: dir}},
  saveIntoDir: (_dir: string, name: string) => {saved = name; return path.join(dir, name);}});
vm.runInContext(deliverText, context);
const cases = [
  ['Мужской баритон - Пукнул и ушёл.flac', 'audio/flac'],
  ['Проверка - Музыка 🎵.wav', 'audio/wav'],
  ['Пукнул и ушёл.lrc', 'text/plain; charset=utf-8'],
  ['Artist - ASCII (live).mp3', 'audio/mpeg'],
  ['Песня"/\\:\r\nInjected: value?.flac', 'audio/flac'],
];
const app = express();
app.get('/:index', (req, res) => {
  const [filename, mime] = cases[Number(req.params.index)];
  context.deliver(res, false, file, filename, mime);
});
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
try {
  for (const [i, [filename, mime]] of cases.entries()) {
    const response = await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/${i}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), mime);
    const disposition = response.headers.get('content-disposition')!;
    const extended = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const actual = extended ? decodeURIComponent(extended[1]) : disposition.match(/filename="([^"]+)"/)![1];
    const expected = filename.replace(/[<>:"\/\\|?*\u0000-\u001f\u007f]/g, '').trim();
    assert.equal(actual, expected);
    assert.equal(Number(response.headers.get('content-length')), payload.length);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
    assert.equal(response.headers.get('injected'), null);
    context.deliver({json: () => {}}, true, file, filename, mime);
    assert.equal(saved, expected);
  }
  console.log(JSON.stringify({passed: true, cases: cases.length, checks: ['Unicode filename', 'ASCII compatibility', 'MIME preserved', 'body and length', 'control characters', 'save filename parity']}));
} finally {
  server.close();
  fs.rmSync(dir, {recursive: true, force: true});
}

});
