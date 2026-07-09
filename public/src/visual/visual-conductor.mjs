const FEATURE_NAMES = Object.freeze([
  'bass',
  'mid',
  'treble',
  'onset',
  'dynamicRange',
]);
const DEFAULT_DELTA_SECONDS = 1 / 60;
const MAX_DELTA_SECONDS = 0.1;

const clampUnit = (value) => {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
};

const normalizeFeatures = (features = {}) => Object.fromEntries(
  FEATURE_NAMES.map((name) => [name, clampUnit(features?.[name])]),
);

export const classifyPersonality = (features = {}) => {
  const normalized = normalizeFeatures(features);
  const { bass, mid, treble, onset } = normalized;
  const energy = (bass * 0.45) + (mid * 0.35) + (treble * 0.2);

  if (onset > 0.68 && energy > 0.58) return 'impact';
  if (energy < 0.24 && onset < 0.25) return 'ambient';
  if (bass < 0.45 && mid > bass && onset < 0.5) return 'fluid';
  return 'pop';
};

const normalizeSmoothing = (value) => {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return 0.14;
  return Math.min(1, Math.max(0, numeric));
};

const normalizeDeltaSeconds = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_DELTA_SECONDS;
  return Math.min(MAX_DELTA_SECONDS, Math.max(0, numeric));
};

export class VisualConductor {
  #features;

  constructor() {
    this.#features = normalizeFeatures();
    this.personality = 'ambient';
  }

  update(next = {}, smoothing = 0.14, deltaSeconds = DEFAULT_DELTA_SECONDS) {
    const normalized = normalizeFeatures(next);
    const amount = normalizeSmoothing(smoothing);
    const elapsed = normalizeDeltaSeconds(deltaSeconds);
    const alpha = 1 - ((1 - amount) ** (elapsed * 60));

    for (const name of FEATURE_NAMES) {
      this.#features[name] += (normalized[name] - this.#features[name]) * alpha;
    }

    this.personality = classifyPersonality(this.#features);
    return { ...this.#features, personality: this.personality };
  }
}
