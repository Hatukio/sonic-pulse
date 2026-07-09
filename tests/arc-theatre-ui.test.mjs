import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  formatFrameRate,
  JarvisConsole,
  patchSettings,
} from '../public/src/ui/jarvis-console.mjs';
import {
  assistantProviderText,
  backgroundModeText,
  buildAssistantActionItems,
  restoreDesktopLyrics,
} from '../public/src/app.mjs';

const root = new URL('../', import.meta.url);

test('Arc Theatre document exposes the semantic application contract without inline handlers', async () => {
  const html = await readFile(new URL('public/index.html', root), 'utf8');
  for (const id of ['visualStage', 'mvLayer', 'lyricStage', 'libraryRail', 'commandRail', 'playbackArc', 'energyCore', 'audio']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /<script\s+type=["']module["']\s+src=["']\/src\/app\.mjs["']/);
  assert.doesNotMatch(html, /\son\w+\s*=/i);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /<script(?![^>]*(?:\bsrc=|\btype=["']importmap["']))[^>]*>/i);
});

test('Arc Theatre shell includes real library, transport, MV, desktop, performance, and input controls', async () => {
  const html = await readFile(new URL('public/index.html', root), 'utf8');
  for (const id of [
    'loginButton', 'logoutButton', 'likedButton', 'playlistList', 'searchInput', 'localAudio',
    'previousButton', 'playButton', 'nextButton', 'seekInput', 'volumeInput', 'mvToggle',
    'desktopLyricsToggle', 'desktopLayoutButton', 'desktopLyricsLock', 'desktopPresetCenter',
    'desktopPresetBottom', 'desktopPresetLeft', 'desktopPresetRight', 'frameRateControls',
    'qualityControls', 'rendererStatus',
    'backgroundMode', 'wallpaperEngineStatus', 'wallpaperSelect', 'wallpaperRefreshButton',
    'wallpaperApplyButton',
    'surfaceMode', 'surfaceClickThroughToggle', 'surfaceOpacity',
    'jarvisCompanion', 'assistantListenButton', 'assistantProvider', 'assistantModel',
    'assistantEndpoint', 'assistantApiKey', 'assistantMood', 'assistantVoiceInput',
    'assistantVoiceOutput', 'assistantWeather', 'assistantWeatherButton', 'assistantWeatherStatus',
    'assistantPromptInput', 'assistantSendButton',
    'assistantReply', 'assistantActions',
    'mouseStatus', 'keyboardStatus', 'gestureStatus', 'gestureToggleButton',
    'gestureCameraPreview', 'restoreDefaults',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /id=["']gestureStatus["'][^>]*>[^<]*(待授权|未启用|已启用)/i);
  assert.match(html, /id=["']assistantWeatherButton["'][\s\S]*自动定位天气/i);
  assert.match(html, /id=["']mvLayer["'][^>]*\bmuted\b[^>]*\bplaysinline\b/i);
  assert.match(html, /id=["']gpuLoad["']/);
  for (const source of ['visual', 'background', 'surface', 'assistant', 'lyrics', 'mv', 'desktop', 'performance']) {
    assert.match(html, new RegExp(`data-subsystem-status=["']${source}["']`), `missing ${source} status row`);
  }
  assert.match(html, /data-surface-mode=["']immersive["']/);
  assert.match(html, /data-hud-click-through=["']false["']/);
  assert.doesNotMatch(html, /id=["']assistantApiKey["'][^>]+data-setting=/);
});

test('P0 shell exposes provider selector and cross-platform planned sources', async () => {
  const html = await readFile(new URL('public/index.html', root), 'utf8');
  assert.match(html, /id=["']providerStrip["']/);
  for (const provider of ['netease', 'qq', 'qishui', 'apple']) {
    assert.match(html, new RegExp(`data-provider=["']${provider}["']`), `missing provider ${provider}`);
  }
  assert.match(html, /data-provider=["']qq["'][^>]*(data-provider-state=["']needs-auth["']|aria-disabled=["']false["'])/);
  assert.match(html, /data-provider=["']qishui["'][^>]*(data-provider-state=["']needs-auth["']|aria-disabled=["']false["'])/);
  assert.doesNotMatch(html, /data-provider=["']qq["'][^>]*\sdisabled\b/);
  assert.doesNotMatch(html, /data-provider=["']qishui["'][^>]*\sdisabled\b/);
  assert.match(html, /data-platform=["']windows-macos["']/);
});

test('A方案 exposes a persistent glass vinyl shelf and richer playback actions', async () => {
  const html = await readFile(new URL('public/index.html', root), 'utf8');
  for (const id of [
    'vinylShelf', 'vinylShelfList', 'vinylShelfEmpty', 'favoriteButton', 'playModeButton',
    'lyricsToggleButton', 'immersiveButton', 'windowModeButton', 'moreActionsButton',
    'playbackMorePopover',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /aria-label=["']当前播放队列黑胶唱片架["']/);
  assert.match(html, /data-shelf-mode=["']vinyl["']/);
  assert.match(html, /data-background-mode=["']sonic["']/);
  assert.match(html, /data-play-mode=["']sequence["']/);
});

test('Arc Theatre stylesheet defines interactive, async, responsive, and reduced motion states', async () => {
  const css = await readFile(new URL('public/styles/arc-theatre.css', root), 'utf8');
  for (const selector of [':focus-visible', ':hover', '[aria-pressed="true"]', ':disabled', '.is-loading', '.is-error', '@media (prefers-reduced-motion: reduce)', '@media (max-width:']) {
    assert.ok(css.includes(selector), `missing CSS state ${selector}`);
  }
  assert.doesNotMatch(css, /animation\s*:/);
});

test('A方案 stylesheet defines glass vinyl shelf, aurora backdrop, and Jarvis glass tokens', async () => {
  const css = await readFile(new URL('public/styles/arc-theatre.css', root), 'utf8');
  for (const token of [
    '--glass-blur: 38px',
    '.aurora-field',
    '.ambient-depth-field',
    '.vinyl-shelf',
    '.vinyl-record',
    '.playback-actions',
    '.playback-more-popover',
    '.jarvis-hero',
    '.console-card',
    '.desktop-preset-grid',
    '.quality-segmented',
    '.provider-strip',
    '.wallpaper-actions',
    '.jarvis-companion',
    '.assistant-prompt-line',
    '.assistant-actions',
    '.assistant-weather-row',
    '.gesture-camera-panel',
    '[data-surface-mode="transparent"]',
    '[data-hud-click-through="true"]',
    '.command-rail::before',
    'backdrop-filter: blur(var(--glass-blur))',
  ]) {
    assert.ok(css.includes(token), `missing A方案 CSS token ${token}`);
  }
});

test('patchSettings updates one setting path immutably and frame labels remain honest', () => {
  const settings = {
    performance: { frameRate: 60 },
    visual: { form: 'artwork' },
  };
  const changed = patchSettings(settings, 'visual.form', 'nebula');
  assert.equal(changed.visual.form, 'nebula');
  assert.equal(changed.performance, settings.performance);
  assert.equal(settings.visual.form, 'artwork');
  assert.equal(formatFrameRate('unlocked'), 'UNLOCKED');
  assert.equal(formatFrameRate(120), '120 FPS');
  assert.equal(backgroundModeText('wallpaperEngine'), 'Wallpaper Engine');
  assert.equal(assistantProviderText('doubao'), '豆包 / 火山方舟');
});

test('AI Companion prioritizes Chinese model providers before generic OpenAI-compatible setup', async () => {
  const html = await readFile(new URL('public/index.html', root), 'utf8');
  const providerBlock = html.match(/id=["']assistantProvider["'][\s\S]*?<\/select>/)?.[0] || '';
  const order = ['value="local"', 'value="doubao"', 'value="qwen"', 'value="deepseek"', 'value="ollama"', 'value="lmstudio"', 'value="openaiCompatible"'];
  let cursor = -1;
  for (const token of order) {
    const next = providerBlock.indexOf(token);
    assert.ok(next > cursor, `provider ${token} should appear after previous provider`);
    cursor = next;
  }
  assert.match(providerBlock, /豆包/);
  assert.match(providerBlock, /通义千问/);
  assert.match(providerBlock, /DeepSeek/);
});

test('assistant action normalizer exposes safe search chips for recommendation payloads', () => {
  assert.deepEqual(buildAssistantActionItems({
    recommendations: [{ title: '雨夜 Lo-fi', query: '雨夜 Lo-fi R&B' }],
    actions: [
      { type: 'search', label: '搜索推荐音乐', keyword: '雨夜 Lo-fi R&B' },
      { type: 'open-url', label: 'bad', url: 'https://example.com' },
      { type: 'search', label: 'too long', keyword: 'x'.repeat(160) },
    ],
  }), [
    { type: 'search', label: '搜索推荐音乐', keyword: '雨夜 Lo-fi R&B' },
  ]);
});

class FakeControl {
  constructor({ id = '', type = 'button', dataset = {}, value = '', checked = false } = {}) {
    this.id = id;
    this.type = type;
    this.dataset = dataset;
    this.value = value;
    this.checked = checked;
    this.attributes = new Map();
  }

  matches(selector) {
    return selector === 'button' && this.type === 'button';
  }

  closest(selector) {
    return selector === '[data-setting][data-value]' && this.dataset.setting && this.dataset.value !== undefined
      ? this
      : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

class FakeRoot {
  constructor(controls = []) {
    this.controls = controls;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type) {
    this.listeners.delete(type);
  }

  querySelectorAll(selector) {
    return selector === '[data-setting]' ? this.controls : [];
  }

  querySelector() {
    return null;
  }

  click(target) {
    this.listeners.get('click')?.({ target });
  }
}

test('JarvisConsole segmented quality buttons dispatch a persisted settings change', () => {
  const qualityButton = new FakeControl({
    dataset: { setting: 'performance.quality', value: 'ultra' },
  });
  const root = new FakeRoot([qualityButton]);
  const jarvis = new JarvisConsole({
    root,
    settings: { performance: { frameRate: 60, quality: 'balanced' } },
  });
  let detail = null;
  jarvis.addEventListener('settingschange', event => { detail = event.detail; });

  root.click(qualityButton);

  assert.equal(detail.path, 'performance.quality');
  assert.equal(detail.value, 'ultra');
  assert.equal(detail.settings.performance.quality, 'ultra');
  assert.equal(qualityButton.getAttribute('aria-pressed'), 'true');
});

test('persisted desktop lyrics reopen with their saved bounds only when enabled', async () => {
  const calls = [];
  const api = { open(bounds) { calls.push(bounds); return Promise.resolve({ ok: true }); } };
  assert.equal(restoreDesktopLyrics({ desktopLyrics: { enabled: false, bounds: null } }, api), null);
  await restoreDesktopLyrics({ desktopLyrics: { enabled: true, bounds: { x: 1 } } }, api);
  assert.deepEqual(calls, [{ x: 1 }]);
});
