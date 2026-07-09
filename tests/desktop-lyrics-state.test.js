const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeDesktopBounds,
  sameDesktopBounds,
  sanitizeDesktopLyricState,
} = require('../desktop-lyrics-state');

test('keeps the lyric window visible on the selected display', () => {
  assert.deepEqual(
    normalizeDesktopBounds(
      { x: -5000, y: 9000, width: 80, height: 40 },
      { x: 0, y: 0, width: 1920, height: 1080 },
    ),
    { x: 0, y: 960, width: 320, height: 120 },
  );
});

test('preserves valid positions on displays with negative coordinates', () => {
  assert.deepEqual(
    normalizeDesktopBounds(
      { x: -1800, y: -40, width: 900, height: 240 },
      { x: -1920, y: -100, width: 1920, height: 1080 },
    ),
    { x: -1800, y: -40, width: 900, height: 240 },
  );
});

test('uses safe defaults for non-finite bounds and preserves zero coordinates', () => {
  assert.deepEqual(
    normalizeDesktopBounds(
      { x: 0, y: 0, width: Number.NaN, height: Number.POSITIVE_INFINITY },
      { x: 0, y: 0, width: 1600, height: 900 },
    ),
    { x: 0, y: 0, width: 900, height: 240 },
  );
});

test('caps oversized bounds to a small selected work area', () => {
  assert.deepEqual(
    normalizeDesktopBounds(
      { x: -9999, y: -9999, width: 99999, height: 99999 },
      { x: -1280, y: 100, width: 1280, height: 720 },
    ),
    { x: -1280, y: 100, width: 1280, height: 720 },
  );
});

test('rejects a malformed display work area', () => {
  assert.throws(
    () => normalizeDesktopBounds({}, { x: 0, y: 0, width: Number.NaN, height: 900 }),
    /valid work area/i,
  );
  assert.throws(
    () => normalizeDesktopBounds({}, { x: 0, y: 0, width: 0, height: 900 }),
    /valid work area/i,
  );
});

test('compares normalized bounds without treating partial objects as equal', () => {
  assert.equal(
    sameDesktopBounds(
      { x: -1280, y: 0, width: 900, height: 240 },
      { x: -1280, y: 0, width: 900, height: 240 },
    ),
    true,
  );
  assert.equal(
    sameDesktopBounds(
      { x: -1280, y: 0, width: 900, height: 240 },
      { x: -1279, y: 0, width: 900, height: 240 },
    ),
    false,
  );
  assert.equal(sameDesktopBounds({ x: 0 }, { x: 0 }), false);
});

test('sanitizes lyric state into a bounded serializable payload', () => {
  const state = sanitizeDesktopLyricState({
    current: {
      text: 'A'.repeat(700),
      translation: '星光',
      words: [
        { text: 'A', start: 1, end: 2 },
        { text: 'B', start: Number.NaN, end: Number.POSITIVE_INFINITY },
      ],
    },
    prev: { text: 'before', translation: 42 },
    next: { text: 'after' },
    lineIndex: 3.8,
    wordIndex: 1,
    progress: 4,
    intensity: -2,
    style: 'energy',
    personality: 'impact',
    palette: ['#65FAFF', 'red', '#12345678', '#fff', '#000000'],
    ignored: () => {},
  });

  assert.equal(state.current.text.length, 500);
  assert.deepEqual(state.current.words, [
    { text: 'A', start: 1, end: 2 },
    { text: 'B', start: 0, end: 0 },
  ]);
  assert.deepEqual(state.prev, { text: 'before', translation: '', words: [] });
  assert.equal(state.lineIndex, 3);
  assert.equal(state.wordIndex, 1);
  assert.equal(state.progress, 1);
  assert.equal(state.intensity, 0);
  assert.equal(state.locked, true);
  assert.equal(state.placement, 'bottom');
  assert.deepEqual(state.palette, ['#65faff', '#12345678', '#ffffff', '#000000']);
  assert.equal(JSON.stringify(state).includes('ignored'), false);
  assert.doesNotThrow(() => structuredClone(state));
});

test('falls back from invalid presentation fields without accepting hostile values', () => {
  const state = sanitizeDesktopLyricState({
    current: 'not a line',
    progress: Number.NaN,
    intensity: Number.POSITIVE_INFINITY,
    style: 'javascript:alert(1)',
    personality: 'url(bad)',
    palette: { 0: '#fff' },
  });

  assert.deepEqual(state, {
    current: null,
    prev: null,
    next: null,
    lineIndex: -1,
    wordIndex: -1,
    progress: 0,
    style: 'depth',
    personality: 'auto',
    palette: ['#65faff', '#ffb45e'],
    intensity: 0.8,
    opacity: 0.88,
    locked: true,
    placement: 'bottom',
    motionPhase: 0,
    audioEnergy: 0,
  });
});

test('sanitizes desktop opacity and scheduler-driven motion fields', () => {
  const state = sanitizeDesktopLyricState({ opacity: 0.05, motionPhase: 1.7, audioEnergy: 0.42 });
  assert.equal(state.opacity, 0.2);
  assert.equal(state.motionPhase, 1);
  assert.equal(state.audioEnergy, 0.42);
  assert.equal(sanitizeDesktopLyricState({ opacity: 0.73 }).opacity, 0.73);
});
