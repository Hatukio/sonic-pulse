import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  formatFrameRate,
  JarvisConsole,
  patchSettings,
} from '../public/src/ui/jarvis-console.mjs';
import { restoreDesktopLyrics } from '../public/src/app.mjs';

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
    'mouseStatus', 'keyboardStatus', 'gestureStatus', 'restoreDefaults',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /id=["']gestureStatus["'][^>]*>[^<]*未来可用/i);
  assert.match(html, /id=["']mvLayer["'][^>]*\bmuted\b[^>]*\bplaysinline\b/i);
  assert.match(html, /id=["']gpuLoad["']/);
  for (const source of ['visual', 'lyrics', 'mv', 'desktop', 'performance']) {
    assert.match(html, new RegExp(`data-subsystem-status=["']${source}["']`), `missing ${source} status row`);
  }
});

test('P0 shell exposes provider selector and cross-platform planned sources', async () => {
  const html = await readFile(new URL('public/index.html', root), 'utf8');
  assert.match(html, /id=["']providerStrip["']/);
  for (const provider of ['netease', 'qq', 'qishui', 'apple']) {
    assert.match(html, new RegExp(`data-provider=["']${provider}["']`), `missing provider ${provider}`);
  }
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
    '--glass-blur: 28px',
    '.aurora-field',
    '.vinyl-shelf',
    '.vinyl-record',
    '.playback-actions',
    '.playback-more-popover',
    '.jarvis-hero',
    '.console-card',
    '.desktop-preset-grid',
    '.quality-segmented',
    '.provider-strip',
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
