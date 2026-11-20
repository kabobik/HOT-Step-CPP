/** Separate contract: native MM3 knobs must never silently affect the official pipeline. */
export const OFFICIAL_ID = 'minimax-official';
export const MODEL_REVISION = '1b525ccb685ae809f33027c51c351eeb5833cf72';
export interface OfficialRequest { caption: string; lyrics: string; duration: number; steps: number; seed?: number }
export function mapOfficialRequest(p: Readonly<Record<string, unknown>>): OfficialRequest {
  if (p.taskType && p.taskType !== 'text2music') throw new Error('Official MiniMax supports text2music only');
  const caption = [p.prompt, p.songDescription, p.caption, p.style].find(v => typeof v === 'string' && v.trim());
  if (typeof caption !== 'string' || caption.length > 16000) throw new Error('MiniMax needs a music description (at most 16000 characters)');
  const lyrics = p.instrumental === true ? '' : p.lyrics ?? '';
  if (typeof lyrics !== 'string' || lyrics.length > 32000) throw new Error('Invalid MiniMax lyrics');
  const duration = p.duration === -1 || p.duration === undefined ? 300 : p.duration;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 1 || duration > 300) throw new Error('MiniMax duration must be 1–300 seconds or Auto');
  const steps = p.mm3OfficialSteps ?? 30;
  if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 20 || steps > 60) throw new Error('MiniMax steps must be an integer from 20 to 60');
  if (p.batchSize !== undefined && p.batchSize !== 1) throw new Error('Official MiniMax generates one track at a time');
  const seed = p.randomSeed || p.seed === -1 ? undefined : p.seed;
  if (seed !== undefined && (typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647)) throw new Error('MiniMax seed must be an integer from 0 to 2147483647');
  return { caption, lyrics, duration, steps, ...(seed === undefined ? {} : { seed: seed as number }) };
}
