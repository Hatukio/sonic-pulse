const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildStatus,
  openWallpaper,
  scanLibrary,
  validateWallpaperFile,
} = require('../wallpaper-engine');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sonic-wallpaper-engine-'));
}

test('Wallpaper Engine reports an honest non-Windows fallback', () => {
  const status = buildStatus({ platform: 'darwin', env: {}, fsImpl: fs });

  assert.equal(status.ok, true);
  assert.equal(status.available, false);
  assert.match(status.reason, /Windows/i);
  assert.deepEqual(status.workshopRoots, []);
});

test('detects a Windows Steam install and scans trusted wallpaper projects', () => {
  const root = tempRoot();
  const steam = path.join(root, 'Steam');
  const install = path.join(steam, 'steamapps', 'common', 'wallpaper_engine');
  const workshopItem = path.join(steam, 'steamapps', 'workshop', 'content', '431960', '123456');
  fs.mkdirSync(install, { recursive: true });
  fs.mkdirSync(workshopItem, { recursive: true });
  fs.writeFileSync(path.join(install, 'wallpaper64.exe'), '');
  fs.writeFileSync(path.join(workshopItem, 'project.json'), JSON.stringify({ title: 'Neon Ocean' }));

  const status = buildStatus({
    platform: 'win32',
    env: { 'ProgramFiles(x86)': root },
    fsImpl: fs,
  });
  const library = scanLibrary(status);

  assert.equal(status.available, true);
  assert.equal(path.basename(status.exePath), 'wallpaper64.exe');
  assert.equal(library.count, 1);
  assert.equal(library.items[0].title, 'Neon Ocean');
  assert.equal(library.items[0].type, 'scene');
});

test('only opens wallpaper files from trusted Wallpaper Engine roots', () => {
  const root = tempRoot();
  const install = path.join(root, 'wallpaper_engine');
  const trusted = path.join(install, 'projects', 'myprojects', 'sonic', 'index.html');
  const outside = path.join(root, 'outside.html');
  fs.mkdirSync(path.dirname(trusted), { recursive: true });
  fs.writeFileSync(trusted, '<!doctype html>');
  fs.writeFileSync(outside, '<!doctype html>');

  const status = {
    platform: 'win32',
    available: true,
    exePath: path.join(install, 'wallpaper64.exe'),
    installDir: install,
    userProjectRoots: [path.join(install, 'projects', 'myprojects')],
    workshopRoots: [],
  };
  fs.mkdirSync(install, { recursive: true });
  fs.writeFileSync(status.exePath, '');

  assert.equal(validateWallpaperFile(trusted, status), trusted);
  assert.throws(() => validateWallpaperFile(outside, status), /trusted/i);

  const calls = [];
  const result = openWallpaper(trusted, status, {
    spawnImpl(exe, args, options) {
      calls.push({ exe, args, options });
      return { unref() { calls.push({ unref: true }); } };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].args, ['-control', 'openWallpaper', '-file', trusted]);
  assert.equal(calls[1].unref, true);
});
