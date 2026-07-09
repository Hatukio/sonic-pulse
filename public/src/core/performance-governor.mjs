export const PERFORMANCE_QUALITY_PROFILES = Object.freeze({
  eco: Object.freeze({
    label: '低功耗',
    renderScale: 0.78,
    particleMultiplier: 0.62,
    bloomMultiplier: 0.72,
    trailsMultiplier: 0.72,
  }),
  balanced: Object.freeze({
    label: '均衡',
    renderScale: 1,
    particleMultiplier: 1,
    bloomMultiplier: 1,
    trailsMultiplier: 1,
  }),
  ultra: Object.freeze({
    label: '极致',
    renderScale: 1.18,
    particleMultiplier: 1.18,
    bloomMultiplier: 1.12,
    trailsMultiplier: 1.08,
  }),
});

const QUALITY_ORDER = Object.freeze(['eco', 'balanced', 'ultra']);

export function normalizePerformanceQuality(value, fallback = 'balanced') {
  return Object.hasOwn(PERFORMANCE_QUALITY_PROFILES, value) ? value : fallback;
}

export function performanceProfileFor(value) {
  return PERFORMANCE_QUALITY_PROFILES[normalizePerformanceQuality(value)];
}

export function nextLowerQuality(value) {
  const quality = normalizePerformanceQuality(value);
  const index = QUALITY_ORDER.indexOf(quality);
  return QUALITY_ORDER[Math.max(0, index - 1)] || 'eco';
}

export function qualityAdjustedVisualSettings(settings = {}) {
  const profile = performanceProfileFor(settings.performance?.quality);
  const visual = settings.visual || {};
  const particleCount = Number.isFinite(visual.particleCount) ? visual.particleCount : 70000;
  const bloom = Number.isFinite(visual.bloom) ? visual.bloom : 0.65;
  const trails = Number.isFinite(visual.trails) ? visual.trails : 0.45;
  return {
    ...settings,
    performance: {
      ...(settings.performance || {}),
      renderScale: profile.renderScale,
    },
    visual: {
      ...visual,
      particleCount: Math.max(10000, Math.round(particleCount * profile.particleMultiplier)),
      bloom: Math.max(0, Math.min(1.5, bloom * profile.bloomMultiplier)),
      trails: Math.max(0, Math.min(0.95, trails * profile.trailsMultiplier)),
    },
  };
}

export function recommendPerformanceQuality({
  quality = 'balanced',
  autoQuality = true,
  target = 60,
  measuredFps = 0,
  lowSince = null,
  now = 0,
  sustainMs = 5000,
  holdUntil = 0,
} = {}) {
  const normalized = normalizePerformanceQuality(quality);
  if (!autoQuality || target === 'unlocked' || !Number.isFinite(target) || !Number.isFinite(measuredFps)) {
    return { quality: normalized, changed: false, reason: '' };
  }
  if (Number.isFinite(holdUntil) && now < holdUntil) {
    return { quality: normalized, changed: false, reason: '' };
  }
  if (measuredFps >= target * 0.7 || !Number.isFinite(lowSince) || now - lowSince < sustainMs) {
    return { quality: normalized, changed: false, reason: '' };
  }
  const next = nextLowerQuality(normalized);
  if (next === normalized) return { quality: normalized, changed: false, reason: '' };
  return {
    quality: next,
    changed: true,
    reason: `已将画质从 ${normalized} 调整为 ${next} 以稳定帧率`,
  };
}
