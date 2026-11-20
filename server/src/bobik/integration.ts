import type { Express } from 'express';
import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage<boolean>();

export async function bobikWithActivity<T>(fn: () => Promise<T>): Promise<T> {
  if (scope.getStore()) return fn();
  const child = spawn('/usr/bin/python3', [process.env.BOBIK_ACTIVITY_LEASE_SCRIPT || '/opt/teslabobik-hot-step/activity_lease.py'],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  let error = '';
  child.stderr.on('data', data => { error += data; });
  try {
    await new Promise<void>((resolve, reject) => {
      let output = '';
      child.on('error', reject);
      child.stdout.on('data', data => {
        output += data;
        if (output.includes('READY\n')) resolve();
      });
      child.on('exit', code => reject(new Error(error.trim() || `GPU lease exited: ${code}`)));
    });
    return await scope.run(true, fn);
  } finally {
    child.stdin.end();
  }
}

const prefix = '/manage/music';
const mediaFields = new Set(['sourceAudioUrl', 'audioUrl', 'audio_url', 'reference_audio_url']);
function nativeMediaPaths(value: any): any {
  if (Array.isArray(value)) return value.map(nativeMediaPaths);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (mediaFields.has(key) && typeof item === 'string' &&
        (item.startsWith(prefix + '/audio/') || item.startsWith(prefix + '/references/'))) {
      return [key, item.slice(prefix.length)];
    }
    return [key, nativeMediaPaths(item)];
  }));
}

// Register after express.json/urlencoded, before the API routes.
export function bobikRequestPaths(app: Express) {
  app.use((req, _res, next) => {
    if (req.get('x-bobik-music-prefix') === prefix && req.body) {
      req.body = nativeMediaPaths(req.body);
    }
    next();
  });
}

function publicPaths(value: any): any {
  if (typeof value === 'string' && /^\/(audio|references)\//.test(value)) return prefix + value;
  if (Array.isArray(value)) return value.map(publicPaths);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, publicPaths(item)]));
  return value;
}

export function bobikPublicPaths(app: Express) {
  app.use((req, res, next) => {
    // nginx strips the external prefix. Direct localhost access is also supported.
    if (req.url === prefix || req.url.startsWith(prefix + '/')) {
      req.url = req.url.slice(prefix.length) || '/';
      req.headers['x-bobik-music-prefix'] = prefix;
    }
    if (req.get('x-bobik-music-prefix') === prefix) {
      // The player sends its public audio URL back to /api/audio/peaks.
      // Normalize that query value before the native local-file validation.
      const queryAt = req.url.indexOf('?');
      if (queryAt >= 0) {
        const query = new URLSearchParams(req.url.slice(queryAt + 1));
        const media = query.get('url');
        if (media?.startsWith(prefix + '/audio/') || media?.startsWith(prefix + '/references/')) {
          query.set('url', media.slice(prefix.length));
          req.url = req.url.slice(0, queryAt) + '?' + query.toString();
        }
      }
      const json = res.json;
      res.json = function(value) { return json.call(this, publicPaths(value)); };
    }
    next();
  });
}
