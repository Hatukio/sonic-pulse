import test from 'node:test';
import assert from 'node:assert/strict';

import { LyricEngine } from '../public/src/lyrics/lyric-engine.mjs';

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 500, async json() { return body; } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('loads provider word timing, merges enhanced translation, and emits serializable audio-clock state', async () => {
  const audio = { currentTime: 1.75 };
  const fetch = async () => response({
    yrc: '[1000,2000](1000,500,0)We(1500,1000,0) glow\n[4000,1000](4000,1000,0)Tonight',
    ytlrc: '[00:01.10]我们发光\n[00:04.00]今夜',
    lrc: '[00:01.00]Fallback',
    tlyric: '[00:01.00]旧翻译',
  });
  const engine = new LyricEngine({ fetch, audio });
  let emitted;
  engine.addEventListener('statechange', event => { emitted = event.detail; });

  await engine.load(42);
  const state = engine.update({
    personality: 'impact',
    palette: ['#65faff', '#ffb45e'],
    intensity: 0.85,
  });

  assert.equal(state.current.text, 'We glow');
  assert.equal(state.current.translation, '我们发光');
  assert.equal(state.prev, null);
  assert.equal(state.next.text, 'Tonight');
  assert.equal(state.wordIndex, 1);
  assert.equal(state.progress, 0.25);
  assert.equal(state.style, 'energy');
  assert.equal(state.personality, 'impact');
  assert.deepEqual(state.palette, ['#65faff', '#ffb45e']);
  assert.equal(state.intensity, 0.85);
  assert.equal(emitted, state);
  assert.doesNotThrow(() => JSON.stringify(state));
});

test('falls back to line LRC, fallback word timing, and standard translation', async () => {
  const audio = { currentTime: 2 };
  const engine = new LyricEngine({
    audio,
    fetch: async () => response({
      yrc: 'bad provider payload',
      ytlrc: '',
      lrc: '[00:01.00]We become light\n[00:04.00]Tonight',
      tlyric: '[00:01.20]我们化作光',
    }),
  });

  const lines = await engine.load(7);
  const state = engine.update({ personality: 'ambient' });

  assert.equal(lines[0].translation, '我们化作光');
  assert.deepEqual(lines[0].words.map(word => word.text), ['We', 'become', 'light']);
  assert.equal(state.current.text, 'We become light');
  assert.equal(state.style, 'depth');
});

test('auto lyric style follows personality while an explicit style remains locked', async () => {
  const engine = new LyricEngine({
    audio: { currentTime: 1.5 },
    fetch: async () => response({ lrc: '[00:01.00]Pulse' }),
  });
  await engine.load(1);

  assert.equal(engine.update({ personality: 'pop' }).style, 'orbit');
  engine.setStyle('particles');
  assert.equal(engine.update({ personality: 'impact' }).style, 'particles');
  engine.setStyle('auto');
  assert.equal(engine.update({ personality: 'fluid' }).style, 'particles');
});

test('normalizes presentation values before dispatching state', async () => {
  const engine = new LyricEngine({
    audio: { currentTime: 1.5 },
    fetch: async () => response({ lrc: '[00:01.00]Pulse' }),
  });
  await engine.load(1);

  const state = engine.update({
    personality: 'unknown',
    palette: ['#fff', 42, null],
    intensity: 5,
  });

  assert.equal(state.personality, 'auto');
  assert.deepEqual(state.palette, ['#fff']);
  assert.equal(state.intensity, 1);
  assert.equal(state.style, 'depth');
});

test('exposes deeply immutable lines, states, and event payloads', async () => {
  const engine = new LyricEngine({
    audio: { currentTime: 1.5 },
    fetch: async () => response({ lrc: '[00:01.00]Original' }),
  });
  let eventState;
  engine.addEventListener('statechange', event => { eventState = event.detail; });
  const lines = await engine.load(1);
  const state = engine.update();

  assert.throws(() => { lines[0].text = 'Mutated'; }, TypeError);
  assert.throws(() => { engine.lines[0].words[0].text = 'Mutated'; }, TypeError);
  assert.throws(() => { state.current.translation = 'Mutated'; }, TypeError);
  assert.throws(() => { eventState.palette.push('#000'); }, TypeError);
  assert.throws(() => { engine.lines = []; }, TypeError);
  assert.equal(engine.update().current.text, 'Original');
});

test('throttles progress-only state events while returning fresh local progress', async () => {
  let now = 0;
  const audio = { currentTime: 1.1 };
  const engine = new LyricEngine({
    audio,
    now: () => now,
    eventInterval: 33,
    fetch: async () => response({
      yrc: '[1000,2000](1000,1000,0)We(2000,1000,0)glow',
    }),
  });
  const events = [];
  engine.addEventListener('statechange', event => events.push(event.detail));
  await engine.load(1);

  engine.update({ personality: 'pop' });
  engine.update({ personality: 'pop' });
  assert.equal(events.length, 1);

  audio.currentTime = 1.2;
  now = 10;
  const local = engine.update({ personality: 'pop' });
  assert.ok(local.progress > events[0].progress);
  assert.equal(events.length, 1);

  now = 34;
  engine.update({ personality: 'pop' });
  assert.equal(events.length, 2);

  audio.currentTime = 2.1;
  now = 35;
  engine.update({ personality: 'pop' });
  assert.equal(events.length, 3, 'word changes bypass the interval');

  now = 36;
  engine.update({ personality: 'impact' });
  assert.equal(events.length, 4, 'personality and style changes bypass the interval');
});

test('a stale concurrent load cannot overwrite the newest song', async () => {
  const first = deferred();
  const second = deferred();
  const fetch = (url) => url.endsWith('/1') ? first.promise : second.promise;
  const engine = new LyricEngine({ fetch, audio: { currentTime: 1.5 } });

  const oldLoad = engine.load(1);
  const newLoad = engine.load(2);
  second.resolve(response({ lrc: '[00:01.00]Newest' }));
  await newLoad;
  first.resolve(response({ lrc: '[00:01.00]Stale' }));
  await oldLoad;

  assert.equal(engine.update().current.text, 'Newest');
});

test('starting a new song load clears the previous song lyrics immediately', async () => {
  const next = deferred();
  let call = 0;
  const engine = new LyricEngine({
    audio: { currentTime: 1.5 },
    fetch: () => {
      call += 1;
      return call === 1
        ? Promise.resolve(response({ lrc: '[00:01.00]Previous' }))
        : next.promise;
    },
  });
  await engine.load(1);
  assert.equal(engine.update().current.text, 'Previous');

  const loading = engine.load(2);
  assert.equal(engine.update().current, null);
  next.resolve(response({ lrc: '[00:01.00]Next' }));
  await loading;
});

test('surfaces current HTTP failures and ignores stale failures', async () => {
  const calls = [];
  const stale = deferred();
  const fetch = (url) => {
    calls.push(url);
    if (calls.length === 1) return stale.promise;
    return Promise.resolve(response({}, false));
  };
  const engine = new LyricEngine({ fetch, audio: { currentTime: 0 } });

  const oldLoad = engine.load(1);
  await assert.rejects(engine.load(2), /500/);
  stale.reject(new Error('obsolete network error'));
  await assert.doesNotReject(oldLoad);
  assert.deepEqual(calls, ['/api/lyrics/1', '/api/lyrics/2']);
});

test('rejects non-positive or non-integer song ids without fetching', async () => {
  let calls = 0;
  const engine = new LyricEngine({
    audio: { currentTime: 0 },
    fetch: async () => { calls += 1; return response({}); },
  });

  for (const id of [0, -1, 1.5, 'abc', '1/2', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(engine.load(id), /positive integer/i);
  }
  await assert.doesNotReject(engine.load('42'));
  assert.equal(calls, 1);
});

test('destroy aborts pending work and prevents later state events', async () => {
  let signal;
  let eventCount = 0;
  const pending = deferred();
  const engine = new LyricEngine({
    audio: { currentTime: 0 },
    fetch: (_url, options) => {
      signal = options.signal;
      return pending.promise;
    },
  });
  engine.addEventListener('statechange', () => { eventCount += 1; });

  const loading = engine.load(1);
  engine.destroy();
  pending.resolve(response({ lrc: '[00:01.00]Too late' }));
  await loading;
  engine.update({ personality: 'impact' });

  assert.equal(signal.aborted, true);
  assert.equal(eventCount, 0);
  assert.equal(engine.state.current, null);
});

test('clear aborts stale lyrics and emits an empty state for local playback', async () => {
  const engine = new LyricEngine({ fetch: async () => ({ ok: true, json: async () => ({ lrc: '[00:00]old' }) }) });
  await engine.load(1);
  engine.update({ time: 0.1 });
  let detail = null;
  engine.addEventListener('statechange', event => { detail = event.detail; });
  const state = engine.clear();
  assert.equal(engine.lines.length, 0);
  assert.equal(state.current, null);
  assert.equal(detail.current, null);
});
