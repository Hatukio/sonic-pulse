export const SETTINGS_KEY = 'sonic-pulse:settings:v1';

function deepFreeze(value) {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === 'object') {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value);
}

export const DEFAULT_SETTINGS = deepFreeze({
  version: 1,
  performance: {
    frameRate: 60,
    quality: 'balanced',
    autoQuality: true,
  },
  visual: {
    form: 'artwork',
    personality: 'auto',
    particleCount: 70000,
    depth: 1,
    bloom: 0.65,
    trails: 0.45,
    camera: 'cinematic',
  },
  lyrics: {
    enabled: true,
    style: 'auto',
    intensity: 0.8,
    size: 1,
    translation: true,
  },
  mv: { enabled: false },
  desktopLyrics: {
    enabled: false,
    locked: true,
    placement: 'bottom',
    opacity: 0.88,
    intensity: 0.7,
    displayId: null,
    bounds: null,
  },
});

const FRAME_RATES = new Set([30, 60, 120, 'unlocked']);
const PERFORMANCE_QUALITIES = new Set(['eco', 'balanced', 'ultra']);
const FORMS = new Set(['artwork', 'nebula', 'tunnel', 'ribbons']);
const PERSONALITIES = new Set(['auto', 'ambient', 'pop', 'impact', 'fluid']);
const CAMERAS = new Set(['locked', 'orbit', 'cinematic', 'manual']);
const LYRIC_STYLES = new Set(['auto', 'depth', 'orbit', 'particles', 'energy']);
const DESKTOP_PLACEMENTS = new Set(['center', 'bottom', 'left', 'right']);

function objectOrEmpty(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function choice(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function finite(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function particleCount(value) {
  return Number.isFinite(value) && value >= 0
    ? Math.min(180000, Math.max(10000, Math.round(value)))
    : DEFAULT_SETTINGS.visual.particleCount;
}

function normalizeBounds(value) {
  const candidate = objectOrEmpty(value);
  if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(candidate[key]))) {
    return null;
  }

  return {
    x: candidate.x,
    y: candidate.y,
    width: Math.max(320, candidate.width),
    height: Math.max(120, candidate.height),
  };
}

export function normalizeSettings(input = {}) {
  const source = objectOrEmpty(input);
  const performance = objectOrEmpty(source.performance);
  const visual = objectOrEmpty(source.visual);
  const lyrics = objectOrEmpty(source.lyrics);
  const desktopLyrics = objectOrEmpty(source.desktopLyrics);

  return {
    version: 1,
    performance: {
      frameRate: choice(
        performance.frameRate,
        FRAME_RATES,
        DEFAULT_SETTINGS.performance.frameRate,
      ),
      quality: choice(
        performance.quality,
        PERFORMANCE_QUALITIES,
        DEFAULT_SETTINGS.performance.quality,
      ),
      autoQuality: boolean(performance.autoQuality, DEFAULT_SETTINGS.performance.autoQuality),
    },
    visual: {
      form: choice(visual.form, FORMS, DEFAULT_SETTINGS.visual.form),
      personality: choice(
        visual.personality,
        PERSONALITIES,
        DEFAULT_SETTINGS.visual.personality,
      ),
      particleCount: particleCount(visual.particleCount),
      depth: finite(visual.depth, DEFAULT_SETTINGS.visual.depth, 0, 2),
      bloom: finite(visual.bloom, DEFAULT_SETTINGS.visual.bloom, 0, 1.5),
      trails: finite(visual.trails, DEFAULT_SETTINGS.visual.trails, 0, 0.95),
      camera: choice(visual.camera, CAMERAS, DEFAULT_SETTINGS.visual.camera),
    },
    lyrics: {
      enabled: boolean(lyrics.enabled, DEFAULT_SETTINGS.lyrics.enabled),
      style: choice(lyrics.style, LYRIC_STYLES, DEFAULT_SETTINGS.lyrics.style),
      intensity: finite(lyrics.intensity, DEFAULT_SETTINGS.lyrics.intensity, 0, 1),
      size: finite(lyrics.size, DEFAULT_SETTINGS.lyrics.size, 0.6, 1.8),
      translation: boolean(lyrics.translation, DEFAULT_SETTINGS.lyrics.translation),
    },
    mv: { enabled: false },
    desktopLyrics: {
      enabled: boolean(desktopLyrics.enabled, DEFAULT_SETTINGS.desktopLyrics.enabled),
      locked: boolean(desktopLyrics.locked, DEFAULT_SETTINGS.desktopLyrics.locked),
      placement: choice(
        desktopLyrics.placement,
        DESKTOP_PLACEMENTS,
        DEFAULT_SETTINGS.desktopLyrics.placement,
      ),
      opacity: finite(desktopLyrics.opacity, DEFAULT_SETTINGS.desktopLyrics.opacity, 0.2, 1),
      intensity: finite(desktopLyrics.intensity, DEFAULT_SETTINGS.desktopLyrics.intensity, 0, 1),
      displayId: desktopLyrics.displayId == null ? null : String(desktopLyrics.displayId),
      bounds: normalizeBounds(desktopLyrics.bounds),
    },
  };
}

export function loadSettings(storage = localStorage) {
  try {
    return normalizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY) || '{}'));
  } catch {
    return normalizeSettings();
  }
}

export function saveSettings(settings, storage = localStorage) {
  const normalized = normalizeSettings(settings);
  storage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}
