import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('legacy draw loop yields immediately only after the Three scene is ready', () => {
  const drawStart = html.indexOf('function draw(){');
  const heavyWork = html.indexOf('const W=window.innerWidth', drawStart);
  const preamble = html.slice(drawStart, heavyWork);

  assert.ok(drawStart >= 0 && heavyWork > drawStart);
  assert.match(preamble, /requestAnimationFrame\(draw\);/);
  assert.match(preamble, /if\(document\.body\.classList\.contains\('three-ready'\)\) return;/);
  assert.ok(
    preamble.indexOf("classList.contains('three-ready')") > preamble.indexOf('requestAnimationFrame(draw)'),
  );
});

test('legacy audio creation publishes its complete graph for late module adoption', () => {
  assert.match(html, /window\.__sonicPulseAudioGraph=\{\s*audio,\s*context:audioCtx,\s*analyser,\s*source:audioSrc,\s*data:dataArray\s*\}/);
});
