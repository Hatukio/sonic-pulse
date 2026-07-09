import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPointCloudData } from '../public/src/visual/point-cloud-generator.mjs';

const makeImage = (width, height, pixel) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba.set(pixel, index * 4);
  }
  return rgba;
};

test('same seed reproduces positions while a different seed changes them', () => {
  const rgba = makeImage(3, 2, [64, 128, 192, 255]);
  const first = buildPointCloudData(rgba, 3, 2, { count: 64, seed: 12 });
  const repeat = buildPointCloudData(rgba, 3, 2, { count: 64, seed: 12 });
  const changed = buildPointCloudData(rgba, 3, 2, { count: 64, seed: 13 });

  assert.deepEqual(first.positions, repeat.positions);
  assert.deepEqual(first.colors, repeat.colors);
  assert.deepEqual(first.ids, repeat.ids);
  assert.ok(first.positions.some((value, index) => value !== changed.positions[index]));
});

test('different seeds change depth jitter when pixel selection is held constant', () => {
  const rgba = new Uint8ClampedArray([120, 80, 40, 255]);
  const first = buildPointCloudData(rgba, 1, 1, { count: 12, seed: 21, depth: 1 });
  const changed = buildPointCloudData(rgba, 1, 1, { count: 12, seed: 22, depth: 1 });

  for (let index = 0; index < first.positions.length; index += 3) {
    assert.equal(first.positions[index], changed.positions[index]);
    assert.equal(first.positions[index + 1], changed.positions[index + 1]);
  }
  assert.deepEqual(first.colors, changed.colors);
  assert.deepEqual(first.ids, changed.ids);
  assert.ok(
    first.positions.some((value, index) => index % 3 === 2 && value !== changed.positions[index]),
  );
});

test('returns sized float buffers with normalized colors and stable ids without mutating input', () => {
  const rgba = new Uint8ClampedArray([
    0, 64, 255, 255,
    255, 128, 32, 255,
  ]);
  const before = rgba.slice();
  const result = buildPointCloudData(rgba, 2, 1, { count: 25, seed: 9 });

  assert.ok(result.positions instanceof Float32Array);
  assert.ok(result.colors instanceof Float32Array);
  assert.ok(result.ids instanceof Float32Array);
  assert.equal(result.positions.length, 75);
  assert.equal(result.colors.length, 75);
  assert.equal(result.ids.length, 25);
  assert.ok(result.colors.every((value) => value >= 0 && value <= 1));
  assert.ok(result.ids.every((value) => value >= 0 && value <= 1));
  assert.equal(result.ids[0], 0);
  assert.equal(result.ids.at(-1), 1);
  assert.deepEqual(rgba, before);
});

test('samples opaque pixels instead of transparent alternatives', () => {
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 0,
    0, 255, 0, 255,
  ]);
  const { colors } = buildPointCloudData(rgba, 2, 1, { count: 50, seed: 4 });

  for (let index = 0; index < colors.length; index += 3) {
    assert.deepEqual(Array.from(colors.subarray(index, index + 3)), [0, 1, 0]);
  }
});

test('supports deterministic weighted sampling for edge-emphasized artwork', () => {
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 255,
  ]);
  const sampleWeights = new Float32Array([0, 1]);
  const first = buildPointCloudData(rgba, 2, 1, {
    count: 32,
    seed: 6,
    sampleWeights,
  });
  const repeat = buildPointCloudData(rgba, 2, 1, {
    count: 32,
    seed: 6,
    sampleWeights,
  });

  assert.deepEqual(first, repeat);
  for (let index = 0; index < first.colors.length; index += 3) {
    assert.deepEqual(Array.from(first.colors.subarray(index, index + 3)), [0, 1, 0]);
  }
});

test('centers image coordinates with aspect ratio preserved', () => {
  const rgba = new Uint8ClampedArray([
    255, 255, 255, 255,
    0, 0, 0, 0,
  ]);
  const { positions } = buildPointCloudData(rgba, 2, 1, {
    count: 1,
    seed: 1,
    depth: 0,
  });

  assert.deepEqual(Array.from(positions), [-0.5, 0, 0]);
});

test('uses luminance to derive depth', () => {
  const black = buildPointCloudData(
    new Uint8ClampedArray([0, 0, 0, 255]),
    1,
    1,
    { count: 1, seed: 7, depth: 2 },
  );
  const white = buildPointCloudData(
    new Uint8ClampedArray([255, 255, 255, 255]),
    1,
    1,
    { count: 1, seed: 7, depth: 2 },
  );

  assert.ok(white.positions[2] > black.positions[2] + 1.9);
});

test('rejects invalid image dimensions', () => {
  const rgba = new Uint8ClampedArray(16);

  assert.throws(() => buildPointCloudData(rgba, 0, 1), RangeError);
  assert.throws(() => buildPointCloudData(rgba, 1.5, 1), TypeError);
  assert.throws(() => buildPointCloudData(rgba, 1, -1), RangeError);
});

test('rejects missing or undersized RGBA buffers', () => {
  assert.throws(() => buildPointCloudData(null, 1, 1), TypeError);
  assert.throws(() => buildPointCloudData(new Uint8Array(7), 2, 1), RangeError);
});

test('rejects invalid count, seed, and depth options', () => {
  const rgba = new Uint8ClampedArray(4);

  assert.throws(() => buildPointCloudData(rgba, 1, 1, { count: 0 }), RangeError);
  assert.throws(() => buildPointCloudData(rgba, 1, 1, { count: 1.5 }), TypeError);
  assert.throws(() => buildPointCloudData(rgba, 1, 1, { seed: Infinity }), RangeError);
  assert.throws(() => buildPointCloudData(rgba, 1, 1, { depth: Number.NaN }), RangeError);
});
