const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadPreload(fileName) {
  const exposed = {};
  const calls = [];
  const removed = [];
  const listeners = new Map();
  const ipcRenderer = {
    invoke(channel, payload) {
      calls.push([channel, payload]);
      return Promise.resolve({ ok: true });
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    removeListener(channel, listener) {
      removed.push([channel, listener]);
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
  };
  const contextBridge = {
    exposeInMainWorld(name, value) {
      exposed[name] = value;
    },
  };
  const code = fs.readFileSync(path.join(root, fileName), 'utf8');
  vm.runInNewContext(code, {
    require(specifier) {
      assert.equal(specifier, 'electron');
      return { contextBridge, ipcRenderer };
    },
    process: { platform: 'darwin' },
    Object,
  }, { filename: fileName });
  return { exposed, calls, removed, listeners };
}

test('main preload exposes desktop placement commands and an unsubscribable layout result', async () => {
  const harness = loadPreload('preload.js');
  assert.deepEqual(Object.keys(harness.exposed.electronAPI).sort(), ['desktopLyrics', 'hud', 'openLogin', 'platform', 'setCookie', 'wallpaperEngine']);
  const api = harness.exposed.electronAPI.desktopLyrics;
  assert.deepEqual(Object.keys(api).sort(), ['applyPreset', 'close', 'displays', 'layout', 'lock', 'onLayoutResult', 'open', 'reset', 'setDisplay', 'state']);

  await api.open({ x: 10, y: 20, width: 900, height: 240 });
  await api.close();
  await api.layout(true);
  await api.lock(true);
  await api.applyPreset('center', '88');
  await api.state({ current: { text: 'glow' } });
  await api.displays();
  await api.setDisplay('88');
  await api.reset('88', 'bottom');
  let layoutResult = null;
  const unsubscribe = api.onLayoutResult(result => { layoutResult = result; });
  const listener = harness.listeners.get('desktop-lyrics:layout-result');
  listener({}, { bounds: { x: 1 } });
  assert.equal(layoutResult.bounds.x, 1);
  unsubscribe();
  assert.deepEqual(harness.calls, [
    ['desktop-lyrics:open', { x: 10, y: 20, width: 900, height: 240 }],
    ['desktop-lyrics:close', undefined],
    ['desktop-lyrics:set-layout-mode', true],
    ['desktop-lyrics:set-lock', true],
    ['desktop-lyrics:apply-preset', { placement: 'center', displayId: '88' }],
    ['desktop-lyrics:state', { current: { text: 'glow' } }],
    ['desktop-lyrics:list-displays', undefined],
    ['desktop-lyrics:set-display', '88'],
    ['desktop-lyrics:reset', { displayId: '88', placement: 'bottom' }],
  ]);
});

test('main preload exposes narrow Wallpaper Engine and transparent HUD APIs', async () => {
  const harness = loadPreload('preload.js');
  const wallpaper = harness.exposed.electronAPI.wallpaperEngine;
  const hud = harness.exposed.electronAPI.hud;
  assert.deepEqual(Object.keys(wallpaper).sort(), ['open', 'scan', 'status']);
  assert.deepEqual(Object.keys(hud).sort(), ['onState', 'setState', 'state']);

  await wallpaper.status();
  await wallpaper.scan();
  await wallpaper.open('C:/wallpaper/project.json');
  await hud.setState({ surfaceMode: 'transparent', clickThrough: true });
  await hud.state();

  let hudState = null;
  const unsubscribe = hud.onState(state => { hudState = state; });
  const listener = harness.listeners.get('hud:state');
  listener({}, { surfaceMode: 'transparent' });
  assert.equal(hudState.surfaceMode, 'transparent');
  unsubscribe();

  assert.deepEqual(harness.calls, [
    ['wallpaper-engine:status', undefined],
    ['wallpaper-engine:scan', undefined],
    ['wallpaper-engine:open', 'C:/wallpaper/project.json'],
    ['hud:set-state', { surfaceMode: 'transparent', clickThrough: true }],
    ['hud:get-state', undefined],
  ]);
  assert.deepEqual(harness.removed[0], ['hud:state', listener]);
});

test('desktop preload has a narrow API and listeners are unsubscribable', async () => {
  const harness = loadPreload('desktop-preload.js');
  const api = harness.exposed.desktopLyricsAPI;
  assert.deepEqual(Object.keys(api).sort(), ['finishLayout', 'onState', 'setBounds']);

  let received = null;
  const unsubscribe = api.onState(state => { received = state; });
  const listener = harness.listeners.get('desktop-lyrics:state');
  listener({}, { current: { text: 'Light' } });
  assert.equal(received.current.text, 'Light');
  unsubscribe();
  assert.equal(harness.listeners.has('desktop-lyrics:state'), false);
  assert.deepEqual(harness.removed[0], ['desktop-lyrics:state', listener]);

  await api.setBounds({ x: 1, y: 2, width: 500, height: 180 });
  await api.finishLayout();
  assert.deepEqual(harness.calls, [
    ['desktop-lyrics:set-bounds', { x: 1, y: 2, width: 500, height: 180 }],
    ['desktop-lyrics:set-layout-mode', false],
  ]);
});

test('desktop lyric window and IPC use the hardened Electron contract', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  for (const channel of [
    'desktop-lyrics:open',
    'desktop-lyrics:close',
    'desktop-lyrics:set-layout-mode',
    'desktop-lyrics:set-lock',
    'desktop-lyrics:apply-preset',
    'desktop-lyrics:set-bounds',
    'desktop-lyrics:state',
    'desktop-lyrics:list-displays',
    'desktop-lyrics:set-display',
    'desktop-lyrics:reset',
    'desktop-lyrics:layout-result',
    'wallpaper-engine:status',
    'wallpaper-engine:scan',
    'wallpaper-engine:open',
    'hud:set-state',
    'hud:get-state',
    'hud:state',
  ]) assert.match(main, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(main, /transparent:\s*true/);
  assert.match(main, /frame:\s*false/);
  assert.match(main, /alwaysOnTop:\s*true/);
  assert.match(main, /skipTaskbar:\s*true/);
  assert.match(main, /focusable:\s*false/);
  assert.match(main, /hasShadow:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setIgnoreMouseEvents\(true,\s*\{\s*forward:\s*true\s*\}\)/);
  assert.match(main, /setAlwaysOnTop\(true,\s*'screen-saver'\)/);
  assert.match(main, /setVisibleOnAllWorkspaces\(true/);
  assert.match(main, /CommandOrControl\+Shift\+H/);
  assert.match(main, /setIgnoreMouseEvents\(hudState\.clickThrough,\s*\{\s*forward:\s*true\s*\}\)/);
  assert.match(main, /http:\/\/localhost:\$\{PORT\}\/desktop-lyrics\.html/);
  assert.match(main, /event\.sender/);
  assert.match(main, /function boundsForPlacement/);
  assert.match(main, /process\.platform === 'win32'/);
  assert.match(main, /function applyDesktopLyricsBounds/);
  assert.match(main, /rememberDesktopLyricsBounds[\s\S]*applyDesktopLyricsBounds/);
  assert.match(main, /desktopLyricsBounds\s*=\s*normalizeForDisplay\(requestedBounds\s*\?\?\s*desktopLyricsBounds\)/);
  assert.match(main, /applyDesktopLyricsBounds\(desktopLyricsBounds\)/);
  assert.doesNotMatch(main, /if\s*\(requestedBounds\s*!==\s*undefined\)/);
});

test('Electron startup waits for HTTP health and handles startup failure', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /waitForServer/);
  assert.match(main, /\/api\/me/);
  assert.match(main, /\.catch\(error\s*=>/);
  assert.match(main, /showErrorBox/);
  assert.doesNotMatch(main, /setTimeout\(resolve,\s*3000\)/);
});

test('overlay document has real lyric DOM and layout-only drag and resize controls', () => {
  const html = fs.readFileSync(path.join(root, 'public/desktop-lyrics.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/styles/desktop-lyrics.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'public/src/desktop/desktop-lyrics.mjs'), 'utf8');
  assert.match(html, /id="lyricPrev"/);
  assert.match(html, /id="lyricCurrent"/);
  assert.match(html, /id="lyricNext"/);
  assert.match(html, /data-resize="nw"/);
  assert.match(html, /data-resize="ne"/);
  assert.match(html, /data-resize="sw"/);
  assert.match(html, /data-resize="se"/);
  assert.match(html, /id="lockState"/);
  assert.match(css, /-webkit-app-region:\s*drag/);
  assert.match(css, /body\[data-locked="true"\]/);
  assert.match(css, /body:not\(\.layout-mode\)/);
  assert.match(renderer, /\.onState\(/);
  assert.match(renderer, /\.setBounds\(/);
  assert.match(renderer, /dataset\.locked/);
  assert.match(renderer, /--desktop-opacity/);
  assert.match(renderer, /--motion-phase/);
  assert.doesNotMatch(css, /animation\s*:/);
});

test('desktop lyric runtime files are included in packaged builds', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.author, 'Sonic Pulse');
  assert.equal(manifest.scripts['build:mac'], 'electron-builder --mac');
  assert.equal(manifest.scripts['build:win'], 'electron-builder --win');
  assert.equal(manifest.build.mac.icon, 'build/icon.icns');
  assert.equal(manifest.build.win.icon, 'build/icon.ico');
  assert.ok(fs.existsSync(path.join(root, 'build/icon.png')));
  assert.ok(fs.existsSync(path.join(root, 'build/icon.icns')));
  assert.ok(fs.existsSync(path.join(root, 'build/icon.ico')));
  assert.ok(manifest.build.files.includes('desktop-preload.js'));
  assert.ok(manifest.build.files.includes('desktop-lyrics-state.js'));
  assert.ok(manifest.build.files.includes('wallpaper-engine.js'));
  assert.ok(manifest.build.files.includes('server-health.js'));
  assert.ok(manifest.build.files.includes('server/providers/**/*'));
  assert.ok(manifest.build.files.includes('server/assistant/**/*'));
  assert.ok(manifest.build.files.includes('public/**/*'));
  assert.ok(manifest.build.win.target.some(target => target.target === 'nsis'));
  assert.deepEqual(manifest.build.nsis, {
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Sonic Pulse',
  });
});
