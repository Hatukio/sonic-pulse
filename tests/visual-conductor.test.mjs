import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyPersonality,
  VisualConductor,
} from '../public/src/visual/visual-conductor.mjs';

const calm = { bass: 0.08, mid: 0.12, treble: 0.1, onset: 0.05, dynamicRange: 0.1 };

const assertClose = (actual, expected, tolerance = 1e-10) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test('classifies calm input as ambient', () => {
  assert.equal(classifyPersonality(calm), 'ambient');
});

test('classifies energetic input with a strong onset as impact', () => {
  assert.equal(classifyPersonality({
    bass: 0.92,
    mid: 0.78,
    treble: 0.84,
    onset: 0.95,
    dynamicRange: 0.86,
  }), 'impact');
});

test('classifies moderately energetic mid-forward input as fluid', () => {
  assert.equal(classifyPersonality({
    bass: 0.38,
    mid: 0.78,
    treble: 0.4,
    onset: 0.34,
    dynamicRange: 0.5,
  }), 'fluid');
});

test('classifies typical balanced input as pop', () => {
  assert.equal(classifyPersonality({
    bass: 0.54,
    mid: 0.5,
    treble: 0.58,
    onset: 0.36,
    dynamicRange: 0.48,
  }), 'pop');
});

test('uses weighted band energy and the exact impact onset threshold', () => {
  assert.equal(classifyPersonality({
    bass: 0.7,
    mid: 0.7,
    treble: 0.6,
    onset: 0.7,
    dynamicRange: 0,
  }), 'impact');
  assert.equal(classifyPersonality({
    bass: 1,
    mid: 1,
    treble: 1,
    onset: 0.68,
    dynamicRange: 1,
  }), 'pop');
  assert.equal(classifyPersonality({
    bass: 0.58,
    mid: 0.58,
    treble: 0.58,
    onset: 1,
    dynamicRange: 1,
  }), 'pop');
});

test('ignores dynamic range and uses strict ambient boundaries', () => {
  assert.equal(classifyPersonality({
    bass: 0.2,
    mid: 0.2,
    treble: 0.2,
    onset: 0.24,
    dynamicRange: 1,
  }), 'ambient');
  assert.equal(classifyPersonality({
    bass: 0.24,
    mid: 0.24,
    treble: 0.24,
    onset: 0.1,
    dynamicRange: 0,
  }), 'pop');
  assert.equal(classifyPersonality({
    bass: 0.1,
    mid: 0.1,
    treble: 0.1,
    onset: 0.25,
    dynamicRange: 0,
  }), 'pop');
});

test('classifies fluid using only bass, mid, and onset boundaries', () => {
  assert.equal(classifyPersonality({
    bass: 0.44,
    mid: 0.45,
    treble: 1,
    onset: 0.49,
    dynamicRange: 1,
  }), 'fluid');
  assert.equal(classifyPersonality({
    bass: 0.45,
    mid: 0.9,
    treble: 0,
    onset: 0.4,
    dynamicRange: 0,
  }), 'pop');
  assert.equal(classifyPersonality({
    bass: 0.2,
    mid: 0.8,
    treble: 0.2,
    onset: 0.5,
    dynamicRange: 1,
  }), 'pop');
});

test('normalizes nonfinite classification inputs safely', () => {
  const personality = classifyPersonality({
    bass: Number.NaN,
    mid: Infinity,
    treble: -Infinity,
    onset: Number.NaN,
    dynamicRange: Infinity,
  });

  assert.ok(['ambient', 'pop', 'impact', 'fluid'].includes(personality));
});

test('initializes at silence and exponentially smooths feature updates', () => {
  const conductor = new VisualConductor();

  assert.deepEqual(conductor.update({}, 0), { ...calm, bass: 0, mid: 0, treble: 0, onset: 0, dynamicRange: 0, personality: 'ambient' });
  assert.deepEqual(conductor.update({
    bass: 1,
    mid: 0.8,
    treble: 0.6,
    onset: 0.4,
    dynamicRange: 0.2,
  }, 0.5), {
    bass: 0.5,
    mid: 0.4,
    treble: 0.3,
    onset: 0.2,
    dynamicRange: 0.1,
    personality: 'pop',
  });
});

test('clamps smoothing to the zero-to-one range', () => {
  const conductor = new VisualConductor();

  const unchanged = conductor.update({ bass: 1, mid: 1, treble: 1, onset: 1, dynamicRange: 1 }, -5);
  assert.equal(unchanged.bass, 0);

  const immediate = conductor.update({ bass: 1, mid: 1, treble: 1, onset: 1, dynamicRange: 1 }, 5);
  assert.equal(immediate.bass, 1);
  assert.equal(immediate.personality, 'impact');
});

test('smooths the same one-second step consistently across render cadences', () => {
  const target = { bass: 0.9, mid: 0.9, treble: 0.9, onset: 0.9, dynamicRange: 0.9 };
  const simulate = (hz) => {
    const conductor = new VisualConductor();
    let state;
    for (let frame = 0; frame < hz; frame += 1) {
      state = conductor.update(target, 0.14, 1 / hz);
    }
    return state;
  };
  const at30Hz = simulate(30);
  const at60Hz = simulate(60);
  const at120Hz = simulate(120);

  for (const name of ['bass', 'mid', 'treble', 'onset', 'dynamicRange']) {
    assertClose(at30Hz[name], at60Hz[name]);
    assertClose(at120Hz[name], at60Hz[name]);
  }
  assert.equal(at30Hz.personality, at60Hz.personality);
  assert.equal(at120Hz.personality, at60Hz.personality);
});

test('clamps elapsed time to a safe range', () => {
  const target = { bass: 1, mid: 1, treble: 1, onset: 1, dynamicRange: 1 };
  const conductor = new VisualConductor();

  const noElapsedTime = conductor.update(target, 0.5, -1);
  assert.equal(noElapsedTime.bass, 0);

  const capped = conductor.update(target, 0.5, 0.2);
  assertClose(capped.bass, 1 - (0.5 ** 6));
});

test('returns defensive copies and keeps updated features finite', () => {
  const conductor = new VisualConductor();
  const first = conductor.update({
    bass: Infinity,
    mid: Number.NaN,
    treble: -Infinity,
    onset: 0.5,
    dynamicRange: 0.5,
  }, 1);

  for (const name of ['bass', 'mid', 'treble', 'onset', 'dynamicRange']) {
    assert.equal(Number.isFinite(first[name]), true);
  }

  first.bass = 0.123;
  first.personality = 'ambient';
  const second = conductor.update(first, 0);

  assert.equal(second.bass, 1);
  assert.notEqual(second, first);
  assert.equal(second.personality, classifyPersonality(second));
});
