const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');
const {
  normalizeDesktopBounds,
  sameDesktopBounds,
  sanitizeDesktopLyricState,
} = require('./desktop-lyrics-state');
const { waitForServer } = require('./server-health');
const {
  buildStatus: buildWallpaperEngineStatus,
  openWallpaper: openWallpaperEngineFile,
  scanLibrary: scanWallpaperEngineLibrary,
} = require('./wallpaper-engine');

const PORT = 19527;
const DESKTOP_PLACEMENTS = new Set(['center', 'bottom', 'left', 'right']);
let mainWindow = null;
let desktopLyricsWindow = null;
let serverChild = null;
let desktopLyricsLayoutMode = false;
let desktopLyricsBounds = null;
let desktopLyricState = sanitizeDesktopLyricState({});
let hudState = { surfaceMode: 'immersive', clickThrough: false, alwaysOnTop: false };

function liveWindow(window) {
  return window && !window.isDestroyed();
}

function senderIs(event, window) {
  return liveWindow(window) && event.sender === window.webContents;
}

function requireSender(event, ...windows) {
  if (!windows.some(window => senderIs(event, window))) {
    throw new Error('Unauthorized desktop lyrics IPC sender');
  }
}

function displayForBounds(bounds) {
  const fallback = desktopLyricsBounds || {};
  const x = Number.isFinite(bounds?.x) ? bounds.x : fallback.x;
  const y = Number.isFinite(bounds?.y) ? bounds.y : fallback.y;
  const width = Number.isFinite(bounds?.width) ? bounds.width : fallback.width;
  const height = Number.isFinite(bounds?.height) ? bounds.height : fallback.height;
  if ([x, y, width, height].every(Number.isFinite)) {
    return screen.getDisplayNearestPoint({
      x: Math.round(x + width / 2),
      y: Math.round(y + height / 2),
    });
  }
  return screen.getPrimaryDisplay();
}

function displayById(displayId) {
  const id = String(displayId ?? '');
  return screen.getAllDisplays().find(display => String(display.id) === id) || null;
}

function displayDescriptor(display, index) {
  return {
    id: String(display.id),
    label: `显示器 ${index + 1} · ${display.size.width}×${display.size.height}`,
    workArea: { ...display.workArea },
    bounds: { ...display.bounds },
  };
}

function normalizePlacement(value) {
  return DESKTOP_PLACEMENTS.has(value) ? value : 'bottom';
}

function boundsForPlacement(display, placement = 'bottom') {
  const workArea = display.workArea;
  const preset = normalizePlacement(placement);
  const margin = Math.max(24, Math.round(Math.min(workArea.width, workArea.height) * 0.035));
  const base = normalizeDesktopBounds({
    width: desktopLyricsBounds?.width,
    height: desktopLyricsBounds?.height,
  }, workArea);
  const wideWidth = Math.min(Math.max(880, Math.round(workArea.width * 0.72)), Math.max(320, workArea.width - margin * 2));
  const edgeWidth = Math.min(Math.max(360, Math.round(workArea.width * 0.32)), Math.max(320, workArea.width - margin * 2));
  const lowHeight = Math.min(Math.max(180, base.height), Math.max(120, Math.round(workArea.height * 0.24)));
  const centerHeight = Math.min(Math.max(220, base.height), Math.max(120, Math.round(workArea.height * 0.32)));

  if (preset === 'center') {
    return normalizeDesktopBounds({
      x: workArea.x + (workArea.width - wideWidth) / 2,
      y: workArea.y + (workArea.height - centerHeight) / 2,
      width: wideWidth,
      height: centerHeight,
    }, workArea);
  }
  if (preset === 'left' || preset === 'right') {
    return normalizeDesktopBounds({
      x: preset === 'left' ? workArea.x + margin : workArea.x + workArea.width - edgeWidth - margin,
      y: workArea.y + (workArea.height - centerHeight) / 2,
      width: edgeWidth,
      height: centerHeight,
    }, workArea);
  }
  return normalizeDesktopBounds({
    x: workArea.x + (workArea.width - wideWidth) / 2,
    y: workArea.y + workArea.height - lowHeight - Math.max(44, Math.round(margin * 1.8)),
    width: wideWidth,
    height: lowHeight,
  }, workArea);
}

function defaultBoundsForDisplay(display) {
  return boundsForPlacement(display, desktopLyricState.placement);
}

function notifyDesktopLayoutResult() {
  if (!liveWindow(mainWindow)) return;
  mainWindow.webContents.send('desktop-lyrics:layout-result', {
    layoutMode: desktopLyricsLayoutMode,
    bounds: desktopLyricsBounds,
  });
}

function normalizeForDisplay(bounds) {
  const display = displayForBounds(bounds);
  return normalizeDesktopBounds(bounds || desktopLyricsBounds, display.workArea);
}

function sendDesktopLyricState() {
  if (!liveWindow(desktopLyricsWindow) || desktopLyricsWindow.webContents.isLoading()) return;
  desktopLyricsWindow.webContents.send('desktop-lyrics:state', {
    ...desktopLyricState,
    layoutMode: desktopLyricsLayoutMode,
    locked: !desktopLyricsLayoutMode,
  });
}

function applyDesktopLyricsBounds(bounds) {
  if (!liveWindow(desktopLyricsWindow) || sameDesktopBounds(desktopLyricsWindow.getBounds(), bounds)) return;
  desktopLyricsWindow.setBounds(bounds);
}

function rememberDesktopLyricsBounds() {
  if (!liveWindow(desktopLyricsWindow)) return;
  const bounds = desktopLyricsWindow.getBounds();
  desktopLyricsBounds = normalizeDesktopBounds(bounds, displayForBounds(bounds).workArea);
  applyDesktopLyricsBounds(desktopLyricsBounds);
}

function setDesktopLyricsLayoutMode(enabled) {
  desktopLyricsLayoutMode = enabled;
  if (!liveWindow(desktopLyricsWindow)) return;
  if (enabled) {
    desktopLyricsWindow.setFocusable(true);
    desktopLyricsWindow.setIgnoreMouseEvents(false);
    desktopLyricsWindow.show();
    desktopLyricsWindow.focus();
  } else {
    desktopLyricsWindow.setIgnoreMouseEvents(true, { forward: true });
    desktopLyricsWindow.setFocusable(false);
  }
  desktopLyricState = sanitizeDesktopLyricState({ ...desktopLyricState, locked: !enabled });
  sendDesktopLyricState();
}

function createDesktopLyricsWindow(requestedBounds) {
  if (liveWindow(desktopLyricsWindow)) return desktopLyricsWindow;
  const bounds = normalizeForDisplay(requestedBounds || desktopLyricsBounds);
  desktopLyricsBounds = bounds;
  desktopLyricsWindow = new BrowserWindow({
    ...bounds,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'desktop-preload.js'),
    },
  });
  try {
    desktopLyricsWindow.setAlwaysOnTop(true, 'screen-saver');
    desktopLyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (_error) {}
  desktopLyricsWindow.setIgnoreMouseEvents(true, { forward: true });
  desktopLyricsWindow.loadURL(`http://localhost:${PORT}/desktop-lyrics.html`);
  desktopLyricsWindow.webContents.on('did-finish-load', sendDesktopLyricState);
  desktopLyricsWindow.on('move', rememberDesktopLyricsBounds);
  desktopLyricsWindow.on('resize', rememberDesktopLyricsBounds);
  desktopLyricsWindow.on('closed', () => {
    desktopLyricsWindow = null;
    desktopLyricsLayoutMode = false;
  });
  return desktopLyricsWindow;
}

// ─── 启动内嵌服务器 ───────────────────────────────────────────────
function probeServer() {
  return new Promise(resolve => {
    let settled = false;
    const finish = healthy => {
      if (settled) return;
      settled = true;
      resolve(healthy);
    };
    const request = http.get({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/me',
      timeout: 800,
    }, response => {
      response.resume();
      finish(response.statusCode === 200);
    });
    request.on('timeout', () => request.destroy(new Error('Health probe timed out')));
    request.on('error', () => finish(false));
  });
}

function stopServer() {
  const child = serverChild;
  serverChild = null;
  if (!child || child.killed) return;
  try { child.kill(); } catch (_error) {}
}

async function startServer() {
  serverChild = fork(path.join(__dirname, 'server.js'), [], {
    env: { ...process.env, PORT: String(PORT) },
    silent: true,
  });
  serverChild.stdout?.on('data', data => process.stdout.write(`[srv] ${data}`));
  serverChild.stderr?.on('data', data => process.stderr.write(`[srv err] ${data}`));
  serverChild.on('error', error => console.error('[srv error]', error));
  try {
    await waitForServer({ child: serverChild, probe: probeServer });
  } catch (error) {
    stopServer();
    throw error;
  }
}

// ─── 主窗口 ───────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 620,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#00000000',
    transparent: true,
    hasShadow: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 允许麦克风（备用：本地MP3可视化）
  mainWindow.webContents.session.setPermissionRequestHandler((wc, perm, cb) => {
    cb(perm === 'media');
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function applyHudState(next = {}) {
  hudState = {
    surfaceMode: next.surfaceMode === 'transparent' ? 'transparent' : 'immersive',
    clickThrough: Boolean(next.clickThrough),
    alwaysOnTop: Boolean(next.alwaysOnTop || next.surfaceMode === 'transparent'),
  };
  if (liveWindow(mainWindow)) {
    mainWindow.setIgnoreMouseEvents(hudState.clickThrough, { forward: true });
    try {
      mainWindow.setAlwaysOnTop(hudState.alwaysOnTop, hudState.alwaysOnTop ? 'floating' : 'normal');
      mainWindow.setVisibleOnAllWorkspaces(hudState.surfaceMode === 'transparent', { visibleOnFullScreen: true });
    } catch (_error) {}
    mainWindow.webContents.send('hud:state', hudState);
  }
  return { ok: true, ...hudState };
}

// ─── IPC：打开登录窗口，提取 Cookie ──────────────────────────────
ipcMain.handle('open-login', async () => {
  return new Promise((resolve) => {
    const loginWin = new BrowserWindow({
      width: 900, height: 700,
      title: '登录网易云音乐',
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    loginWin.loadURL('https://music.163.com');

    // 每秒检查是否已登录（出现 MUSIC_U Cookie 即表示登录成功）
    const timer = setInterval(async () => {
      try {
        const cookies = await loginWin.webContents.session.cookies.get({
          url: 'https://music.163.com', name: 'MUSIC_U'
        });
        if (cookies.length > 0) {
          clearInterval(timer);
          // 获取所有 Cookie 拼成字符串
          const all = await loginWin.webContents.session.cookies.get({ url: 'https://music.163.com' });
          const cookieStr = all.map(c => `${c.name}=${c.value}`).join('; ');
          loginWin.close();
          resolve({ cookie: cookieStr });
        }
      } catch(e) {}
    }, 1000);

    loginWin.on('closed', () => { clearInterval(timer); resolve({ cookie: null }); });
  });
});

// ─── IPC：通知服务器更新 Cookie ──────────────────────────────────
ipcMain.handle('set-cookie', async (event, cookie) => {
  return new Promise((resolve) => {
    const req = http.request({ hostname: 'localhost', port: PORT, path: '/api/set-cookie', method: 'POST',
      headers: { 'Content-Type': 'application/json' } }, (res) => {
      res.on('data', () => {}); res.on('end', () => resolve({ ok: true }));
    });
    req.on('error', () => resolve({ ok: false }));
    req.write(JSON.stringify({ cookie }));
    req.end();
  });
});

// ─── IPC：安全的桌面歌词透明窗口 ──────────────────────────────────
ipcMain.handle('desktop-lyrics:open', async (event, requestedBounds) => {
  requireSender(event, mainWindow);
  const window = createDesktopLyricsWindow(requestedBounds);
  desktopLyricsBounds = normalizeForDisplay(requestedBounds ?? desktopLyricsBounds);
  applyDesktopLyricsBounds(desktopLyricsBounds);
  setDesktopLyricsLayoutMode(false);
  window.showInactive();
  sendDesktopLyricState();
  return { ok: true, bounds: desktopLyricsBounds };
});

ipcMain.handle('desktop-lyrics:close', async (event) => {
  requireSender(event, mainWindow);
  if (liveWindow(desktopLyricsWindow)) {
    rememberDesktopLyricsBounds();
    setDesktopLyricsLayoutMode(false);
    desktopLyricsWindow.hide();
  }
  return { ok: true, bounds: desktopLyricsBounds };
});

ipcMain.handle('desktop-lyrics:set-layout-mode', async (event, enabled) => {
  requireSender(event, mainWindow, desktopLyricsWindow);
  if (typeof enabled !== 'boolean') throw new TypeError('Layout mode must be a boolean');
  if (senderIs(event, desktopLyricsWindow) && enabled) {
    throw new Error('Desktop overlay may only finish layout mode');
  }
  const window = createDesktopLyricsWindow(desktopLyricsBounds);
  if (!window.isVisible()) window.showInactive();
  setDesktopLyricsLayoutMode(enabled);
  if (!enabled) {
    rememberDesktopLyricsBounds();
    if (liveWindow(mainWindow)) mainWindow.focus();
    if (senderIs(event, desktopLyricsWindow)) notifyDesktopLayoutResult();
  }
  return { ok: true, layoutMode: desktopLyricsLayoutMode, bounds: desktopLyricsBounds };
});

ipcMain.handle('desktop-lyrics:set-lock', async (event, locked) => {
  requireSender(event, mainWindow);
  if (typeof locked !== 'boolean') throw new TypeError('Desktop lyrics lock must be a boolean');
  const window = createDesktopLyricsWindow(desktopLyricsBounds);
  if (!window.isVisible()) window.showInactive();
  setDesktopLyricsLayoutMode(!locked);
  if (locked) rememberDesktopLyricsBounds();
  return { ok: true, locked, layoutMode: desktopLyricsLayoutMode, bounds: desktopLyricsBounds };
});

ipcMain.handle('desktop-lyrics:list-displays', async (event) => {
  requireSender(event, mainWindow);
  return { ok: true, displays: screen.getAllDisplays().map(displayDescriptor) };
});

ipcMain.handle('desktop-lyrics:set-display', async (event, displayId) => {
  requireSender(event, mainWindow);
  const display = displayById(displayId);
  if (!display) throw new TypeError('Unknown desktop lyrics display');
  desktopLyricsBounds = defaultBoundsForDisplay(display);
  if (liveWindow(desktopLyricsWindow)) applyDesktopLyricsBounds(desktopLyricsBounds);
  return { ok: true, displayId: String(display.id), bounds: desktopLyricsBounds };
});

ipcMain.handle('desktop-lyrics:apply-preset', async (event, payload = {}) => {
  requireSender(event, mainWindow);
  const display = displayById(payload.displayId) || displayForBounds(desktopLyricsBounds);
  const placement = normalizePlacement(payload.placement);
  desktopLyricState = sanitizeDesktopLyricState({ ...desktopLyricState, placement });
  desktopLyricsBounds = boundsForPlacement(display, placement);
  if (liveWindow(desktopLyricsWindow)) applyDesktopLyricsBounds(desktopLyricsBounds);
  return { ok: true, displayId: String(display.id), placement, bounds: desktopLyricsBounds };
});

ipcMain.handle('desktop-lyrics:reset', async (event, payload = {}) => {
  requireSender(event, mainWindow);
  const displayId = typeof payload === 'object' && payload !== null ? payload.displayId : payload;
  const placement = normalizePlacement(typeof payload === 'object' && payload !== null ? payload.placement : desktopLyricState.placement);
  const display = displayById(displayId) || displayForBounds(desktopLyricsBounds);
  desktopLyricState = sanitizeDesktopLyricState({ ...desktopLyricState, placement });
  desktopLyricsBounds = boundsForPlacement(display, placement);
  if (liveWindow(desktopLyricsWindow)) {
    applyDesktopLyricsBounds(desktopLyricsBounds);
    setDesktopLyricsLayoutMode(false);
  }
  return { ok: true, displayId: String(display.id), placement, bounds: desktopLyricsBounds };
});

ipcMain.handle('desktop-lyrics:set-bounds', async (event, requestedBounds) => {
  requireSender(event, desktopLyricsWindow);
  if (!desktopLyricsLayoutMode) throw new Error('Bounds can only change in layout mode');
  desktopLyricsBounds = normalizeForDisplay(requestedBounds);
  applyDesktopLyricsBounds(desktopLyricsBounds);
  return { ok: true, bounds: desktopLyricsBounds };
});

ipcMain.handle('desktop-lyrics:state', async (event, nextState) => {
  requireSender(event, mainWindow);
  desktopLyricState = sanitizeDesktopLyricState(nextState);
  sendDesktopLyricState();
  return { ok: true };
});

ipcMain.handle('hud:set-state', async (event, nextState = {}) => {
  requireSender(event, mainWindow);
  return applyHudState(nextState);
});

ipcMain.handle('hud:get-state', async (event) => {
  requireSender(event, mainWindow);
  return { ok: true, ...hudState };
});

// ─── IPC：Wallpaper Engine 背景控制（Windows）────────────────────
ipcMain.handle('wallpaper-engine:status', async (event) => {
  requireSender(event, mainWindow);
  return buildWallpaperEngineStatus();
});

ipcMain.handle('wallpaper-engine:scan', async (event) => {
  requireSender(event, mainWindow);
  const status = buildWallpaperEngineStatus();
  return {
    status,
    ...scanWallpaperEngineLibrary(status),
  };
});

ipcMain.handle('wallpaper-engine:open', async (event, filePath) => {
  requireSender(event, mainWindow);
  const status = buildWallpaperEngineStatus();
  return openWallpaperEngineFile(filePath, status);
});

// ─── 应用生命周期 ─────────────────────────────────────────────────
app.whenReady()
  .then(async () => {
    await startServer();
    createWindow();
    globalShortcut.register('CommandOrControl+Shift+H', () => {
      applyHudState({ ...hudState, clickThrough: false });
      if (liveWindow(mainWindow)) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    app.on('activate', () => { if (!mainWindow) createWindow(); });
  })
  .catch(error => {
    console.error('Sonic Pulse startup failed', error);
    stopServer();
    dialog.showErrorBox('Sonic Pulse 启动失败', error?.message || '本地服务未能启动');
    app.quit();
  });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  if (liveWindow(desktopLyricsWindow)) desktopLyricsWindow.destroy();
  stopServer();
});
