'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const WALLPAPER_ENGINE_APP_ID = '431960';
const WALLPAPER_EXTENSIONS = new Set(['.json', '.pkg', '.mp4', '.webm', '.html']);
const MAX_WALLPAPERS = 240;

function exists(filePath, fsImpl = fs) {
  try {
    fsImpl.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readText(filePath, fsImpl = fs) {
  try { return fsImpl.readFileSync(filePath, 'utf8'); }
  catch { return ''; }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseSteamLibraries(steamDir, fsImpl = fs) {
  const configPath = path.join(steamDir, 'steamapps', 'libraryfolders.vdf');
  const text = readText(configPath, fsImpl);
  const roots = [steamDir];
  for (const match of text.matchAll(/"path"\s+"([^"]+)"/g)) {
    roots.push(match[1].replace(/\\\\/g, '\\'));
  }
  return unique(roots);
}

function candidateSteamDirs(env = process.env) {
  return unique([
    env.STEAM_DIR,
    env.STEAM_PATH,
    env.SteamPath,
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Steam'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Steam'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ]);
}

function wallpaperExecutable(installDir, fsImpl = fs) {
  for (const name of ['wallpaper64.exe', 'wallpaper32.exe']) {
    const candidate = path.join(installDir, name);
    if (exists(candidate, fsImpl)) return candidate;
  }
  return '';
}

function buildStatus({ env = process.env, platform = process.platform, fsImpl = fs } = {}) {
  if (platform !== 'win32') {
    return {
      ok: true,
      platform,
      available: false,
      reason: 'Wallpaper Engine desktop control is available on Windows only.',
      exePath: '',
      installDir: '',
      workshopRoots: [],
      userProjectRoots: [],
    };
  }

  const steamRoots = [];
  for (const steamDir of candidateSteamDirs(env)) {
    if (!exists(steamDir, fsImpl)) continue;
    steamRoots.push(...parseSteamLibraries(steamDir, fsImpl));
  }

  const roots = unique(steamRoots);
  const installs = unique([
    env.WALLPAPER_ENGINE_DIR,
    ...roots.map(root => path.join(root, 'steamapps', 'common', 'wallpaper_engine')),
  ]);

  for (const installDir of installs) {
    if (!installDir || !exists(installDir, fsImpl)) continue;
    const exePath = wallpaperExecutable(installDir, fsImpl);
    if (!exePath) continue;
    return {
      ok: true,
      platform,
      available: true,
      reason: '',
      exePath,
      installDir,
      workshopRoots: roots
        .map(root => path.join(root, 'steamapps', 'workshop', 'content', WALLPAPER_ENGINE_APP_ID))
        .filter(root => exists(root, fsImpl)),
      userProjectRoots: [
        path.join(installDir, 'projects', 'myprojects'),
        path.join(os.homedir(), 'Documents', 'Wallpaper Engine', 'projects', 'myprojects'),
      ].filter(root => exists(root, fsImpl)),
    };
  }

  return {
    ok: true,
    platform,
    available: false,
    reason: 'Wallpaper Engine was not found in common Steam library locations.',
    exePath: '',
    installDir: '',
    workshopRoots: roots
      .map(root => path.join(root, 'steamapps', 'workshop', 'content', WALLPAPER_ENGINE_APP_ID))
      .filter(root => exists(root, fsImpl)),
    userProjectRoots: [],
  };
}

function safeJson(filePath, fsImpl = fs) {
  try { return JSON.parse(fsImpl.readFileSync(filePath, 'utf8')); }
  catch { return {}; }
}

function titleFromProject(projectPath, fsImpl = fs) {
  const json = path.basename(projectPath).toLowerCase() === 'project.json'
    ? safeJson(projectPath, fsImpl)
    : {};
  return String(json.title || json.description || path.basename(path.dirname(projectPath)) || path.basename(projectPath))
    .replace(/\s+/g, ' ')
    .trim();
}

function wallpaperType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json' || ext === '.pkg') return 'scene';
  if (ext === '.html') return 'web';
  if (ext === '.mp4' || ext === '.webm') return 'video';
  return 'file';
}

function scanDirectory(root, { fsImpl = fs, limit = MAX_WALLPAPERS } = {}) {
  if (!root || !exists(root, fsImpl)) return [];
  const results = [];
  const stack = [root];
  const seenDirs = new Set();
  while (stack.length && results.length < limit) {
    const dir = stack.shift();
    if (!dir || seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    let entries = [];
    try { entries = fsImpl.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }

    const files = entries.filter(entry => entry.isFile()).map(entry => path.join(dir, entry.name));
    const preferred = [
      files.find(file => path.basename(file).toLowerCase() === 'project.json'),
      files.find(file => path.basename(file).toLowerCase() === 'scene.pkg'),
      files.find(file => path.basename(file).toLowerCase() === 'index.html'),
      files.find(file => ['.mp4', '.webm'].includes(path.extname(file).toLowerCase())),
    ].find(Boolean);
    if (preferred && WALLPAPER_EXTENSIONS.has(path.extname(preferred).toLowerCase())) {
      results.push({
        id: path.relative(root, preferred) || preferred,
        title: titleFromProject(preferred, fsImpl),
        type: wallpaperType(preferred),
        file: preferred,
        root,
      });
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) stack.push(path.join(dir, entry.name));
    }
  }
  return results;
}

function scanLibrary(status = buildStatus(), options = {}) {
  const fsImpl = options.fsImpl || fs;
  const roots = unique([...(status.userProjectRoots || []), ...(status.workshopRoots || [])]);
  const items = [];
  for (const root of roots) {
    items.push(...scanDirectory(root, { fsImpl, limit: Math.max(0, MAX_WALLPAPERS - items.length) }));
    if (items.length >= MAX_WALLPAPERS) break;
  }
  return {
    ok: true,
    available: Boolean(status.available),
    count: items.length,
    items,
    roots,
  };
}

function isSubpath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateWallpaperFile(filePath, status, fsImpl = fs) {
  const normalized = path.resolve(String(filePath || ''));
  if (!normalized || !exists(normalized, fsImpl)) throw new Error('Wallpaper file does not exist.');
  if (!WALLPAPER_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
    throw new Error('Unsupported Wallpaper Engine file type.');
  }
  const roots = unique([status.installDir, ...(status.userProjectRoots || []), ...(status.workshopRoots || [])]);
  if (!roots.some(root => root && isSubpath(root, normalized))) {
    throw new Error('Wallpaper file is outside trusted Wallpaper Engine directories.');
  }
  return normalized;
}

function openWallpaper(filePath, status = buildStatus(), options = {}) {
  const fsImpl = options.fsImpl || fs;
  const spawnImpl = options.spawnImpl || spawn;
  if (status.platform !== 'win32') throw new Error('Wallpaper Engine control is Windows-only.');
  if (!status.available || !status.exePath) throw new Error(status.reason || 'Wallpaper Engine is unavailable.');
  const trustedFile = validateWallpaperFile(filePath, status, fsImpl);
  const child = spawnImpl(status.exePath, ['-control', 'openWallpaper', '-file', trustedFile], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref?.();
  return { ok: true, file: trustedFile };
}

module.exports = {
  WALLPAPER_ENGINE_APP_ID,
  WALLPAPER_EXTENSIONS,
  buildStatus,
  scanLibrary,
  validateWallpaperFile,
  openWallpaper,
};
