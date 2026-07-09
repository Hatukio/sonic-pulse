import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUS,
  createOnceDisposer,
  createAudioEngine,
  createFrameHandler,
  frameEventInterval,
  buildVinylShelfItems,
  loadTrackArtwork,
  moveQueueItem,
  nextPlayMode,
  nextPerformanceWarning,
  normalizeSubsystemReport,
  runRecoverableDesktopAction,
  resetMVForLocal,
  resetRuntimeDefaults,
} from '../public/src/app.mjs';

test('normalizes subsystem reports into the four recoverable application states', () => {
  assert.deepEqual(normalizeSubsystemReport({
    source: 'lyrics',
    status: STATUS.DEGRADED,
    message: '逐字歌词不可用，已切换逐行歌词',
    recoverable: true,
  }), {
    source: 'lyrics',
    status: 'degraded',
    message: '逐字歌词不可用，已切换逐行歌词',
    recoverable: true,
  });
  assert.deepEqual(normalizeSubsystemReport({ source: 'unknown', status: 'broken' }), {
    source: 'system',
    status: 'error',
    message: '系统状态异常',
    recoverable: false,
  });
});

test('performance warning appears only after five continuous seconds below 70 percent', () => {
  let state = nextPerformanceWarning({ target: 60, measuredFps: 40, now: 1000, lowSince: null });
  assert.equal(state.lowSince, 1000);
  assert.equal(state.message, '');
  state = nextPerformanceWarning({ target: 60, measuredFps: 40, now: 5999, lowSince: state.lowSince });
  assert.equal(state.message, '');
  state = nextPerformanceWarning({ target: 60, measuredFps: 40, now: 6000, lowSince: state.lowSince });
  assert.match(state.message, /40 FPS.*60 FPS/);
  assert.deepEqual(nextPerformanceWarning({ target: 60, measuredFps: 50, now: 7000, lowSince: state.lowSince }), {
    lowSince: null,
    message: '',
  });
  assert.deepEqual(nextPerformanceWarning({ target: 'unlocked', measuredFps: 1, now: 9000, lowSince: 0 }), {
    lowSince: null,
    message: '',
  });
});

test('once disposer releases every registered resource exactly once', () => {
  const calls = [];
  const dispose = createOnceDisposer([
    () => calls.push('events'),
    () => calls.push('renderer'),
  ]);
  assert.equal(dispose(), true);
  assert.equal(dispose(), false);
  assert.deepEqual(calls, ['events', 'renderer']);
});

test('once disposer continues after a broken resource cleanup', () => {
  const calls = [];
  const errors = [];
  const dispose = createOnceDisposer([
    () => { calls.push('broken'); throw new Error('cleanup failed'); },
    () => calls.push('still-released'),
  ], error => errors.push(error.message));
  assert.equal(dispose(), true);
  assert.deepEqual(calls, ['broken', 'still-released']);
  assert.deepEqual(errors, ['cleanup failed']);
});

test('artwork loader preserves WebGL degradation and ignores a stale image completion', async () => {
  let image;
  class DeferredImage {
    constructor() { image = this; }
    set src(value) { this.value = value; }
  }
  const reports = [];
  const withoutScene = await loadTrackArtwork({
    scene: null,
    url: 'https://example.test/cover.jpg',
    windowRef: { Image: DeferredImage },
    isCurrent: () => true,
  });
  assert.equal(withoutScene.status, STATUS.DEGRADED);
  assert.equal(image, undefined);

  const applied = [];
  let current = true;
  const pending = loadTrackArtwork({
    scene: {
      setArtwork(value) { applied.push(['artwork', value]); },
      setProceduralPalette(value) { applied.push(['fallback', value]); },
    },
    url: 'https://example.test/cover.jpg',
    windowRef: { Image: DeferredImage },
    isCurrent: () => current,
  });
  current = false;
  image.onload();
  reports.push(await pending);
  assert.deepEqual(reports, [null]);
  assert.deepEqual(applied, []);
});

test('recoverable desktop action reports a rejection instead of leaking it', async () => {
  const reports = [];
  const toasts = [];
  const result = await runRecoverableDesktopAction(
    () => Promise.reject(new Error('display disappeared')),
    { report: value => reports.push(value), toast: value => toasts.push(value) },
  );
  assert.equal(result, null);
  assert.equal(reports[0].source, 'desktop');
  assert.equal(reports[0].status, STATUS.ERROR);
  assert.equal(reports[0].recoverable, true);
  assert.deepEqual(toasts, ['display disappeared']);
});

test('desktop cadence follows the selected render target', () => {
  assert.equal(frameEventInterval(30), 1000 / 30);
  assert.equal(frameEventInterval(120), 1000 / 120);
  assert.equal(frameEventInterval('unlocked'), 0);
});

test('restore defaults disables MV and exits desktop layout before applying defaults', async () => {
  const calls = [];
  const result = await resetRuntimeDefaults({
    mvController: { disable() { calls.push('mv'); } },
    desktopApi: { layout(enabled) { calls.push(['layout', enabled]); return Promise.resolve({ bounds: { x: 1 } }); } },
    layoutMode: true,
  });
  assert.deepEqual(calls, ['mv', ['layout', false]]);
  assert.equal(result.bounds.x, 1);
});

test('local playback clears the visible official MV state without invalid discovery', () => {
  const calls = [];
  resetMVForLocal({ disable() { calls.push('disable'); } }, detail => calls.push(detail));
  assert.equal(calls[0], 'disable');
  assert.deepEqual(calls[1], { state: 'unavailable', enabled: false, metadata: null });
});

test('vinyl shelf model preserves queue order, active state, artwork, and MV badges', () => {
  const songs = [
    { id: 1, name: 'Nebula', artists: [{ name: 'Nova' }], mv: 120, al: { picUrl: 'nebula.jpg' } },
    { id: 2, name: 'Orbit', artists: 'Luna', albumPic: 'orbit.jpg' },
  ];
  const items = buildVinylShelfItems(songs, songs[0], new Set(['2']));

  assert.deepEqual(items.map(item => item.index), [0, 1]);
  assert.equal(items[0].active, true);
  assert.equal(items[0].artist, 'Nova');
  assert.equal(items[0].artwork, 'nebula.jpg');
  assert.equal(items[0].hasMV, true);
  assert.equal(items[1].active, false);
  assert.equal(items[1].artist, 'Luna');
  assert.equal(items[1].hasMV, true);
});

test('queue reordering is immutable and play mode cycles through sequence, repeat, and shuffle', () => {
  const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const moved = moveQueueItem(queue, 0, 2);

  assert.deepEqual(moved.map(item => item.id), ['b', 'c', 'a']);
  assert.deepEqual(queue.map(item => item.id), ['a', 'b', 'c']);
  assert.deepEqual(moveQueueItem(queue, -1, 2), queue);
  assert.equal(nextPlayMode('sequence'), 'repeat');
  assert.equal(nextPlayMode('repeat'), 'shuffle');
  assert.equal(nextPlayMode('shuffle'), 'sequence');
  assert.equal(nextPlayMode('unknown'), 'sequence');
});

test('passes scheduler delta seconds as the conductor third argument', () => {
  const calls = [];
  const features = { bass: 0.7, mid: 0.4, treble: 0.2, onset: 0.8, dynamicRange: 0.5 };
  const scheduler = {
    deltaSeconds: 1 / 120,
    measuredFps: 120,
    shouldRender(now) { calls.push(['schedule', now]); return true; },
  };
  const audioEngine = { readFeatures() { return features; } };
  const conductor = {
    update(...args) {
      calls.push(['conduct', ...args]);
      return { ...features, personality: 'impact' };
    },
  };
  const scene = { render(payload) { calls.push(['render', payload]); } };

  const frame = createFrameHandler({ scheduler, audioEngine, conductor, scene });
  assert.equal(frame(2500), true);

  assert.deepEqual(calls[1], ['conduct', features, 0.14, 1 / 120]);
  assert.deepEqual(calls[2], ['render', {
    time: 2.5,
    delta: 1 / 120,
    audio: features,
    personality: 'impact',
  }]);
});

test('does not sample audio or render when the scheduler gates a frame', () => {
  let sampled = false;
  let rendered = false;
  const frame = createFrameHandler({
    scheduler: { shouldRender: () => false },
    audioEngine: { readFeatures() { sampled = true; } },
    conductor: { update() {} },
    scene: { render() { rendered = true; } },
  });

  assert.equal(frame(8), false);
  assert.equal(sampled, false);
  assert.equal(rendered, false);
});

test('application audio composition adopts a graph registered by the legacy renderer', async () => {
  const audio = {};
  const legacyGraph = {
    audio,
    context: { state: 'running', sampleRate: 48000 },
    analyser: { fftSize: 2048, frequencyBinCount: 8, getByteFrequencyData() {} },
    source: {},
    data: new Uint8Array(8),
  };
  let factoryCalls = 0;
  const engine = createAudioEngine(audio, {
    __sonicPulseAudioGraph: legacyGraph,
  }, {
    contextFactory() { factoryCalls += 1; return {}; },
  });

  await engine.ensureStarted();
  assert.equal(factoryCalls, 0);
  assert.equal(engine.source, legacyGraph.source);
  assert.equal(engine.context, legacyGraph.context);
});
