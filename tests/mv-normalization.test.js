const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { normalizeMV } = require('../server');

const unavailable = {
  available: false,
  mvId: null,
  name: null,
  qualities: [],
};

test('only confirms an official MV when both song mv id and detail are usable', () => {
  assert.deepEqual(normalizeMV({ mv: 0 }, null), unavailable);
  assert.deepEqual(normalizeMV({ mv: -2 }, { name: 'Invalid', brs: { 1080: 'x' } }), unavailable);
  assert.deepEqual(normalizeMV({ mv: 2.5 }, { name: 'Invalid', brs: { 1080: 'x' } }), unavailable);
  assert.deepEqual(normalizeMV({ mv: 88 }, null), unavailable);
  assert.deepEqual(normalizeMV({ mv: 88 }, {}), unavailable);
  assert.deepEqual(normalizeMV({ mv: 88 }, { name: 'No stream', brs: {} }), unavailable);
});

test('normalizes official MV metadata with unique descending legal qualities', () => {
  assert.deepEqual(
    normalizeMV(
      { mv: '88', name: 'Track' },
      {
        name: 'Official',
        brs: {
          480: 'a',
          1080: 'b',
          720: 'c',
          '-1': 'bad',
          999: 'unsupported',
          nope: 'bad',
        },
      },
    ),
    { available: true, mvId: 88, name: 'Official', qualities: [1080, 720, 480] },
  );
});

test('requiring server.js does not open a listening socket', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const script = [
    "const { app } = require('./server')",
    "const http = require('node:http')",
    "const handles = process._getActiveHandles().filter(handle => handle instanceof http.Server && handle.listening)",
    "if (!app || handles.length) process.exit(1)",
  ].join(';');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 3000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || `signal: ${result.signal}`);
});
