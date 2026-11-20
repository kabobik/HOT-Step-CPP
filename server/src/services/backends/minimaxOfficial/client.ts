import { setTimeout as sleep } from 'node:timers/promises';
export function officialUrl(): string { return (process.env.BOBIK_MM3_OFFICIAL_URL || '').replace(/\/$/, ''); }
export async function officialFetch(route: string, init: RequestInit = {}): Promise<Response> {
  const url = officialUrl();
  if (!url) throw new Error('Official MiniMax is not configured');
  const response = await fetch(url + route, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Official MiniMax HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  return response;
}
export async function cancelOfficial(id: string): Promise<void> {
  const response = await officialFetch(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const ack = await response.json() as { process_exited?: boolean };
  if (!ack.process_exited) throw new Error('MiniMax cancellation did not confirm process exit');
}
export interface OfficialStatus {
  status: 'running' | 'done' | 'cancelled' | 'failed'; stage?: string;
  frames?: number; cap_frames?: number; error?: string;
  result?: Record<string, unknown> & { duration: number; total_ms: number; seed: number | string };
}
/** The initial POST is deliberately not aborted: retain its id, then cancel and await exit. */
export async function renderOfficial(body: object, signal: AbortSignal, onStatus: (s: OfficialStatus) => void): Promise<{ audio: Buffer; detail: OfficialStatus }> {
  signal.throwIfAborted();
  const submit = await officialFetch('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const { id } = await submit.json() as { id: string };
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid MiniMax job id');
  const deadline = Date.now() + 180 * 60_000;
  try {
    for (;;) {
      signal.throwIfAborted();
      if (Date.now() >= deadline) throw new Error('Official MiniMax exceeded 180 minutes');
      const status = await (await officialFetch(`/jobs/${id}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })).json() as OfficialStatus;
      onStatus(status);
      if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error || `MiniMax ${status.status}`);
      if (status.status === 'done') {
        if (!status.result) throw new Error('Missing MiniMax generation metadata');
        const audio = Buffer.from(await (await officialFetch(`/jobs/${id}/audio`, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) })).arrayBuffer());
        signal.throwIfAborted();
        return { audio, detail: status };
      }
      await sleep(1000, undefined, { signal });
    }
  } catch (error) {
    // Keep the queue lease until the CUDA child has exited. Never overlap a cancelled render.
    await cancelOfficial(id);
    throw error;
  }
}
