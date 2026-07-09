const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { app, providers } = require('../server');

function requestJson(server, path) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port: server.address().port,
      path,
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body); } catch {}
        resolve({ status: response.statusCode, payload });
      });
    });
    request.on('error', reject);
  });
}

test('search route dispatches the requested provider through ProviderRegistry', async () => {
  const server = app.listen(0);
  const originalCall = providers.call;
  const calls = [];
  providers.call = async (provider, operation, payload) => {
    calls.push({ provider, operation, payload });
    const error = new Error('QQ 音乐 搜索 需要官方开放平台凭证');
    error.status = 501;
    throw error;
  };

  try {
    const response = await requestJson(server, '/api/search?provider=qq&keyword=%E8%B5%B7%E9%A3%8E%E4%BA%86&limit=7');
    assert.equal(response.status, 501);
    assert.deepEqual(calls, [{
      provider: 'qq',
      operation: 'search',
      payload: { keyword: '起风了', limit: '7' },
    }]);
    assert.match(response.payload.error, /官方开放平台凭证/);
  } finally {
    providers.call = originalCall;
    await new Promise(resolve => server.close(resolve));
  }
});
