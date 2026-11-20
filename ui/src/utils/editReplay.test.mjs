import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createYue2EditSnapshot, restoredYue2Models, prepareYue2Edit, isEditRestoring} from './editReplay.mjs';
const extensions = JSON.parse(fs.readFileSync(new URL('./capabilities.json', import.meta.url))).extensions;
const defaults = {postProcessingEnabled: true, vocalNaturalizerEnabled: false, naturalizeAmount: 0.5,
  masteringEnabled: false, spectralLifterEnabled: false, stableStepOn: false, stableStepAdapters: [],
  coverArtEnabled: false, qualityEvalEnabled: false, lufsEnabled: false, gainOffsetDb: 0,
  timbreReference: false, timbreAudioPath: '', timbreReferenceStrength: 1, postprocessEnabled: false, postprocessPlugin: ''};
const original = {backend: 'yue2', seed: 1900895775, yue2ScoreOrigin: 'supplied', yue2Abc: 'X:1\nK:C\nC4|',
  yue2OdeSteps: 64, yue2Request: {lm_type: 'bf16', vae_variant: 'standard', seed: 1900895775,
    noise_seed: 1900895775, ode_steps: 64, cfg_scale: 1, nar_chunk_frames: 15000, semantic_max_tokens: 9000}};

test('old track restores checkpoint defaults rather than stale 1.8/2', () => {
  const result = createYue2EditSnapshot(original, extensions, defaults);
  assert.equal(result.backendParams.yue2SemTemperature, 1);
  assert.equal(result.backendParams.yue2PlanCfg, 1);
  assert.equal(result.backendParams.yue2SemMaxTokens, 9000);
  assert.equal(result.backendParams.yue2OdeSteps, 64);
  assert.equal(result.backendParams.yue2NarChunkSeconds, 600);
  assert.equal(result.backendParams.yue2Abc, original.yue2Abc);
  assert.equal(result.globalValues.coverArtEnabled, false);
  assert.equal(result.globalValues.vocalNaturalizerEnabled, false);
  assert.equal(result.params.randomSeed, false);
});
test('new track restores explicit values, zero and false; actual wire wins', () => {
  const saved = {...original, yue2SemTemperature: 1.8, yue2PlanCfg: 2,
    naturalizeAmount: 0, vocalNaturalizerEnabled: true, postProcessingEnabled: false,
    yue2Request: {...original.yue2Request, semantic_temperature: 1, semantic_top_k: 0,
      plugin_params: {'yue2:plan_cfg': 2, 'yue2:plan_cfg_level_match': false}}};
  const result = createYue2EditSnapshot(saved, extensions, defaults);
  assert.equal(result.backendParams.yue2SemTemperature, 1);
  assert.equal(result.backendParams.yue2PlanCfg, 2);
  assert.equal(result.backendParams.yue2SemTopK, 0);
  assert.equal(result.backendParams.yue2PlanCfgLevelMatch, false);
  assert.equal(result.globalValues.naturalizeAmount, 0);
  assert.equal(result.globalValues.postProcessingEnabled, false);
});
test('request-only legacy score and single-track seeds survive Edit', () => {
  const saved = {backend: 'yue2', yue2: {abc_supplied: true}, yue2Request: {...original.yue2Request, abc: 'wire ABC', seed: 0, noise_seed: 7}, yue2BatchSize: 2};
  const result = createYue2EditSnapshot(saved, extensions, defaults);
  assert.equal(result.backendParams.yue2Abc, 'wire ABC');
  assert.equal(result.params.seed, 0);
  assert.equal(result.params.yue2NoiseSeed, 7);
  assert.equal(result.backendParams.yue2BatchSize, 1);
});
test('model and adapter state restores actual halves and clears absent adapters', () => {
  const base = restoredYue2Models(original);
  assert.equal(base.vae, 'standard'); assert.equal(base.lmAdapterAr, ''); assert.equal(base.lmAdapterNar, '');
  const restored = restoredYue2Models({...original, yue2Adapters: {ar: {path: '/a.safetensors', scales: {global: 0, attn: 0.2, plan: 0.4}}}});
  assert.equal(restored.lmAdapterArScale, '0');
  assert.equal(restored.lmAdapterArScaleAttn, '0.2');
  assert.equal(restored.lmAdapterArScalePlan, '0.4');
});

function fixture({unavailable = false, failSave = false} = {}) {
  const notices = [], changes = [];
  const models = {buckets: {lm: ['bf16'], vae: unavailable ? ['rs-x3'] : ['standard', 'rs-x3']}, defaults: {lm: 'bf16', vae: 'rs-x3'}};
  const backend = {activeBackendId: 'yue2', models: {yue2: models}, capabilities: {yue2: {extensions}},
    fetchModels: async () => {}, fetchCapabilities: async () => {},
    selectModels: async selection => {changes.push(selection); if (failSave) return false; Object.assign(models.defaults, selection); return true;}};
  const state = {backendParams: {yue2SemTemperature: 1.8, yue2PlanCfg: 2, yue2EndBias: 9, yue2Pick: {vae: 'rs-x3'}}, pluginParams: {stale: 9}};
  for (const key of Object.keys(defaults)) state['set' + key[0].toUpperCase() + key.slice(1)] = v => state[key] = v;
  const env = {backendStore: {getState: () => backend}, paramsStore: {getState: () => state, setState: patch => Object.assign(state, patch)}, defaults, notify: (...args) => notices.push(args)};
  globalThis.localStorage = {setItem() {}};
  return {env, notices, state, backend, changes};
}
test('Edit replaces persisted parameter bags, restores models and postprocessing', async () => {
  const f = fixture();
  const edited = await prepareYue2Edit({backend: 'yue2', generationParams: original}, f.env);
  assert.ok(edited); assert.equal(f.state.backendParams.yue2SemTemperature, 1);
  assert.equal(f.state.backendParams.yue2PlanCfg, 1);
  assert.equal(f.state.backendParams.yue2Pick, undefined);
  assert.deepEqual(f.state.pluginParams, {});
  assert.equal(f.state.vocalNaturalizerEnabled, false);
  assert.equal(f.backend.models.yue2.defaults.vae, 'standard');
  assert.deepEqual(f.notices, []);
});
test('failed or unavailable model does not partially restore controls', async () => {
  for (const options of [{failSave: true}, {unavailable: true}]) {
    const f = fixture(options);
    assert.equal(await prepareYue2Edit({backend: 'yue2', generationParams: original}, f.env), null);
    assert.equal(f.state.backendParams.yue2SemTemperature, 1.8);
    assert.equal(f.notices.length, 1);
    assert.equal(isEditRestoring(), false);
  }
});
test('another backend is untouched; stale concurrent Edit cannot interleave', async () => {
  const f = fixture(); const ace = {backend: 'ace', generationParams: {seed: 5}};
  assert.equal(await prepareYue2Edit(ace, f.env), ace);
  let release; f.backend.fetchModels = () => new Promise(r => release = r);
  const pending = prepareYue2Edit({backend: 'yue2', generationParams: original}, f.env);
  assert.equal(isEditRestoring(), true);
  assert.equal(await prepareYue2Edit({backend: 'yue2', generationParams: original}, f.env), null);
  release(); await pending; assert.equal(isEditRestoring(), false);
});
