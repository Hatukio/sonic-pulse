const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createProviderRegistry,
  normalizeProviderId,
} = require('../server/providers/registry');

test('provider registry advertises live NetEase and planned cross-platform providers', () => {
  const registry = createProviderRegistry({
    adapters: {
      netease: {
        id: 'netease',
        name: '网易云音乐',
        implemented: true,
        capabilities: { search: true, lyrics: true, mv: true, login: true },
      },
    },
  });

  const catalog = registry.catalog();
  const netease = catalog.find(provider => provider.id === 'netease');
  assert.equal(netease.implemented, true);
  assert.equal(netease.capabilities.mv, true);
  assert.equal(netease.capabilities.lyrics, true);

  for (const id of ['qq', 'qishui', 'apple']) {
    const provider = catalog.find(item => item.id === id);
    assert.equal(provider.implemented, false);
    assert.equal(provider.planned, true);
  }
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

  assert.throws(() => registry.require('qq'), /Provider qq is planned but not available/);
  await assert.rejects(() => registry.call('netease', 'lyrics', { id: 1 }), /does not support lyrics/);
  assert.throws(() => registry.require('unknown'), /Unknown provider/);
});
