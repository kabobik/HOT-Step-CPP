// Edit is a replacement snapshot, never a merge with another song's controls.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const OMIT = new Set(['yue2', 'yue2Request', 'yue2Adapters', 'yue2Continuation',
  'yue2Pick', 'yue2VaeVariant', 'yue2LmType', 'yue2Cover', 'yue2Prepare']);
const WIRE = {
  yue2Cot: 'cot', yue2CfgScale: 'cfg_scale', yue2OdeSteps: 'ode_steps',
  yue2NoiseSeed: 'noise_seed', yue2ComposeRetries: 'semantic_retries',
  yue2NarCacheRatio: 'nar_cache_ratio',
  yue2PlanTemperature: 'plan_temperature', yue2PlanTopP: 'plan_top_p',
  yue2PlanTopK: 'plan_top_k', yue2PlanRepPenalty: 'plan_repetition_penalty',
  yue2PlanRepWindow: 'plan_penalty_window', yue2PlanMaxTokens: 'plan_max_tokens',
  yue2SemTemperature: 'semantic_temperature', yue2SemTopP: 'semantic_top_p',
  yue2SemTopK: 'semantic_top_k', yue2SemRepPenalty: 'semantic_repetition_penalty',
  yue2SemRepWindow: 'semantic_penalty_window', yue2SemMinTokens: 'semantic_min_tokens',
  yue2SemMaxTokens: 'semantic_max_tokens', yue2SemMinP: 'semantic_min_p',
  yue2CfgMinP: 'cfg_min_p', yue2CfgRescale: 'cfg_rescale',
  yue2EndThreshold: 'end_threshold', yue2EndBias: 'end_bias',
  yue2EndBiasFrom: 'end_bias_from_sec', yue2EndBiasRamp: 'end_bias_ramp_sec',
};
const PLUGINS = {
  yue2PlanCfg: 'yue2:plan_cfg', yue2PlanCfgT1: 'yue2:plan_cfg_t1',
  yue2PlanCfgT2: 'yue2:plan_cfg_t2', yue2PlanCfgRescale: 'yue2:plan_cfg_rescale',
  yue2PlanCfgLevelMatch: 'yue2:plan_cfg_level_match',
  yue2CadsStrength: 'yue2:cads_strength', yue2CadsT1: 'yue2:cads_t1',
  yue2CadsT2: 'yue2:cads_t2', yue2CadsRescale: 'yue2:cads_rescale',
  yue2PlanWStart: 'yue2:plan_w_start', yue2PlanWEnd: 'yue2:plan_w_end',
  yue2PlanWCurve: 'yue2:plan_w_curve',
};
const POST = /^(postProcessing|spectralLifter|sl[A-Z]|mastering|timbre|vocalNaturalizer|gainOffset|naturalize|nat[A-Z]|ppVae|mm3Refiner|stableStep|coverArt|qualityEval|whisper|yue2Align|postprocess|lufs|autoTrim|durationBuffer|skipLrc)/;

export function createYue2EditSnapshot(saved, extensions, defaults) {
  const wire = object(saved.yue2Request);
  const backendParams = {};
  // Checkpoint/extension defaults come from the restored model, not current UI values.
  for (const p of extensions) if (p.key.startsWith('yue2') && own(p, 'default')) {
    backendParams[p.key] = p.default;
  }
  for (const [key, value] of Object.entries(saved)) {
    if (key.startsWith('yue2') && !OMIT.has(key) && value != null) backendParams[key] = value;
  }
  // The engine request wins over pre-normalization UI values, including zero.
  for (const [key, field] of Object.entries(WIRE)) {
    if (own(wire, field) && wire[field] != null) backendParams[key] = wire[field];
  }
  for (const [key, field] of Object.entries(PLUGINS)) {
    if (own(object(wire.plugin_params), field)) backendParams[key] = wire.plugin_params[field];
  }
  if (own(wire, 'nar_chunk_frames')) backendParams.yue2NarChunkSeconds = wire.nar_chunk_frames / 25;
  const solvers = {md_wasserstein_yue2: 'wasserstein', md_ancestral_yue2: 'ancestral', md_latent_eq_yue2: 'latent_eq', md_tlie_yue2: 'tlie', midpoint: 'stock'};
  const schedulers = {'md_ht_scheduler V3': 'ht_v3', md_plan_aware_yue2: 'plan_aware', md_plan_loose_yue2: 'plan_loose', md_plan_overdrive_yue2: 'plan_overdrive'};
  if (wire.ode_method && solvers[wire.ode_method]) backendParams.yue2NarSolver = solvers[wire.ode_method];
  if (wire.scheduler && schedulers[wire.scheduler]) backendParams.yue2NarScheduler = schedulers[wire.scheduler];
  const origin = saved.yue2ScoreOrigin ?? (saved.yue2?.abc_supplied || saved.yue2?.abc_planned ? 'supplied' : 'engine');
  backendParams.yue2ScoreOrigin = origin;
  backendParams.yue2Abc = origin === 'supplied' ? saved.yue2Abc ?? wire.abc ?? '' : '';
  backendParams.yue2BatchSize = 1;
  backendParams.yue2Variations = 1;

  const globalValues = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (POST.test(key)) globalValues[key] = saved[key] ?? value;
  }
  // These request fields are not one-to-one with their UI storage fields.
  globalValues.timbreAudioPath = typeof saved.timbreReference === 'string' ? saved.timbreReference : '';
  globalValues.timbreReference = saved.timbreReference === true;
  globalValues.postprocessEnabled = !!saved.postprocessPlugin;
  if (Array.isArray(globalValues.stableStepAdapters)) {
    globalValues.stableStepAdapters = globalValues.stableStepAdapters.map(a => ({...a, enabled: a.enabled ?? true}));
  }
  const params = {...saved, ...backendParams, ...globalValues};
  for (const key of ['yue2Pick', 'yue2VaeVariant', 'yue2LmType', 'yue2Cover', 'yue2Prepare']) delete params[key];
  if (own(wire, 'seed')) params.seed = wire.seed;
  if (own(wire, 'noise_seed')) params.yue2NoiseSeed = wire.noise_seed;
  if (params.seed !== undefined) params.randomSeed = false;
  return {params, backendParams, globalValues, pluginParams: object(saved.pluginParams)};
}

export function restoredYue2Models(saved) {
  const wire = object(saved.yue2Request);
  const pick = object(saved.yue2Pick);
  const result = {lm: wire.lm_type ?? pick.lm, vae: wire.vae_variant ?? saved.yue2?.vae_variant ?? pick.vae};
  // Missing adapter on an old base-model track means no adapter, not today's pick.
  for (const [half, slot] of [['ar', 'Ar'], ['nar', 'Nar']]) {
    const adapter = object(saved.yue2Adapters?.[half]);
    const prefix = 'lmAdapter' + slot;
    result[prefix] = adapter.path ?? pick[prefix] ?? '';
    const scales = object(adapter.scales);
    for (const [field, key, fallback] of [
      ['Scale', 'global', 1], ['ScaleAttn', 'attn', 1], ['ScaleMlp', 'mlp', 1],
      ['ScaleEarly', 'early', 1], ['ScaleMid', 'mid', 1], ['ScaleLate', 'late', 1],
      ['Rebase', 'rebase', 0.75], ['ScalePlan', 'plan', ''],
    ]) result[prefix + field] = scales[key] ?? adapter[key] ?? pick[prefix + field] ?? fallback;
  }
  return Object.fromEntries(Object.entries(result).filter(([,v]) => v !== undefined).map(([k,v]) => [k,String(v)]));
}

let restoring = false;
export function isEditRestoring() { return restoring; }

export async function prepareYue2Edit(song, {backendStore, paramsStore, defaults, notify}) {
  const raw = song.generationParams;
  const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if ((song.backend ?? saved?.backend) !== 'yue2') return song;
  if (!saved) { notify('У трека нет сохранённых настроек генерации.', 'error'); return null; }
  if (restoring) { notify('Настройки предыдущего трека ещё восстанавливаются.', 'warning'); return null; }
  if (backendStore.getState().activeBackendId !== 'yue2') {
    notify('Для редактирования этого трека выбери движок YuE2.', 'error'); return null;
  }
  restoring = true;
  try {
    const selection = restoredYue2Models(saved);
    await backendStore.getState().fetchModels('yue2');
    const catalogue = backendStore.getState().models.yue2;
    if (!catalogue) throw new Error('Не удалось получить список моделей.');
    for (const field of ['lm', 'vae']) {
      const value = selection[field];
      if (value && (!catalogue.buckets?.[field]?.includes(value) || catalogue.meta?.[field]?.[value]?.disabledReason)) {
        throw new Error(`Сохранённая модель ${field}: ${value} недоступна.`);
      }
    }
    const changed = Object.entries(selection).some(([key, value]) => String(catalogue.defaults?.[key] ?? '') !== value);
    if (changed) {
      if (!await backendStore.getState().selectModels(selection, 'yue2')) throw new Error('Не удалось восстановить модели. Дождись завершения активной генерации и повтори.');
      const actual = backendStore.getState().models.yue2?.defaults ?? {};
      if (Object.entries(selection).some(([key, value]) => String(actual[key] ?? '') !== value)) throw new Error('Сервер не подтвердил сохранённый выбор моделей.');
    }
    await backendStore.getState().fetchCapabilities('yue2');
    if (backendStore.getState().activeBackendId !== 'yue2') throw new Error('Движок переключён во время восстановления.');
    const extensions = backendStore.getState().capabilities.yue2?.extensions;
    if (!extensions?.length) throw new Error('Не удалось получить исходные значения параметров YuE2.');
    const snapshot = createYue2EditSnapshot(saved, extensions, defaults);
    // Replace both bags atomically; merge would retain omitted stale knobs.
    paramsStore.setState({backendParams: snapshot.backendParams, pluginParams: snapshot.pluginParams});
    localStorage.setItem('hs-backendParams@yue2', JSON.stringify(snapshot.backendParams));
    localStorage.setItem('hs-pluginParams@yue2', JSON.stringify(snapshot.pluginParams));
    for (const [key, value] of Object.entries(snapshot.globalValues)) {
      const setter = paramsStore.getState()['set' + key[0].toUpperCase() + key.slice(1)];
      if (typeof setter === 'function') setter(value);
    }
    return {...song, generationParams: snapshot.params};
  } catch (error) {
    notify('Настройки трека не восстановлены: ' + (error?.message ?? String(error)), 'error');
    return null;
  } finally { restoring = false; }
}
