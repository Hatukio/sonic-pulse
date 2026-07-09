import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AudioEngine,
  SILENT_FEATURES,
  extractFrequencyFeatures,
} from '../public/src/audio/audio-engine.mjs';

test('extracts normalized bass, mid, treble, onset, and dynamic range', () => {
  const data = new Uint8Array(16);
  data.fill(255, 0, 2);
  data.fill(128, 2, 8);
  data.fill(64, 8);

  const features = extractFrequencyFeatures(data, {
    sampleRate: 32000,
    fftSize: 32,
    previousBass: 0.25,
  });

  assert.equal(features.bass, 1);
  assert.ok(features.mid > features.treble);
  assert.equal(features.onset, 1);
  assert.equal(features.dynamicRange, features.bass - features.treble);
});

test('creates one reusable media source and resumes a suspended context', async () => {
  const calls = { source: 0, analyser: 0, resume: 0, sourceConnect: 0, analyserConnect: 0 };
  const analyser = {
    fftSize: 0,
    frequencyBinCount: 8,
    connect() { calls.analyserConnect += 1; },
    getByteFrequencyData(target) { target.fill(0); },
  };
  const context = {
    state: 'suspended',
    sampleRate: 48000,
    destination: {},
    createAnalyser() { calls.analyser += 1; return analyser; },
    createMediaElementSource() {
      calls.source += 1;
      return { connect() { calls.sourceConnect += 1; } };
    },
    async resume() { calls.resume += 1; this.state = 'running'; },
  };
  const audio = {};
  const engine = new AudioEngine(audio, { contextFactory: () => context });

  await engine.ensureStarted();
  await engine.ensureStarted();

  assert.deepEqual(calls, {
    source: 1,
    analyser: 1,
    resume: 1,
    sourceConnect: 1,
    analyserConnect: 1,
  });
  assert.equal(engine.context, context);
  assert.equal(engine.source != null, true);
});

test('returns a defensive silent feature object before the graph starts', () => {
  const engine = new AudioEngine({});
  const first = engine.readFeatures();
  first.bass = 1;

  assert.deepEqual(engine.readFeatures(), SILENT_FEATURES);
});

test('adopts a legacy graph without creating a second context or media source', async () => {
  const audio = {};
  const data = new Uint8Array(8);
  const analyser = {
    fftSize: 2048,
    frequencyBinCount: 8,
    getByteFrequencyData(target) { target.fill(0); },
  };
  const source = {};
  const context = {
    state: 'running',
    sampleRate: 48000,
    createMediaElementSource() { throw new Error('must not create a second source'); },
  };
  const legacyGraph = { audio, context, analyser, source, data };
  let contextFactoryCalls = 0;
  const engine = new AudioEngine(audio, {
    initialGraph: legacyGraph,
    contextFactory() { contextFactoryCalls += 1; return context; },
  });

  await engine.ensureStarted();
  const secondEngine = new AudioEngine(audio, {
    contextFactory() { contextFactoryCalls += 1; return context; },
  });
  await secondEngine.ensureStarted();

  assert.equal(contextFactoryCalls, 0);
  assert.equal(engine.context, context);
  assert.equal(engine.analyser, analyser);
  assert.equal(engine.source, source);
  assert.equal(engine.data, data);
  assert.equal(secondEngine.source, source);
});
