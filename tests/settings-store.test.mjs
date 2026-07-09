import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../public/src/core/settings-store.mjs';

test('normalizes invalid visual settings without overriding a valid frame rate', () => {
  assert.deepEqual(normalizeSettings({
    version: 1,
    performance: { frameRate: 120 },
    visual: { personality: 'unknown', particleCount: -4 },
    background: { mode: 'wallpaperEngine', wallpaperEngine: { selectedFile: 'C:/wall/project.json', autoApply: true } },
  }), {
    ...DEFAULT_SETTINGS,
    performance: { ...DEFAULT_SETTINGS.performance, frameRate: 120 },
    background: {
      ...DEFAULT_SETTINGS.background,
      mode: 'wallpaperEngine',
      wallpaperEngine: { selectedFile: 'C:/wall/project.json', autoApply: true },
    },
  });
});

test('accepts an unlocked frame rate and desktop lyric placement', () => {
  const settings = normalizeSettings({
    performance: { frameRate: 'unlocked', quality: 'ultra', autoQuality: false },
    desktopLyrics: {
      enabled: true,
      opacity: 0.72,
      locked: false,
      placement: 'center',
      displayId: '2',
      bounds: { x: 10, y: 20, width: 900, height: 240 },
    },
  });

  assert.equal(settings.performance.frameRate, 'unlocked');
  assert.deepEqual(settings.performance, {
    frameRate: 'unlocked',
    quality: 'ultra',
    autoQuality: false,
  });
  assert.deepEqual(settings.desktopLyrics, {
    ...DEFAULT_SETTINGS.desktopLyrics,
    enabled: true,
    opacity: 0.72,
    locked: false,
    placement: 'center',
    displayId: '2',
    bounds: { x: 10, y: 20, width: 900, height: 240 },
  });
});

test('clamps numeric settings and accepts supported visual and lyric choices', () => {
  const settings = normalizeSettings({
    visual: {
      form: 'ribbons',
      personality: 'fluid',
      particleCount: 200000,
      depth: -1,
      bloom: 2,
      trails: 1,
      camera: 'manual',
    },
    lyrics: {
      style: 'energy',
      intensity: -1,
      size: 2,
    },
    desktopLyrics: {
      opacity: 0,
      intensity: 2,
      locked: 'nope',
      placement: 'corner',
      bounds: { x: 4, y: 8, width: 100, height: 50 },
    },
  });

  assert.deepEqual(settings.visual, {
    form: 'ribbons',
    personality: 'fluid',
    particleCount: 180000,
    depth: 0,
    bloom: 1.5,
    trails: 0.95,
    camera: 'manual',
  });
  assert.equal(settings.lyrics.style, 'energy');
  assert.equal(settings.lyrics.intensity, 0);
  assert.equal(settings.lyrics.size, 1.8);
  assert.equal(settings.desktopLyrics.opacity, 0.2);
  assert.equal(settings.desktopLyrics.intensity, 1);
  assert.equal(settings.desktopLyrics.locked, DEFAULT_SETTINGS.desktopLyrics.locked);
  assert.equal(settings.desktopLyrics.placement, DEFAULT_SETTINGS.desktopLyrics.placement);
  assert.deepEqual(settings.desktopLyrics.bounds, { x: 4, y: 8, width: 320, height: 120 });
});

test('normalizes performance quality and desktop lyric presets for cross-platform app use', () => {
  const settings = normalizeSettings({
    performance: { quality: 'eco', autoQuality: true },
    desktopLyrics: { placement: 'right', locked: true },
  });

  assert.equal(settings.performance.quality, 'eco');
  assert.equal(settings.performance.autoQuality, true);
  assert.equal(settings.desktopLyrics.placement, 'right');
  assert.equal(settings.desktopLyrics.locked, true);

  const fallback = normalizeSettings({
    performance: { quality: 'cinema', autoQuality: 'yes' },
    desktopLyrics: { placement: 'floating', locked: 'true' },
  });
  assert.equal(fallback.performance.quality, DEFAULT_SETTINGS.performance.quality);
  assert.equal(fallback.performance.autoQuality, DEFAULT_SETTINGS.performance.autoQuality);
  assert.equal(fallback.desktopLyrics.placement, DEFAULT_SETTINGS.desktopLyrics.placement);
  assert.equal(fallback.desktopLyrics.locked, DEFAULT_SETTINGS.desktopLyrics.locked);
});

test('rounds fractional particle counts to a valid buffer size', () => {
  assert.equal(normalizeSettings({ visual: { particleCount: 54321.6 } }).visual.particleCount, 54322);
  assert.equal(normalizeSettings({ visual: { particleCount: 9999.6 } }).visual.particleCount, 10000);
});

test('always disables MV when normalizing persisted settings', () => {
  assert.deepEqual(normalizeSettings({ mv: { enabled: true } }).mv, { enabled: false });
});

test('normalizes background source choices and limits persisted wallpaper paths', () => {
  const longPath = 'x'.repeat(3000);
  const settings = normalizeSettings({
    background: {
      mode: 'web',
      wallpaperEngine: { selectedFile: longPath, autoApply: 'yes' },
      localVideo: { objectUrl: longPath },
      web: { url: 'https://example.com/wallpaper.html' },
    },
  });

  assert.equal(settings.background.mode, 'web');
  assert.equal(settings.background.wallpaperEngine.selectedFile.length, 2048);
  assert.equal(settings.background.wallpaperEngine.autoApply, DEFAULT_SETTINGS.background.wallpaperEngine.autoApply);
  assert.equal(settings.background.localVideo.objectUrl.length, 2048);
  assert.equal(settings.background.web.url, 'https://example.com/wallpaper.html');
  assert.equal(normalizeSettings({ background: { mode: 'steam' } }).background.mode, DEFAULT_SETTINGS.background.mode);
});

test('normalizes transparent HUD and assistant provider choices without persisting API keys', () => {
  const longWeather = '杭州 小雨 18℃ ' + 'x'.repeat(300);
  const settings = normalizeSettings({
    surface: {
      mode: 'transparent',
      clickThrough: true,
      opacity: 2,
    },
    assistant: {
      enabled: true,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      endpoint: 'https://api.deepseek.com',
      mood: 'focus',
      weather: longWeather,
      voiceInput: false,
      voiceOutput: true,
      apiKey: 'must-not-persist',
    },
  });

  assert.deepEqual(settings.surface, {
    mode: 'transparent',
    clickThrough: true,
    opacity: 1,
  });
  assert.deepEqual(settings.assistant, {
    enabled: true,
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    endpoint: 'https://api.deepseek.com',
    mood: 'focus',
    weather: longWeather.slice(0, 120),
    voiceInput: false,
    voiceOutput: true,
  });
  assert.equal(Object.hasOwn(settings.assistant, 'apiKey'), false);

  const fallback = normalizeSettings({
    surface: { mode: 'invisible', opacity: 0 },
    assistant: { provider: 'free-cloud', mood: 'chaos' },
  });
  assert.deepEqual(fallback.surface, {
    ...DEFAULT_SETTINGS.surface,
    opacity: 0.15,
  });
  assert.equal(fallback.assistant.provider, DEFAULT_SETTINGS.assistant.provider);
  assert.equal(fallback.assistant.mood, DEFAULT_SETTINGS.assistant.mood);
});

test('loadSettings falls back safely when persisted JSON is malformed', () => {
  const requestedKeys = [];
  const storage = {
    getItem(key) {
      requestedKeys.push(key);
      return '{not valid JSON';
    },
  };

  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  assert.deepEqual(requestedKeys, [SETTINGS_KEY]);
});

test('saveSettings writes and returns normalized settings', () => {
  const writes = [];
  const storage = {
    setItem(key, value) {
      writes.push([key, value]);
    },
  };

  const settings = saveSettings({
    performance: { frameRate: 30 },
    mv: { enabled: true },
  }, storage);

  assert.equal(settings.performance.frameRate, 30);
  assert.equal(settings.mv.enabled, false);
  assert.deepEqual(writes, [[SETTINGS_KEY, JSON.stringify(settings)]]);
});

test('nested default mutations cannot alter future normalization', () => {
  const canonicalDefaults = normalizeSettings({});
  const mutations = [
    () => { DEFAULT_SETTINGS.visual.form = 'nebula'; },
    () => { DEFAULT_SETTINGS.lyrics.intensity = 0; },
    () => { DEFAULT_SETTINGS.desktopLyrics.opacity = 0.2; },
  ];

  for (const mutate of mutations) {
    try {
      mutate();
    } catch (error) {
      assert.ok(error instanceof TypeError);
    }
  }

  assert.deepEqual(normalizeSettings({}), canonicalDefaults);
});
