'use strict';

const DEFAULT_CAPABILITIES = Object.freeze({
  search: true,
  playlists: false,
  tracks: false,
  audioUrl: false,
  lyrics: true,
  mv: true,
  login: true,
});

function normalizeRequiredEnv(requiredEnv = []) {
  return [...new Set((Array.isArray(requiredEnv) ? requiredEnv : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))];
}

function missingCredentials(requiredEnv, env) {
  return requiredEnv.filter(key => !String(env?.[key] || '').trim());
}

function createCredentialError(provider, operation) {
  const missing = provider.missingCredentials.length
    ? `缺少 ${provider.missingCredentials.join('、')}`
    : '未配置官方授权令牌';
  const error = new Error(
    `${provider.name} ${operation} 需要官方开放平台凭证，${missing}。请先在 ${provider.docsUrl} 申请/配置后再启用，Sonic 不使用非官方抓取接口。`,
  );
  error.status = 501;
  error.code = 'PROVIDER_NEEDS_OFFICIAL_CREDENTIALS';
  error.provider = provider.id;
  error.docsUrl = provider.docsUrl;
  return error;
}

function createCredentialProvider({
  id,
  name,
  docsUrl,
  requiredEnv = [],
  capabilities = {},
  env = process.env,
} = {}) {
  const providerId = String(id || '').trim().toLowerCase();
  if (!providerId) throw new Error('Credential provider requires an id');
  const normalizedRequiredEnv = normalizeRequiredEnv(requiredEnv);
  const missing = missingCredentials(normalizedRequiredEnv, env);
  const configured = normalizedRequiredEnv.length > 0 && missing.length === 0;
  const provider = {
    id: providerId,
    name: name || providerId,
    implemented: true,
    planned: false,
    platform: 'windows-macos',
    authRequired: true,
    configured,
    status: configured ? 'configured' : 'needs_credentials',
    docsUrl,
    requiredEnv: normalizedRequiredEnv,
    missingCredentials: missing,
    credentialHint: normalizedRequiredEnv.length
      ? `设置 ${normalizedRequiredEnv.join('、')} 后启用官方接口`
      : '设置平台官方凭证后启用',
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      ...capabilities,
    },
  };

  const reject = operation => async () => {
    throw createCredentialError(provider, operation);
  };

  return {
    ...provider,
    search: reject('搜索'),
    lyric: reject('歌词'),
    lyrics: reject('歌词'),
    mv: reject('官方 MV'),
    mvDetail: reject('官方 MV'),
    sessionStatus() {
      return {
        provider: provider.id,
        loggedIn: false,
        configured: provider.configured,
        status: provider.status,
        docsUrl: provider.docsUrl,
        requiredEnv: provider.requiredEnv.slice(),
        missingCredentials: provider.missingCredentials.slice(),
      };
    },
  };
}

module.exports = {
  createCredentialProvider,
};
