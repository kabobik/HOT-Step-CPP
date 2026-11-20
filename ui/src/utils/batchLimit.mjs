// Bobik's tested concurrent song limit. Noise variations remain unchanged.
export const MAX_BATCH = 2;

export function limitBatch(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(MAX_BATCH, Math.max(1, Math.floor(number))) : 1;
}

export function limitYue2Props(props) {
  if (!props) return props;
  return {
    ...props,
    max_lm_batch: limitBatch(props.max_lm_batch),
    max_plan_batch: limitBatch(props.max_plan_batch ?? props.max_lm_batch),
  };
}

export function clampSavedBatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  // One-time migration changes only song count, preserving all other settings.
  try {
    if (localStorage.getItem('bobik-yue2-batch2-20261120') !== 'done') {
      localStorage.setItem('bobik-yue2-batch2-20261120', 'done');
      return { ...value, yue2BatchSize: 2 };
    }
  } catch {}
  if (!(Number(value.yue2BatchSize) > MAX_BATCH)) return value;
  return { ...value, yue2BatchSize: MAX_BATCH };
}
