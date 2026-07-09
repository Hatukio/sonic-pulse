const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAssistantCatalog,
  isLoopbackHostname,
  localCompanionReply,
  runAssistantTurn,
  validateEndpoint,
} = require('../server/assistant/jarvis');

test('assistant catalog defaults to free or user-owned model providers', () => {
  const providers = buildAssistantCatalog();

  assert.deepEqual(providers.map(provider => provider.id), ['local', 'doubao', 'qwen', 'deepseek', 'ollama', 'lmstudio', 'openaiCompatible']);
  assert.equal(providers[0].cost, 'free');
  assert.equal(providers[1].defaultEndpoint, 'https://ark.cn-beijing.volces.com/api/v3');
  assert.equal(providers[2].defaultModel, 'qwen-plus');
  assert.equal(providers[3].defaultEndpoint, 'https://api.deepseek.com');
  assert.equal(providers[4].online, false);
  assert.equal(providers[5].defaultEndpoint, 'http://127.0.0.1:1234/v1');
  assert.equal(providers[6].cost, 'user-paid-or-free-tier');
});

test('local Jarvis companion returns a free no-network recommendation', () => {
  const reply = localCompanionReply({
    message: '我今天写代码有点累',
    context: {
      mood: 'focus',
      time: '23:18',
      weather: '小雨',
      currentSong: 'Night Drive',
      playbackState: 'playing',
    },
  });

  assert.equal(reply.provider, 'local');
  assert.equal(reply.model, 'sonic-local-companion');
  assert.match(reply.text, /不会调用任何付费模型|推荐方向/);
  assert.ok(reply.recommendations.length >= 1);
  assert.match(reply.recommendations[0].query, /专注|电子|器乐|睡前|Lo-fi|R&B|pop/i);
  assert.deepEqual(reply.actions[0], {
    type: 'search',
    label: '搜索推荐音乐',
    keyword: reply.recommendations[0].query,
  });
});

test('assistant endpoints prevent unsafe local-provider and remote-http connections', () => {
  assert.equal(isLoopbackHostname('localhost'), true);
  assert.equal(isLoopbackHostname('127.0.0.1'), true);
  assert.equal(isLoopbackHostname('example.com'), false);

  assert.equal(validateEndpoint('', 'ollama').toString(), 'http://127.0.0.1:11434/');
  assert.throws(() => validateEndpoint('http://example.com:11434', 'ollama'), /localhost|127\.0\.0\.1/);
  assert.throws(() => validateEndpoint('http://api.example.com/v1', 'openaiCompatible'), /HTTPS/);
  assert.throws(() => validateEndpoint('https://user:pass@example.com/v1', 'openaiCompatible'), /账号密码/);
});

test('Ollama provider calls the local chat API and normalizes the reply', async () => {
  const calls = [];
  const result = await runAssistantTurn({
    provider: 'ollama',
    model: 'llama3.2',
    endpoint: 'http://127.0.0.1:11434',
    message: '推荐一首适合夜晚的歌',
    context: { mood: 'night', time: '23:00' },
  }, {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) });
      return {
        ok: true,
        json: async () => ({ message: { content: '今晚建议听低 BPM、空气感强一点的歌。' } }),
      };
    },
  });

  assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(calls[0].body.stream, false);
  assert.equal(calls[0].body.messages[0].role, 'system');
  assert.equal(result.provider, 'ollama');
  assert.match(result.text, /低 BPM/);
});

test('remote OpenAI-compatible providers require the user session API key', async () => {
  await assert.rejects(
    () => runAssistantTurn({
      provider: 'openaiCompatible',
      endpoint: 'https://api.example.com/v1',
      model: 'demo',
      message: 'hello',
    }, { fetchImpl: async () => { throw new Error('should not fetch'); } }),
    /API Key/,
  );
});

test('Chinese model providers call their official OpenAI-compatible chat endpoints', async () => {
  const cases = [
    {
      provider: 'doubao',
      model: 'doubao-1-5-pro-32k-250115',
      endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
      expectedUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    },
    {
      provider: 'qwen',
      model: 'qwen-plus',
      endpoint: 'https://example-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      expectedUrl: 'https://example-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
    },
    {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      endpoint: 'https://api.deepseek.com',
      expectedUrl: 'https://api.deepseek.com/chat/completions',
    },
  ];

  for (const item of cases) {
    const calls = [];
    const result = await runAssistantTurn({
      provider: item.provider,
      model: item.model,
      endpoint: item.endpoint,
      apiKey: 'user-session-key',
      message: '推荐一首中文歌',
      context: { mood: 'calm' },
    }, {
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), body: JSON.parse(options.body), auth: options.headers.Authorization });
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: `${item.provider} says hi` } }] }),
        };
      },
    });

    assert.equal(calls[0].url, item.expectedUrl);
    assert.equal(calls[0].body.model, item.model);
    assert.equal(calls[0].auth, 'Bearer user-session-key');
    assert.equal(result.provider, item.provider);
  }
});

test('Chinese online providers require the user supplied API key', async () => {
  await assert.rejects(
    () => runAssistantTurn({
      provider: 'deepseek',
      endpoint: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      message: 'hello',
    }, { fetchImpl: async () => { throw new Error('should not fetch'); } }),
    /API Key/,
  );
});
