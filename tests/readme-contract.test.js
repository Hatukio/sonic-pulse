const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readme = () => fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

test('README documents the Chinese AI provider choices and user-paid API key boundary', () => {
  const content = readme();

  for (const token of ['豆包 / 火山方舟', '通义千问 / 阿里云百炼', 'DeepSeek', 'Ollama', 'LM Studio']) {
    assert.match(content, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing ${token}`);
  }
  assert.match(content, /API Key[^。\n]*用户自己|用户自己[^。\n]*API Key/);
  assert.match(content, /不会把 API Key 写入设置|API Key 不会写入设置/);
  assert.match(content, /自动定位天气|定位.*天气/);
  assert.match(content, /Open-Meteo[^。\n]*(无需|不需要).*API Key|无需.*API Key[^。\n]*Open-Meteo/);
  assert.match(content, /不会保存.*经纬度|经纬度.*不会保存/);
});

test('README documents local camera gestures and official-source music provider boundaries', () => {
  const content = readme();

  assert.match(content, /摄像头手势/);
  assert.match(content, /不上传|不会上传/);
  assert.match(content, /QQ 音乐[^。\n]*官方.*凭证|官方.*凭证[^。\n]*QQ 音乐/);
  assert.match(content, /汽水音乐[^。\n]*官方.*凭证|官方.*凭证[^。\n]*汽水音乐/);
  assert.match(content, /Apple Music[^。\n]*(计划|困难|后续)/);
});
