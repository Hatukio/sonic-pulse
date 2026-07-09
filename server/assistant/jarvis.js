'use strict';

const net = require('node:net');

const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';
const DEFAULT_LM_STUDIO_ENDPOINT = 'http://127.0.0.1:1234/v1';
const DEFAULT_DOUBAO_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_QWEN_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_DEEPSEEK_ENDPOINT = 'https://api.deepseek.com';
const DEFAULT_MODELS = Object.freeze({
  local: 'sonic-local-companion',
  doubao: 'doubao-1-5-pro-32k-250115',
  qwen: 'qwen-plus',
  deepseek: 'deepseek-v4-flash',
  ollama: 'llama3.2',
  lmstudio: 'local-model',
  openaiCompatible: 'user-selected-model',
});

const PROVIDERS = new Set(['local', 'doubao', 'qwen', 'deepseek', 'ollama', 'lmstudio', 'openaiCompatible']);
const ONLINE_PROVIDERS = new Set(['doubao', 'qwen', 'deepseek', 'openaiCompatible']);

function clampText(value, limit = 2000) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function normalizeProvider(provider) {
  return PROVIDERS.has(provider) ? provider : 'local';
}

function normalizeMood(value) {
  return ['auto', 'calm', 'focus', 'tired', 'happy', 'sad', 'night'].includes(value) ? value : 'auto';
}

function normalizedContext(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    mood: normalizeMood(source.mood),
    weather: clampText(source.weather || '未知天气', 80),
    date: clampText(source.date, 80),
    time: clampText(source.time, 80),
    currentSong: clampText(source.currentSong || '尚未播放歌曲', 160),
    artist: clampText(source.artist || '', 120),
    playbackState: clampText(source.playbackState || 'idle', 40),
    recentSkips: Number.isFinite(source.recentSkips) ? Math.max(0, Math.min(99, Math.round(source.recentSkips))) : 0,
  };
}

function buildAssistantCatalog() {
  return [
    {
      id: 'local',
      name: 'Sonic 本地陪伴',
      cost: 'free',
      online: false,
      description: '不需要 Key，不调用云端模型；用本地规则根据时间、心情和播放状态给陪伴话术。',
    },
    {
      id: 'doubao',
      name: '豆包 / 火山方舟',
      cost: 'user-paid-or-free-tier',
      online: true,
      defaultEndpoint: DEFAULT_DOUBAO_ENDPOINT,
      defaultModel: DEFAULT_MODELS.doubao,
      description: '用户填写自己的火山方舟 API Key，Sonic 通过兼容 OpenAI 的 Chat 接口调用豆包。',
    },
    {
      id: 'qwen',
      name: '通义千问 / 阿里云百炼',
      cost: 'user-paid-or-free-tier',
      online: true,
      defaultEndpoint: DEFAULT_QWEN_ENDPOINT,
      defaultModel: DEFAULT_MODELS.qwen,
      description: '用户填写自己的百炼 API Key，可替换为业务空间专属域名和千问模型。',
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      cost: 'user-paid-or-free-tier',
      online: true,
      defaultEndpoint: DEFAULT_DEEPSEEK_ENDPOINT,
      defaultModel: DEFAULT_MODELS.deepseek,
      description: '用户填写自己的 DeepSeek API Key，适合中文推理与陪伴推荐。',
    },
    {
      id: 'ollama',
      name: 'Ollama 本地模型',
      cost: 'free-local',
      online: false,
      defaultEndpoint: DEFAULT_OLLAMA_ENDPOINT,
      defaultModel: DEFAULT_MODELS.ollama,
      description: '用户自己安装 Ollama 和开源模型，Sonic 只连接本机 API。',
    },
    {
      id: 'lmstudio',
      name: 'LM Studio 本地模型',
      cost: 'free-local',
      online: false,
      defaultEndpoint: DEFAULT_LM_STUDIO_ENDPOINT,
      defaultModel: DEFAULT_MODELS.lmstudio,
      description: '用户在 LM Studio 启动本地 OpenAI-compatible server 后连接。',
    },
    {
      id: 'openaiCompatible',
      name: 'OpenAI-compatible 自定义',
      cost: 'user-paid-or-free-tier',
      online: true,
      description: '用户自己填写 endpoint、模型和 API Key，可接 OpenAI-compatible 服务或自建网关。',
    },
  ];
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (!net.isIP(normalized)) return false;
  return normalized.startsWith('127.') || normalized === '::1';
}

function validateEndpoint(rawEndpoint, provider) {
  const fallback = {
    ollama: DEFAULT_OLLAMA_ENDPOINT,
    lmstudio: DEFAULT_LM_STUDIO_ENDPOINT,
    doubao: DEFAULT_DOUBAO_ENDPOINT,
    qwen: DEFAULT_QWEN_ENDPOINT,
    deepseek: DEFAULT_DEEPSEEK_ENDPOINT,
  }[provider] || '';
  const value = clampText(rawEndpoint, 2048) || fallback;
  if (!value) throw new Error('请先配置模型服务地址');
  let url;
  try { url = new URL(value); }
  catch { throw new Error('模型服务地址格式无效'); }
  if (url.username || url.password) throw new Error('模型服务地址不能包含账号密码');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('模型服务只支持 HTTP/HTTPS');
  if ((provider === 'ollama' || provider === 'lmstudio') && !isLoopbackHostname(url.hostname)) {
    throw new Error('本地模型 Provider 只允许连接 localhost / 127.0.0.1');
  }
  if (ONLINE_PROVIDERS.has(provider) && url.protocol !== 'https:' && !isLoopbackHostname(url.hostname)) {
    throw new Error('自定义在线模型请使用 HTTPS；HTTP 仅允许 localhost');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

function joinUrl(base, suffix) {
  const next = new URL(base.toString());
  const basePath = next.pathname.replace(/\/+$/, '');
  next.pathname = `${basePath}${suffix}`;
  return next;
}

async function postJson(url, payload, { headers = {}, fetchImpl = globalThis.fetch, timeoutMs = 30_000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持 fetch');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.error || `模型服务请求失败 (${response.status})`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function buildSystemPrompt(context) {
  return [
    '你是 Sonic Pulse 的 Jarvis 音乐陪伴。',
    '你不是普通聊天机器人，要像轻声陪伴的音乐 DJ：简短、温柔、有审美判断。',
    '你可以根据时间、天气、心情、当前歌曲和播放状态推荐下一首歌的方向。',
    '回答必须适合语音播报，控制在 2 到 4 句话，不要输出 Markdown。',
    `当前上下文：日期 ${context.date || '未知'}，时间 ${context.time || '未知'}，天气 ${context.weather}，心情 ${context.mood}，当前歌曲 ${context.currentSong}${context.artist ? ` / ${context.artist}` : ''}，播放状态 ${context.playbackState}。`,
  ].join('\n');
}

function localCompanionReply({ message = '', context = {} } = {}) {
  const c = normalizedContext(context);
  const hour = Number((c.time.match(/\b(\d{1,2})[:：]/) || [])[1]);
  const night = c.mood === 'night' || Number.isFinite(hour) && (hour >= 22 || hour <= 5);
  const rainy = /雨|rain|storm|thunder/i.test(c.weather);
  const tired = c.mood === 'tired' || /累|困|睡|疲惫/.test(message);
  const sad = c.mood === 'sad' || /难过|emo|低落|不开心/.test(message);
  const focus = c.mood === 'focus' || /工作|学习|专注|写代码/.test(message);

  let vibe = '轻盈电子和流行旋律';
  let query = '轻盈电子 流行 推荐';
  let speak = '我先用 Sonic 本地陪伴模式，不会调用任何付费模型。';
  if (night || tired) {
    vibe = '低 BPM、空气感人声和睡前氛围';
    query = '睡前 低BPM 空气感人声';
    speak = '时间有点晚了，我建议把能量降下来，换成更柔软的睡前氛围。';
  } else if (rainy) {
    vibe = '雨夜 city pop、Lo-fi 和低饱和 R&B';
    query = '雨夜 Lo-fi R&B';
    speak = '外面像是适合慢下来的天气，我会偏向雨夜感和低饱和旋律。';
  } else if (sad) {
    vibe = '温柔但不压抑的旋律，先接住情绪再慢慢提亮';
    query = '温柔 治愈 不压抑';
    speak = '我不会硬把气氛拉高，先给你一点能接住情绪的歌，再慢慢把光调回来。';
  } else if (focus) {
    vibe = '少人声、稳定节奏、适合专注的电子与器乐';
    query = '专注 电子 器乐';
    speak = '我会减少人声干扰，给你偏稳定脉冲的歌，适合保持专注。';
  } else if (c.mood === 'happy') {
    vibe = '明亮 synth pop、funk 和轻快节奏';
    query = '明亮 synth pop funk';
    speak = '现在可以稍微亮一点，我会选更有弹性和光泽感的歌。';
  }

  return {
    provider: 'local',
    model: DEFAULT_MODELS.local,
    text: `${speak} 推荐方向：${vibe}。你也可以告诉我“更安静一点”或“来点震撼的”。`,
    speak,
    recommendations: [
      { title: vibe, query, reason: '根据当前时间、天气/心情和播放状态生成的方向' },
    ],
    actions: [
      { type: 'search', label: '搜索推荐音乐', keyword: query },
    ],
  };
}

function normalizeAssistantResult(result, fallback = {}) {
  const text = clampText(result?.text || result?.message?.content || result?.response || fallback.text || '', 1200);
  return {
    provider: fallback.provider || 'local',
    model: fallback.model || '',
    text: text || '我在，但这次没有拿到有效回复。',
    speak: clampText(result?.speak || text, 360),
    recommendations: Array.isArray(result?.recommendations) ? result.recommendations.slice(0, 5) : [],
    actions: Array.isArray(result?.actions) ? result.actions.slice(0, 5) : [],
  };
}

async function callOllama({ endpoint, model, message, context, fetchImpl }) {
  const base = validateEndpoint(endpoint, 'ollama');
  const payload = await postJson(joinUrl(base, '/api/chat'), {
    model: clampText(model, 100) || DEFAULT_MODELS.ollama,
    stream: false,
    messages: [
      { role: 'system', content: buildSystemPrompt(context) },
      { role: 'user', content: message },
    ],
  }, { fetchImpl });
  return normalizeAssistantResult(payload, {
    provider: 'ollama',
    model: clampText(model, 100) || DEFAULT_MODELS.ollama,
    text: payload?.message?.content,
  });
}

function openAIChatUrl(endpoint, provider = 'openaiCompatible') {
  const base = validateEndpoint(endpoint, provider);
  if (base.pathname.endsWith('/chat/completions')) return base;
  const path = provider === 'openaiCompatible' && !base.pathname.endsWith('/v1')
    ? '/v1/chat/completions'
    : '/chat/completions';
  return joinUrl(base, path);
}

async function callOpenAICompatible({ endpoint, model, apiKey, message, context, fetchImpl, provider = 'openaiCompatible' }) {
  const trimmedKey = clampText(apiKey, 4096);
  const base = validateEndpoint(endpoint, provider);
  if (ONLINE_PROVIDERS.has(provider) && !trimmedKey && !isLoopbackHostname(base.hostname)) {
    throw new Error('在线模型 Provider 需要用户自己的 API Key');
  }
  const url = provider === 'lmstudio'
    ? joinUrl(validateEndpoint(endpoint, 'lmstudio'), '/chat/completions')
    : openAIChatUrl(base.toString(), provider);
  const payload = await postJson(url, {
    model: clampText(model, 100) || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openaiCompatible,
    messages: [
      { role: 'system', content: buildSystemPrompt(context) },
      { role: 'user', content: message },
    ],
    temperature: 0.8,
    max_tokens: 420,
    stream: false,
  }, {
    fetchImpl,
    headers: trimmedKey ? { Authorization: `Bearer ${trimmedKey}` } : {},
  });
  return normalizeAssistantResult(payload, {
    provider,
    model: clampText(model, 100) || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openaiCompatible,
    text: payload?.choices?.[0]?.message?.content,
  });
}

async function runAssistantTurn(body = {}, options = {}) {
  const provider = normalizeProvider(body.provider);
  const message = clampText(body.message || '根据现在的状态推荐音乐', 1000);
  const context = normalizedContext(body.context);
  const model = clampText(body.model, 100);
  if (provider === 'local') return localCompanionReply({ message, context });
  if (provider === 'ollama') return callOllama({
    endpoint: body.endpoint || DEFAULT_OLLAMA_ENDPOINT,
    model,
    message,
    context,
    fetchImpl: options.fetchImpl,
  });
  if (provider === 'lmstudio') return callOpenAICompatible({
    endpoint: body.endpoint || DEFAULT_LM_STUDIO_ENDPOINT,
    model,
    message,
    context,
    provider: 'lmstudio',
    fetchImpl: options.fetchImpl,
  });
  if (provider === 'doubao' || provider === 'qwen' || provider === 'deepseek') return callOpenAICompatible({
    endpoint: body.endpoint || validateEndpoint('', provider).toString(),
    model,
    apiKey: body.apiKey,
    message,
    context,
    provider,
    fetchImpl: options.fetchImpl,
  });
  return callOpenAICompatible({
    endpoint: body.endpoint,
    model,
    apiKey: body.apiKey,
    message,
    context,
    provider: 'openaiCompatible',
    fetchImpl: options.fetchImpl,
  });
}

module.exports = {
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_LM_STUDIO_ENDPOINT,
  DEFAULT_DOUBAO_ENDPOINT,
  DEFAULT_QWEN_ENDPOINT,
  DEFAULT_DEEPSEEK_ENDPOINT,
  buildAssistantCatalog,
  buildSystemPrompt,
  isLoopbackHostname,
  localCompanionReply,
  normalizeProvider,
  runAssistantTurn,
  validateEndpoint,
};
