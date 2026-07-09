'use strict';

const PLANNED_PROVIDERS = Object.freeze({
  qq: Object.freeze({
    id: 'qq',
    name: 'QQ 音乐',
    implemented: false,
    planned: true,
    platform: 'windows-macos',
    capabilities: Object.freeze({
      search: false,
      playlists: false,
      tracks: false,
      audioUrl: false,
      lyrics: false,
      mv: false,
      login: true,
    }),
  }),
  qishui: Object.freeze({
    id: 'qishui',
    name: '汽水音乐',
    implemented: false,
    planned: true,
    platform: 'windows-macos',
    capabilities: Object.freeze({
      search: false,
      playlists: false,
      tracks: false,
      audioUrl: false,
      lyrics: false,
      mv: false,
      login: true,
    }),
  }),
  apple: Object.freeze({
    id: 'apple',
    name: 'Apple Music',
    implemented: false,
    planned: true,
    platform: 'official-api',
    capabilities: Object.freeze({
      search: false,
      playlists: false,
      tracks: false,
      audioUrl: false,
      lyrics: false,
      mv: true,
      login: true,
    }),
  }),
});

function normalizeProviderId(value) {
  const id = String(value || '').trim().toLowerCase();
  return id || 'netease';
}

function cloneProvider(provider) {
  return {
    ...provider,
    capabilities: { ...(provider.capabilities || {}) },
  };
}

function operationSupported(adapter, operation) {
  return adapter?.capabilities?.[operation] === true && typeof adapter?.[operation] === 'function';
}

function createProviderRegistry({ adapters = {} } = {}) {
  const normalizedAdapters = new Map();
  Object.entries(adapters).forEach(([id, adapter]) => {
    const providerId = normalizeProviderId(adapter?.id || id);
    normalizedAdapters.set(providerId, {
      planned: false,
      platform: 'windows-macos',
      ...adapter,
      id: providerId,
      implemented: adapter?.implemented !== false,
      capabilities: { ...(adapter?.capabilities || {}) },
    });
  });

  const registry = {
    catalog() {
      const live = [...normalizedAdapters.values()].map(cloneProvider);
      const planned = Object.values(PLANNED_PROVIDERS)
        .filter(provider => !normalizedAdapters.has(provider.id))
        .map(cloneProvider);
      return [...live, ...planned];
    },
    require(providerId = 'netease') {
      const id = normalizeProviderId(providerId);
      const adapter = normalizedAdapters.get(id);
      if (adapter) return adapter;
      const planned = PLANNED_PROVIDERS[id];
      if (planned) throw new Error(`Provider ${id} is planned but not available yet`);
      throw new Error(`Unknown provider: ${id}`);
    },
    async call(providerId, operation, payload) {
      const adapter = registry.require(providerId);
      if (!operationSupported(adapter, operation)) {
        throw new Error(`Provider ${adapter.id} does not support ${operation}`);
      }
      return adapter[operation](payload);
    },
  };
  return registry;
}

module.exports = {
  PLANNED_PROVIDERS,
  createProviderRegistry,
  normalizeProviderId,
};
