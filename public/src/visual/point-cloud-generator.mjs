const DEFAULTS = Object.freeze({
  count: 70000,
  seed: 1,
  depth: 1,
});

const assertPositiveInteger = (value, name) => {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  if (value <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
};

const assertFiniteNumber = (value, name) => {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number`);
  }
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
};

const hashNumber = (value) => {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, true);

  let hash = 2166136261;
  for (let index = 0; index < 8; index += 1) {
    hash ^= view.getUint8(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createRandom = (seed) => {
  let state = hashNumber(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const normalizeChannel = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(255, Math.max(0, numeric)) / 255;
};

const hasVisibleAlpha = (rgba, pixelIndex) => {
  const alpha = Number(rgba[(pixelIndex * 4) + 3]);
  return Number.isFinite(alpha) && alpha > 0;
};

const buildWeightedSampler = (pixelIndices, sampleWeights) => {
  if (sampleWeights == null) return null;
  if (!Number.isSafeInteger(sampleWeights.length) || sampleWeights.length < pixelIndices.at(-1) + 1) {
    throw new RangeError('sampleWeights is shorter than width * height');
  }

  const cumulative = new Float64Array(pixelIndices.length);
  let total = 0;
  for (let index = 0; index < pixelIndices.length; index += 1) {
    const weight = Number(sampleWeights[pixelIndices[index]]);
    if (Number.isFinite(weight) && weight > 0) total += weight;
    cumulative[index] = total;
  }
  if (total <= 0) return null;

  return (unitValue) => {
    const target = unitValue * total;
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (cumulative[middle] > target) high = middle;
      else low = middle + 1;
    }
    return pixelIndices[low];
  };
};

export const buildPointCloudData = (rgba, width, height, options = {}) => {
  assertPositiveInteger(width, 'width');
  assertPositiveInteger(height, 'height');

  if (rgba == null || !Number.isSafeInteger(rgba.length) || rgba.length < 0) {
    throw new TypeError('rgba must be array-like');
  }

  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount)) {
    throw new RangeError('image dimensions are too large');
  }
  if (rgba.length < pixelCount * 4) {
    throw new RangeError('rgba is shorter than width * height * 4');
  }

  const count = options.count ?? DEFAULTS.count;
  const seed = options.seed ?? DEFAULTS.seed;
  const depth = options.depth ?? DEFAULTS.depth;
  assertPositiveInteger(count, 'count');
  assertFiniteNumber(seed, 'seed');
  assertFiniteNumber(depth, 'depth');

  const visiblePixels = [];
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    if (hasVisibleAlpha(rgba, pixelIndex)) visiblePixels.push(pixelIndex);
  }

  const samplePool = visiblePixels.length > 0 ? visiblePixels : null;
  const poolSize = samplePool?.length ?? pixelCount;
  const pixelIndices = samplePool ?? Array.from({ length: pixelCount }, (_, index) => index);
  const weightedSample = buildWeightedSampler(pixelIndices, options.sampleWeights);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const ids = new Float32Array(count);
  const random = createRandom(seed);
  const aspect = width / height;

  for (let pointIndex = 0; pointIndex < count; pointIndex += 1) {
    const sample = random();
    const sampledIndex = Math.floor(sample * poolSize);
    const pixelIndex = weightedSample?.(sample) ?? samplePool?.[sampledIndex] ?? sampledIndex;
    const pixelOffset = pixelIndex * 4;
    const pointOffset = pointIndex * 3;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const red = normalizeChannel(rgba[pixelOffset]);
    const green = normalizeChannel(rgba[pixelOffset + 1]);
    const blue = normalizeChannel(rgba[pixelOffset + 2]);
    const luminance = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
    const jitter = (random() - 0.5) * depth * 0.02;

    positions[pointOffset] = (((x + 0.5) / width) - 0.5) * aspect;
    positions[pointOffset + 1] = 0.5 - ((y + 0.5) / height);
    positions[pointOffset + 2] = (luminance * depth) + jitter;
    colors[pointOffset] = red;
    colors[pointOffset + 1] = green;
    colors[pointOffset + 2] = blue;
    ids[pointIndex] = count === 1 ? 0 : pointIndex / (count - 1);
  }

  return { positions, colors, ids };
};
