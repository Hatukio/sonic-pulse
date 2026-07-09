const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createProviderRegistry,
  normalizeProviderId,
} = require('../server/providers/registry');
const { createCredentialProvider } = require('../server/providers/credential-provider');

test('provider registry advertises live NetEase, credential-gated QQ/Qishui, and planned Apple Music', () => {
  const registry = createProviderRegistry({
    adapters: {
      netease: {
        id: 'netease',
        name: '网易云音乐',
        implemented: true,
        capabilities: { search: true, lyrics: true, mv: true, login: true },
      },
      qq: createCredentialProvider({
        id: 'qq',
        name: 'QQ 音乐',
        requiredEnv: ['SONIC_QQ_MUSIC_APP_ID', 'SONIC_QQ_MUSIC_APP_KEY'],
        docsUrl: 'https://developer.y.qq.com/docs/openapi',
      }),
      qishui: createCredentialProvider({
        id: 'qishui',
        name: '汽水音乐',
        requiredEnv: ['SONIC_QISHUI_CLIENT_ID', 'SONIC_QISHUI_CLIENT_SECRET'],
        docsUrl: 'https://music.douyin.com/',
      }),
    },
  });

  const catalog = registry.catalog();
  const netease = catalog.find(provider => provider.id === 'netease');
  assert.equal(netease.implemented, true);
  assert.equal(netease.capabilities.mv, true);
  assert.equal(netease.capabilities.lyrics, true);

  for (const id of ['qq', 'qishui']) {
    const provider = catalog.find(item => item.id === id);
    assert.equal(provider.implemented, true);
    assert.equal(provider.planned, false);
    assert.equal(provider.authRequired, true);
    assert.equal(provider.configured, false);
    assert.equal(provider.status, 'needs_credentials');
    assert.match(provider.docsUrl, /^https:\/\//);
    assert.equal(provider.capabilities.search, true);
    assert.equal(provider.capabilities.mv, true);
  }

  const apple = catalog.find(item => item.id === 'apple');
  assert.equal(apple.implemented, false);
  assert.equal(apple.planned, true);
});

test('provider registry normalizes provider ids and dispatches to adapters', async () => {
  const calls = [];
  const registry = createProviderRegistry({
    adapters: {
      netease: {
        id: 'netease',
        implemented: true,
        capabilities: { search: true },
        async search(query) {
          calls.push(['search', query]);
          return [{ id: 1, name: query.keyword, provider: 'netease' }];
        },
      },
    },
  });

  assert.equal(normalizeProviderId(' NetEase '), 'netease');
  assert.equal(normalizeProviderId(''), 'netease');
  assert.deepEqual(await registry.call(' NetEase ', 'search', { keyword: '光' }), [
    { id: 1, name: '光', provider: 'netease' },
  ]);
  assert.deepEqual(calls, [['search', { keyword: '光' }]]);
});

test('provider registry rejects unsupported or unavailable operations clearly', async () => {
  const registry = createProviderRegistry({
    adapters: {
      netease: {
        id: 'netease',
        implemented: true,
        capabilities: { search: true },
      },
    },
  });

  assert.throws(() => registry.require('apple'), /Provider apple is planned but not available/);
  await assert.rejects(() => registry.call('netease', 'lyrics', { id: 1 }), /does not support lyrics/);
  assert.throws(() => registry.require('unknown'), /Unknown provider/);
});

test('credential provider rejects operations with official credential guidance', async () => {
  const registry = createProviderRegistry({
    adapters: {
      qq: createCredentialProvider({
        id: 'qq',
        name: 'QQ 音乐',
        requiredEnv: ['SONIC_QQ_MUSIC_APP_ID', 'SONIC_QQ_MUSIC_APP_KEY'],
        docsUrl: 'https://developer.y.qq.com/docs/openapi',
      }),
    },
  });

  await assert.rejects(
    () => registry.call('qq', 'search', { keyword: '起风了' }),
    /QQ 音乐.*官方.*凭证.*SONIC_QQ_MUSIC_APP_ID/,
  );
});
