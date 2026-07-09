const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  isAllowedMVHostname,
  isPublicIPAddress,
  validateMVRemoteURL,
  attachStreamTimeout,
  destroyUpstream,
  proxyMVStream,
} = require('../server');

test('allows only exact or subdomain NetEase MV CDN hostnames', () => {
  assert.equal(isAllowedMVHostname('music.126.net'), true);
  assert.equal(isAllowedMVHostname('m10.music.126.net'), true);
  assert.equal(isAllowedMVHostname('vod.126.net'), true);
  assert.equal(isAllowedMVHostname('vodkgeyttp8.vod.126.net'), true);
  assert.equal(isAllowedMVHostname('music.126.net.evil.example'), false);
  assert.equal(isAllowedMVHostname('evilmusic.126.net'), false);
});

test('classifies public addresses and rejects private or reserved ranges', () => {
  assert.equal(isPublicIPAddress('8.8.8.8'), true);
  assert.equal(isPublicIPAddress('2606:4700:4700::1111'), true);
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.3.2',
    '192.168.1.2',
    '100.64.0.1',
    '192.0.2.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '2001:db8::1',
  ]) assert.equal(isPublicIPAddress(address), false, address);
});

test('rejects credentials, IP literals, malicious hosts, and private DNS answers', async () => {
  const publicLookup = async () => [{ address: '8.8.8.8', family: 4 }];
  await assert.rejects(
    validateMVRemoteURL('https://user:pass@music.126.net/video.mp4', { lookup: publicLookup }),
    /credentials/i,
  );
  await assert.rejects(
    validateMVRemoteURL('https://127.0.0.1/video.mp4', { lookup: publicLookup }),
    /IP literal/i,
  );
  await assert.rejects(
    validateMVRemoteURL('https://[::1]/video.mp4', { lookup: publicLookup }),
    /IP literal/i,
  );
  await assert.rejects(
    validateMVRemoteURL('https://music.126.net.evil.example/video.mp4', { lookup: publicLookup }),
    /host/i,
  );
  await assert.rejects(
    validateMVRemoteURL('https://m10.music.126.net/video.mp4', {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    }),
    /public/i,
  );
  await assert.rejects(
    validateMVRemoteURL('https://m10.music.126.net/video.mp4', {
      lookup: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
    }),
    /public/i,
  );
});

test('returns a DNS-pinned lookup after all official CDN answers validate', async () => {
  const validated = await validateMVRemoteURL('https://m10.music.126.net/video.mp4', {
    lookup: async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ],
  });

  const pinned = await new Promise((resolve, reject) => {
    validated.lookup('m10.music.126.net', { family: 4 }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(pinned, { address: '8.8.8.8', family: 4 });
});

test('arms 15 second timeouts and destroys request and response together', () => {
  let timeoutMs = null;
  let timeoutHandler = null;
  const request = {
    destroyedWith: null,
    setTimeout(ms, handler) { timeoutMs = ms; timeoutHandler = handler; },
    destroy(error) { this.destroyedWith = error; },
  };
  const response = {
    destroyedWith: null,
    destroy(error) { this.destroyedWith = error; },
  };

  attachStreamTimeout(request, 15_000, error => destroyUpstream(request, response, error));
  assert.equal(timeoutMs, 15_000);
  timeoutHandler();
  assert.match(request.destroyedWith.message, /timed out/i);
  assert.equal(response.destroyedWith, request.destroyedWith);
});

class FakeClientRequest extends EventEmitter {
  constructor() {
    super();
    this.ended = false;
    this.timeoutMs = null;
  }
  setTimeout(ms, handler) { this.timeoutMs = ms; this.timeoutHandler = handler; }
  end() { this.ended = true; }
  destroy(error) { this.destroyed = error || true; }
}

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.headersSent = false;
    this.destroyed = false;
    this.writableEnded = false;
    this.ended = false;
  }
  status(code) { this.statusCode = code; return this; }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  end() { this.ended = true; this.writableEnded = true; }
  json(value) { this.jsonBody = value; this.headersSent = true; return this; }
  destroy(error) { this.destroyed = error || true; }
}

test('HEAD proxy uses upstream HEAD, forwards range metadata, and never downloads a body', async () => {
  const incoming = new EventEmitter();
  incoming.method = 'HEAD';
  incoming.headers = { range: 'bytes=0-0' };
  const outgoing = new FakeResponse();
  const upstreamRequest = new FakeClientRequest();
  let requestOptions;
  let pipeCalls = 0;
  const remoteResponse = new EventEmitter();
  remoteResponse.statusCode = 206;
  remoteResponse.headers = {
    'content-type': 'video/mp4',
    'content-length': '1',
    'content-range': 'bytes 0-0/99',
    'accept-ranges': 'bytes',
  };
  remoteResponse.setTimeout = (ms, handler) => { remoteResponse.timeout = { ms, handler }; };
  remoteResponse.destroy = error => { remoteResponse.destroyed = error || true; };
  remoteResponse.pipe = () => { pipeCalls += 1; };
  const client = {
    request(options, callback) {
      requestOptions = options;
      queueMicrotask(() => callback(remoteResponse));
      return upstreamRequest;
    },
  };
  const pinnedLookup = () => {};

  await proxyMVStream(incoming, outgoing, 'https://m10.music.126.net/video.mp4', {
    validateRemoteURL: async url => ({ url: new URL(url), lookup: pinnedLookup }),
    httpsClient: client,
    httpClient: client,
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(requestOptions.method, 'HEAD');
  assert.equal(requestOptions.headers.Range, 'bytes=0-0');
  assert.equal(requestOptions.lookup, pinnedLookup);
  assert.equal(upstreamRequest.ended, true);
  assert.equal(upstreamRequest.timeoutMs, 15_000);
  assert.equal(remoteResponse.timeout.ms, 15_000);
  assert.equal(outgoing.statusCode, 206);
  assert.equal(outgoing.headers['content-range'], 'bytes 0-0/99');
  assert.equal(outgoing.headers['accept-ranges'], 'bytes');
  assert.equal(outgoing.ended, true);
  assert.equal(pipeCalls, 0);
});
