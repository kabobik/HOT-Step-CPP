/** A score and its source belong to one composition, never to shared knobs. */
const SONG_FIELDS = new Set([
  'yue2Abc', 'yue2NoiseSeed', 'yue2ScoreOrigin', 'yue2ScoreLyrics',
  'yue2Continuation', 'yue2Cover', 'yue2Prepare', 'yue2Build', 'yue2Pick',
]);

export function withoutYue2SongState(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([key]) => !SONG_FIELDS.has(key)));
}

/** Only Create explicitly opts into a pasted/restored score for these words.
 * Unbound scores from older browser storage are deliberately not adopted. */
export function yue2SongStateForLyrics(params: Record<string, unknown>, lyrics: string): Record<string, unknown> {
  if (typeof params.yue2ScoreLyrics !== 'string' || params.yue2ScoreLyrics.trim() !== lyrics.trim()) return {};
  return Object.fromEntries(Object.entries(params).filter(([key]) => SONG_FIELDS.has(key)
    && key !== 'yue2ScoreLyrics' && key !== 'yue2Continuation'));
}
