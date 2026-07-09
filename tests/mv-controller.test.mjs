import test from 'node:test';
import assert from 'node:assert/strict';

import { MVController } from '../public/src/media/mv-controller.mjs';

class FakeVideo extends EventTarget {
  constructor({ playError = null } = {}) {
    super();
    this.muted = false;
    this.playsInline = false;
    this.currentTime = 0;
    this.src = '';
    this.paused = true;
    this.playError = playError;
    this.loadCalls = 0;
    this.pauseCalls = 0;
    this.removedAttributes = [];
  }

  load() { this.loadCalls += 1; }

  async play() {
    if (this.playError) throw this.playError;
    this.paused = false;
    this.dispatchEvent(new Event('playing'));
  }

  pause() {
    this.paused = true;
    this.pauseCalls += 1;
  }

  removeAttribute(name) {
    this.removedAttributes.push(name);
    if (name === 'src') this.src = '';
  }
}

const response = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  async json() { return body; },
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test('discover exposes confirmed metadata and highest official quality', async () => {
  const calls = [];
  const video = new FakeVideo();
  const controller = new MVController({
    video,
    fetchImpl: async (url) => {
      calls.push(url);
      return response({ available: true, mvId: 88, name: 'Official', qualities: [720, 1080, 480] });
    },
  });

  const metadata = await controller.discover(42);

  assert.deepEqual(calls, ['/api/song/42/mv']);
  assert.equal(controller.state, 'available');
  assert.equal(controller.enabled, false);
  assert.equal(controller.selectedQuality, 1080);
  assert.deepEqual(metadata, {
    available: true,
    mvId: 88,
    name: 'Official',
    qualities: [1080, 720, 480],
  });
  assert.equal(video.muted, true);
  assert.equal(video.playsInline, true);
});

test('discover leaves a song without confirmed detail unavailable', async () => {
  const controller = new MVController({
    video: new FakeVideo(),
    fetchImpl: async () => response({ available: false, mvId: null, name: null, qualities: [] }),
  });

  assert.equal(await controller.discover(7), null);
  assert.equal(controller.state, 'unavailable');
  assert.equal(controller.metadata, null);
});

test('enable streams highest quality and publishes loading then playing state', async () => {
  const video = new FakeVideo();
  const states = [];
  const controller = new MVController({
    video,
    fetchImpl: async () => response({ available: true, mvId: 88, name: 'MV', qualities: [1080, 720] }),
  });
  controller.addEventListener('statechange', (event) => states.push(event.detail));
  await controller.discover(1);
  states.length = 0;

  assert.equal(await controller.enable(), true);

  assert.equal(video.src, '/api/mv/88/stream?quality=1080');
  assert.equal(video.loadCalls, 1);
  assert.deepEqual(states.map(({ state }) => state), ['loading', 'playing']);
  assert.equal(states.at(-1).pointCloudVisible, false);
  assert.equal(controller.enabled, true);
});

test('sync corrects video drift only beyond 0.35 seconds while enabled', async () => {
  const video = new FakeVideo();
  const controller = new MVController({
    video,
    fetchImpl: async () => response({ available: true, mvId: 88, name: 'MV', qualities: [720] }),
  });
  await controller.discover(1);
  await controller.enable();

  video.currentTime = 10;
  assert.equal(controller.sync(10.35), false);
  assert.equal(video.currentTime, 10);
  assert.equal(controller.sync(10.351), true);
  assert.equal(video.currentTime, 10.351);
});

test('sync rejects a negative audio clock without assigning an invalid media time', async () => {
  const video = new FakeVideo();
  const controller = new MVController({
    video,
    fetchImpl: async () => response({ available: true, mvId: 88, name: 'MV', qualities: [720] }),
  });
  await controller.discover(1);
  await controller.enable();
  video.currentTime = 4;

  assert.equal(controller.sync(-1), false);
  assert.equal(video.currentTime, 4);
});

test('disable invalidates a pending play resolve so it cannot restore playing state', async () => {
  const pendingPlay = deferred();
  const video = new FakeVideo();
  video.play = () => pendingPlay.promise;
  const controller = new MVController({
    video,
    fetchImpl: async () => response({ available: true, mvId: 88, name: 'MV', qualities: [720] }),
  });
  await controller.discover(1);

  const enabling = controller.enable();
  controller.disable();
  pendingPlay.resolve();

  assert.equal(await enabling, false);
  assert.equal(controller.state, 'available');
  assert.equal(controller.enabled, false);
});

test('a delayed event handler from an invalidated play generation cannot change state', async () => {
  const pendingPlay = deferred();
  const video = new FakeVideo();
  const historicalListeners = [];
  const nativeAdd = video.addEventListener.bind(video);
  video.addEventListener = (type, listener, options) => {
    historicalListeners.push({ type, listener });
    nativeAdd(type, listener, options);
  };
  video.play = () => pendingPlay.promise;
  const controller = new MVController({
    video,
    fetchImpl: async () => response({ available: true, mvId: 88, name: 'MV', qualities: [720] }),
  });
  await controller.discover(1);
  const enabling = controller.enable();
  const stalePlaying = historicalListeners.find(entry => entry.type === 'playing').listener;

  controller.disable();
  stalePlaying(new Event('playing'));
  pendingPlay.resolve();

  assert.equal(await enabling, false);
  assert.equal(controller.state, 'available');
  assert.equal(controller.enabled, false);
});

test('a stale play rejection cannot overwrite metadata discovered for the next song', async () => {
  const pendingPlay = deferred();
  const video = new FakeVideo();
  video.play = () => pendingPlay.promise;
  const controller = new MVController({
    video,
    fetchImpl: async (url) => response(url.includes('/2/')
      ? { available: true, mvId: 222, name: 'Next', qualities: [1080] }
      : { available: true, mvId: 111, name: 'First', qualities: [720] }),
  });
  await controller.discover(1);
  const enabling = controller.enable();

  await controller.discover(2);
  pendingPlay.reject(new Error('late rejection'));

  assert.equal(await enabling, false);
  assert.equal(controller.state, 'available');
  assert.equal(controller.metadata.mvId, 222);
});

test('an invalid discover call invalidates an older metadata request', async () => {
  const pendingFetch = deferred();
  const controller = new MVController({
    video: new FakeVideo(),
    fetchImpl: () => pendingFetch.promise,
  });

  const first = controller.discover(1);
  await controller.discover(0);
  pendingFetch.resolve(response({ available: true, mvId: 111, name: 'Stale', qualities: [1080] }));

  assert.equal(await first, null);
  assert.equal(controller.state, 'error');
  assert.equal(controller.metadata, null);
});

test('starting a new discovery aborts the previous MV metadata request', async () => {
  const signals = [];
  const first = deferred();
  const controller = new MVController({
    video: new FakeVideo(),
    fetchImpl: (url, options = {}) => {
      signals.push(options.signal);
      return url.includes('/1/')
        ? first.promise
        : Promise.resolve(response({ available: true, mvId: 222, name: 'Next', qualities: [1080] }));
    },
  });

  const stale = controller.discover(1);
  const current = controller.discover(2);

  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  first.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  assert.equal(await stale, null);
  assert.equal((await current).mvId, 222);
});

test('enable playback rejection enters error state and restores point-cloud visibility', async () => {
  const video = new FakeVideo({ playError: new Error('autoplay blocked') });
  const states = [];
  const controller = new MVController({
    video,
    fetchImpl: async () => response({ available: true, mvId: 88, name: 'MV', qualities: [1080] }),
  });
  controller.addEventListener('statechange', (event) => states.push(event.detail));
  await controller.discover(1);

  assert.equal(await controller.enable(), false);
  assert.equal(controller.state, 'error');
  assert.equal(controller.enabled, false);
  assert.equal(states.at(-1).pointCloudVisible, true);
  assert.match(states.at(-1).error.message, /autoplay blocked/);
});

test('disable keeps discovery metadata and observably restores the point cloud', async () => {
  const video = new FakeVideo();
  const states = [];
  const controller = new MVController({
    video,
    fetchImpl: async () => response({ available: true, mvId: 88, name: 'MV', qualities: [720] }),
  });
  controller.addEventListener('statechange', (event) => states.push(event.detail));
  await controller.discover(1);
  await controller.enable();

  controller.disable();

  assert.equal(controller.state, 'available');
  assert.equal(controller.enabled, false);
  assert.equal(controller.metadata.mvId, 88);
  assert.equal(states.at(-1).pointCloudVisible, true);
  assert.equal(video.paused, true);
});

test('reset clears prior official MV metadata for local playback without an error state', async () => {
  const video = new FakeVideo();
  const controller = new MVController({
    video,
    fetchImpl: async () => response({ available: true, mvId: 88, name: 'MV', qualities: [1080] }),
  });
  await controller.discover(7);
  video.src = '/old-mv';
  const detail = controller.reset();
  assert.equal(detail.state, 'unavailable');
  assert.equal(controller.metadata, null);
  assert.equal(controller.selectedQuality, null);
  assert.equal(controller.enabled, false);
  assert.equal(video.src, '');
});

test('discover and enable failures enter error without throwing stale media state', async () => {
  const video = new FakeVideo();
  const controller = new MVController({
    video,
    fetchImpl: async () => response({ error: 'upstream failed' }, { ok: false, status: 502 }),
  });

  assert.equal(await controller.discover(8), null);
  assert.equal(controller.state, 'error');
  assert.equal(controller.enabled, false);
  assert.equal(controller.metadata, null);
});

test('destroy pauses media, clears source, removes listeners, and rejects later work', async () => {
  const video = new FakeVideo();
  const controller = new MVController({
    video,
    fetchImpl: async () => response({ available: true, mvId: 88, name: 'MV', qualities: [720] }),
  });
  await controller.discover(1);
  await controller.enable();

  controller.destroy();
  video.dispatchEvent(new Event('error'));

  assert.equal(controller.destroyed, true);
  assert.equal(controller.enabled, false);
  assert.equal(video.paused, true);
  assert.equal(video.src, '');
  assert.ok(video.removedAttributes.includes('src'));
  assert.equal(await controller.enable(), false);
});

test('destroy aborts an in-flight MV metadata request', async () => {
  let signal;
  const pending = deferred();
  const controller = new MVController({
    video: new FakeVideo(),
    fetchImpl: (_url, options = {}) => {
      signal = options.signal;
      return pending.promise;
    },
  });
  const discovery = controller.discover(5);
  controller.destroy();
  assert.equal(signal.aborted, true);
  pending.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  assert.equal(await discovery, null);
});
