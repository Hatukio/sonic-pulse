/**
 * Sonic Pulse — 服务器
 * 登录：Electron 弹出真实浏览器窗口 → 自动提取 Cookie
 * 数据：NeteaseCloudMusicApi（用真实 Cookie，不走逆向登录接口）
 * 播放：服务器代理音频流 → 前端 <audio> 元素 → Web Audio API 可视化
 */
const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const dns = require('dns');
const net = require('net');
const {
  login_status, user_account,
  user_playlist, likelist,
  playlist_track_all, song_url_v1,
  search, song_detail, mv_detail, mv_url, lyric
} = require('NeteaseCloudMusicApi');
const { createProviderRegistry } = require('./server/providers/registry');
const { createCredentialProvider } = require('./server/providers/credential-provider');
const { createNeteaseProvider } = require('./server/providers/netease');
const {
  buildAssistantCatalog,
  runAssistantTurn,
} = require('./server/assistant/jarvis');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.use('/vendor/three-addons', express.static(path.join(__dirname, 'node_modules/three/examples/jsm')));
app.use(express.static(path.join(__dirname, 'public')));

// 内存中保存登录态（重启清空）
let state = { cookie: null, uid: null, nickname: null };
const providers = createProviderRegistry({
  adapters: {
    netease: createNeteaseProvider({
      api: {
        user_playlist,
        likelist,
        playlist_track_all,
        song_url_v1,
        search,
        song_detail,
        mv_detail,
        mv_url,
        lyric,
      },
      getSession: () => state,
    }),
    qq: createCredentialProvider({
      id: 'qq',
      name: 'QQ 音乐',
      docsUrl: 'https://developer.y.qq.com/docs/openapi',
      requiredEnv: ['SONIC_QQ_MUSIC_APP_ID', 'SONIC_QQ_MUSIC_APP_KEY'],
    }),
    qishui: createCredentialProvider({
      id: 'qishui',
      name: '汽水音乐',
      docsUrl: 'https://music.douyin.com/',
      requiredEnv: ['SONIC_QISHUI_CLIENT_ID', 'SONIC_QISHUI_CLIENT_SECRET'],
    }),
  },
});

const VALID_MV_QUALITIES = new Set([240, 480, 720, 1080, 2160]);
const MV_CDN_SUFFIXES = ['music.126.net', 'vod.126.net'];
const MV_STREAM_TIMEOUT_MS = 15_000;

const blockedAddresses = new net.BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([network, prefix]) => blockedAddresses.addSubnet(network, prefix, 'ipv4'));
[
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
].forEach(([network, prefix]) => blockedAddresses.addSubnet(network, prefix, 'ipv6'));

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function providerErrorStatus(error, fallback = 500) {
  const status = Number(error?.statusCode || error?.status || 0);
  return status >= 400 && status <= 599 ? status : fallback;
}

function normalizeMVQualities(brs) {
  if (!brs || typeof brs !== 'object' || Array.isArray(brs)) return [];
  return [...new Set(Object.keys(brs)
    .map(Number)
    .filter(quality => Number.isInteger(quality) && VALID_MV_QUALITIES.has(quality)))]
    .sort((a, b) => b - a);
}

function normalizeMV(song, detail) {
  const mvId = positiveInteger(song?.mv);
  const qualities = normalizeMVQualities(detail?.brs);
  if (!mvId || !detail || typeof detail !== 'object' || qualities.length === 0) {
    return { available: false, mvId: null, name: null, qualities: [] };
  }
  return {
    available: true,
    mvId,
    name: detail.name || song?.name || null,
    qualities,
  };
}

function normalizedHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/\.+$/, '');
}

function isAllowedMVHostname(hostname) {
  const normalized = normalizedHostname(hostname);
  return MV_CDN_SUFFIXES.some(suffix => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

function isPublicIPAddress(address) {
  const family = net.isIP(address);
  if (!family) return false;
  if (family === 6 && /^::ffff:/i.test(address)) return false;
  return !blockedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function createPinnedLookup(hostname, addresses) {
  const expectedHostname = normalizedHostname(hostname);
  return (requestedHostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (normalizedHostname(requestedHostname) !== expectedHostname) {
      const error = new Error('Pinned MV DNS hostname mismatch');
      error.code = 'ENOTFOUND';
      callback(error);
      return;
    }

    const requestedFamily = Number(options?.family) || 0;
    const candidates = requestedFamily
      ? addresses.filter(entry => entry.family === requestedFamily)
      : addresses;
    if (candidates.length === 0) {
      const error = new Error('No validated MV CDN address for requested family');
      error.code = 'EAI_NONAME';
      callback(error);
      return;
    }
    if (options?.all) callback(null, candidates.map(entry => ({ ...entry })));
    else callback(null, candidates[0].address, candidates[0].family);
  };
}

async function validateMVRemoteURL(remoteUrl, { lookup = dns.promises.lookup } = {}) {
  let parsed;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    throw new Error('Invalid official MV URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid official MV URL protocol');
  }
  if (parsed.username || parsed.password) throw new Error('MV URL credentials are forbidden');
  const literalHost = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literalHost)) throw new Error('MV URL IP literal is forbidden');
  if (!isAllowedMVHostname(parsed.hostname)) throw new Error('MV URL host is not an official CDN');
  if ((parsed.protocol === 'https:' && parsed.port && parsed.port !== '443')
      || (parsed.protocol === 'http:' && parsed.port && parsed.port !== '80')) {
    throw new Error('MV URL port is not allowed');
  }

  const result = await lookup(parsed.hostname, { all: true, verbatim: true });
  const addresses = (Array.isArray(result) ? result : [result])
    .map(entry => ({ address: entry?.address, family: Number(entry?.family) }))
    .filter(entry => entry.address && (entry.family === 4 || entry.family === 6));
  if (addresses.length === 0 || addresses.some(entry => !isPublicIPAddress(entry.address))) {
    throw new Error('Official MV CDN must resolve only to public IP addresses');
  }

  return {
    url: parsed,
    addresses,
    lookup: createPinnedLookup(parsed.hostname, addresses),
  };
}

function destroyUpstream(request, response, error) {
  if (request && !request.destroyed) request.destroy(error);
  if (response && !response.destroyed) response.destroy(error);
}

function attachStreamTimeout(stream, timeoutMs, onTimeout) {
  stream.setTimeout(timeoutMs, () => {
    const error = new Error(`Official MV upstream timed out after ${timeoutMs}ms`);
    error.code = 'ETIMEDOUT';
    onTimeout(error);
  });
  return stream;
}

// ─── 接收 Cookie（来自 Electron 主进程）──────────────────────────
app.post('/api/set-cookie', async (req, res) => {
  const { cookie } = req.body;
  if (!cookie) return res.status(400).json({ error: '无效 Cookie' });
  state.cookie = cookie;
  try {
    const r = await login_status({ cookie });
    const profile = r.body?.data?.profile || r.body?.profile;
    if (profile) {
      state.uid = profile.userId;
      state.nickname = profile.nickname;
    }
  } catch(e) { console.warn('获取用户信息失败:', e.message); }
  res.json({ ok: true, nickname: state.nickname });
});

// ─── 登录状态 ─────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  res.json(providers.require('netease').sessionStatus());
});

app.get('/api/providers', (_req, res) => {
  res.json({ providers: providers.catalog() });
});

app.get('/api/assistant/providers', (_req, res) => {
  res.json({ providers: buildAssistantCatalog() });
});

app.post('/api/assistant/chat', async (req, res) => {
  try {
    res.json(await runAssistantTurn(req.body || {}));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(/key|endpoint|地址|模型/i.test(message) ? 400 : 502).json({ error: message });
  }
});

// 退出登录
app.post('/api/logout', (req, res) => {
  state = { cookie: null, uid: null, nickname: null };
  res.json({ ok: true });
});

// ─── 歌单列表 ─────────────────────────────────────────────────────
app.get('/api/playlists', async (req, res) => {
  try {
    res.json({ playlist: await providers.call('netease', 'playlists') });
  } catch(e) { res.status(providerErrorStatus(e)).json({ error: e.message }); }
});

// ─── 我喜欢的音乐 ─────────────────────────────────────────────────
app.get('/api/liked', async (req, res) => {
  try {
    res.json({ songs: await providers.call('netease', 'liked') });
  } catch(e) { res.status(providerErrorStatus(e)).json({ error: e.message }); }
});

// ─── 歌单内的歌曲 ─────────────────────────────────────────────────
app.get('/api/playlist/:id/tracks', async (req, res) => {
  try {
    res.json({ songs: await providers.call('netease', 'tracks', { id: req.params.id }) });
  } catch(e) { res.status(providerErrorStatus(e)).json({ error: e.message }); }
});

// ─── 搜索 ─────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const { keyword, limit = 20, provider = 'netease' } = req.query;
  if (!keyword) return res.status(400).json({ error: '缺少关键词' });
  try {
    res.json({ songs: await providers.call(provider, 'search', { keyword, limit }) });
  } catch(e) { res.status(providerErrorStatus(e)).json({ error: e.message }); }
});

// ─── 音频代理（解决跨域，让 Web Audio API 能分析频谱）────────────
app.get('/api/audio/:id', async (req, res) => {
  try {
    const track = await providers.call('netease', 'audioUrl', { id: req.params.id, level: 'standard' });
    if (!track?.url) return res.status(403).json({ error: '无法获取播放地址（可能需要VIP）' });

    const remote = track.url;
    const client = remote.startsWith('https') ? https : http;
    client.get(remote, (remoteRes) => {
      res.setHeader('Content-Type', remoteRes.headers['content-type'] || 'audio/mpeg');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (remoteRes.headers['content-length'])
        res.setHeader('Content-Length', remoteRes.headers['content-length']);
      remoteRes.pipe(res);
    }).on('error', e => res.status(502).json({ error: e.message }));
  } catch(e) { res.status(providerErrorStatus(e)).json({ error: e.message }); }
});


// ─── 歌词 ─────────────────────────────────────────────────────────
function normalizeLyricsResponse(body = {}) {
  const lyricText = field => typeof body?.[field]?.lyric === 'string'
    ? body[field].lyric
    : '';
  return {
    lrc: lyricText('lrc'),
    tlyric: lyricText('tlyric'),
    yrc: lyricText('yrc'),
    ytlrc: lyricText('ytlrc'),
  };
}

app.get('/api/lyrics/:id', async (req, res) => {
  const songId = positiveInteger(req.params.id);
  if (!songId) return res.status(400).json({ error: '无效歌曲 ID' });
  try {
    res.json(normalizeLyricsResponse(await providers.call('netease', 'lyrics', { id: songId })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── 歌曲详情（包含专辑封面）─────────────────────────────────────
app.get('/api/song/:id', async (req, res) => {
  try {
    const s = await providers.call('netease', 'song', { id: req.params.id });
    if (!s) return res.status(404).json({ error: '未找到' });
    res.json({ id: s.id, name: s.name, artists: (s.ar||[]).map(a=>a.name).join('/'),
               albumPic: s.al?.picUrl || '', provider: 'netease', source: 'netease' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── 网易云官方 MV 元数据 ────────────────────────────────────────
app.get('/api/song/:id/mv', async (req, res) => {
  const songId = positiveInteger(req.params.id);
  if (!songId) return res.status(400).json({ error: '无效歌曲 ID' });

  try {
    const song = await providers.call('netease', 'song', { id: songId });
    if (!song) return res.status(404).json({ error: '未找到歌曲' });
    if (!positiveInteger(song.mv)) return res.json(normalizeMV(song, null));

    const details = await providers.call('netease', 'mvDetail', { mvid: song.mv });
    return res.json(normalizeMV(song, details));
  } catch (error) {
    return res.status(502).json({ error: error.message || '官方 MV 元数据获取失败' });
  }
});

async function proxyMVStream(req, res, remoteUrl, {
  validateRemoteURL = validateMVRemoteURL,
  httpClient = http,
  httpsClient = https,
  timeoutMs = MV_STREAM_TIMEOUT_MS,
} = {}) {
  const validated = await validateRemoteURL(remoteUrl);
  const parsed = validated.url;
  const client = parsed.protocol === 'https:' ? httpsClient : httpClient;
  const headers = {};
  if (typeof req.headers.range === 'string') headers.Range = req.headers.range;

  let upstreamResponse = null;
  let failed = false;
  let upstream = null;
  const fail = error => {
    if (failed) return;
    failed = true;
    destroyUpstream(upstream, upstreamResponse, error);
    if (!res.headersSent && !res.destroyed) res.status(502).json({ error: error.message });
    else if (!res.destroyed) res.destroy(error);
  };

  upstream = client.request({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || undefined,
    path: `${parsed.pathname}${parsed.search}`,
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
    lookup: validated.lookup,
    servername: parsed.hostname,
  }, remoteRes => {
    upstreamResponse = remoteRes;
    if (res.destroyed) {
      remoteRes.destroy();
      return;
    }

    res.status(remoteRes.statusCode || 200);
    ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(name => {
      if (remoteRes.headers[name] !== undefined) res.setHeader(name, remoteRes.headers[name]);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    remoteRes.on('error', fail);
    attachStreamTimeout(remoteRes, timeoutMs, fail);
    if (req.method === 'HEAD') {
      remoteRes.destroy();
      res.end();
    } else {
      remoteRes.pipe(res);
    }
  });
  upstream.on('error', fail);
  attachStreamTimeout(upstream, timeoutMs, fail);

  // IncomingMessage emits `close` after an ordinary request body completes, so
  // only `aborted` represents a client that stopped before receiving the MV.
  req.once('aborted', () => {
    destroyUpstream(upstream, upstreamResponse);
  });
  res.once('close', () => {
    if (!res.writableEnded) {
      destroyUpstream(upstream, upstreamResponse);
    }
  });
  upstream.end();
  return upstream;
}

// ─── 官方 MV 流代理（支持浏览器 Range seek）──────────────────────
async function mvStreamHandler(req, res) {
  const mvId = positiveInteger(req.params.id);
  if (!mvId) return res.status(400).json({ error: '无效 MV ID' });

  const requestedQuality = req.query.quality === undefined
    ? null
    : positiveInteger(req.query.quality);
  if (req.query.quality !== undefined && !VALID_MV_QUALITIES.has(requestedQuality)) {
    return res.status(400).json({ error: '无效 MV 画质' });
  }

  try {
    let quality = 1080;
    try {
      const details = await providers.call('netease', 'mvDetail', { mvid: mvId });
      const qualities = normalizeMVQualities(details?.brs);
      quality = qualities[0] || requestedQuality || quality;
    } catch (error) {
      console.warn('MV 画质元数据不可用，回退 1080P:', error.message);
      quality = requestedQuality || quality;
    }

    const remoteUrl = await providers.call('netease', 'mvUrl', { id: mvId, quality });
    if (!remoteUrl) return res.status(404).json({ error: '官方 MV 暂不可用' });
    return await proxyMVStream(req, res, remoteUrl);
  } catch (error) {
    if (!res.headersSent) return res.status(502).json({ error: error.message || '官方 MV 获取失败' });
    return res.destroy(error);
  }
}

// Express otherwise derives HEAD from GET and would still open a GET upstream.
app.head('/api/mv/:id/stream', mvStreamHandler);
app.get('/api/mv/:id/stream', mvStreamHandler);

if (require.main === module) {
  app.listen(PORT, () => console.log(`✅ Sonic Pulse: http://localhost:${PORT}`));
}

module.exports = {
  app,
  normalizeLyricsResponse,
  normalizeMV,
  isAllowedMVHostname,
  isPublicIPAddress,
  validateMVRemoteURL,
  attachStreamTimeout,
  destroyUpstream,
  proxyMVStream,
  providers,
  buildAssistantCatalog,
  runAssistantTurn,
};
