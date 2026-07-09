import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceMorph,
  cameraPose,
  clampDevicePixelRatio,
  computeEdgeWeights,
  proceduralArtwork,
  layeredRhythmProfile,
  resolveForm,
  segmentedPulseProfile,
  syncGeometryAttribute,
} from '../public/src/visual/scene-engine.mjs';

test('procedural fallback palette adopts a valid provider accent', () => {
  const cyan = proceduralArtwork(8, '#00ccff');
  const amber = proceduralArtwork(8, '#ff8844');
  const center = ((4 * 8) + 4) * 4;
  assert.ok(cyan.data[center + 2] > cyan.data[center]);
  assert.ok(amber.data[center] > amber.data[center + 2]);
  assert.equal(cyan.data[center + 3], 255);
});

test('camera modes produce bounded distinct poses and manual follows normalized input', () => {
  assert.deepEqual(cameraPose('locked', 4, 1, { x: 1, y: -1 }), { x: 0, y: 0, z: 3.2 });
  assert.notDeepEqual(cameraPose('orbit', 4, 0, { x: 0, y: 0 }), cameraPose('cinematic', 4, 0, { x: 0, y: 0 }));
  assert.deepEqual(cameraPose('manual', 4, 0, { x: 1, y: -1 }), { x: 0.22, y: -0.14, z: 3.2 });
});

test('clamps renderer pixel ratio to two and rejects invalid values safely', () => {
  assert.equal(clampDevicePixelRatio(3), 2);
  assert.equal(clampDevicePixelRatio(1.5), 1.5);
  assert.equal(clampDevicePixelRatio(0), 1);
  assert.equal(clampDevicePixelRatio(Number.NaN), 1);
});

test('resolves supported forms and falls back to artwork', () => {
  assert.equal(resolveForm('artwork'), 0);
  assert.equal(resolveForm('nebula'), 1);
  assert.equal(resolveForm('tunnel'), 2);
  assert.equal(resolveForm('ribbons'), 3);
  assert.equal(resolveForm('unknown'), 0);
});

test('advances smooth form interpolation consistently across frame rates', () => {
  const simulate = (hz) => {
    let value = 0;
    for (let frame = 0; frame < hz; frame += 1) {
      value = advanceMorph(value, 1, 1 / hz);
    }
    return value;
  };

  assert.ok(Math.abs(simulate(30) - simulate(120)) < 1e-10);
  assert.equal(advanceMorph(0.4, 1, 0), 0.4);
  assert.ok(advanceMorph(0, 1, 1 / 60) > 0);
});

test('assigns stronger weights to high-contrast image edges', () => {
  const rgba = new Uint8ClampedArray([
    0, 0, 0, 255,
    0, 0, 0, 255,
    255, 255, 255, 255,
  ]);
  const weights = computeEdgeWeights(rgba, 3, 1);

  assert.equal(weights.length, 3);
  assert.ok(weights[1] > weights[0]);
  assert.ok(weights[2] > weights[0]);
  assert.ok(weights.every((value) => value > 0));
});

test('segmented pulse maps low, mid, and high energy into different particle lanes', () => {
  const low = segmentedPulseProfile(0.08, { bass: 1, mid: 0, treble: 0, onset: 0 }, 1);
  const mid = segmentedPulseProfile(0.45, { bass: 0, mid: 1, treble: 0, onset: 0 }, 1);
  const high = segmentedPulseProfile(0.86, { bass: 0, mid: 0, treble: 1, onset: 0 }, 1);

  assert.ok(low.depth > mid.depth, 'bass lane should drive depth more than mid lane');
  assert.ok(mid.twist > low.twist, 'mid lane should drive twist more than bass lane');
  assert.ok(high.sparkle > mid.sparkle, 'treble lane should drive sparkle more than mid lane');
});

test('layered rhythm profile separates bass impact, mid wave, treble glitter, and beat shockwave', () => {
  const quiet = layeredRhythmProfile({ bass: 0, mid: 0, treble: 0, onset: 0 }, 0);
  const loud = layeredRhythmProfile({ bass: 0.9, mid: 0.7, treble: 0.8, onset: 1 }, 1.25);

  assert.ok(loud.bassImpact > quiet.bassImpact);
  assert.ok(loud.midWave > quiet.midWave);
  assert.ok(loud.trebleGlitter > quiet.trebleGlitter);
  assert.ok(loud.shockwave > quiet.shockwave);
  assert.ok(loud.layerSpread > quiet.layerSpread);
});

test('releases an old GPU attribute before replacing a different-length buffer', () => {
  const events = [];
  const existing = { array: new Float32Array(3) };
  const geometry = {
    getAttribute() { return existing; },
    setAttribute(name, attribute) { events.push(['set', name, attribute]); },
  };
  const rendererAttributes = {
    remove(attribute) { events.push(['remove', attribute]); },
  };
  const replacement = new Float32Array(6);

  syncGeometryAttribute({
    geometry,
    rendererAttributes,
    name: 'position',
    data: replacement,
    itemSize: 3,
    createAttribute: (array, itemSize) => ({ array, itemSize }),
  });

  assert.deepEqual(events, [
    ['remove', existing],
    ['set', 'position', { array: replacement, itemSize: 3 }],
  ]);
});
