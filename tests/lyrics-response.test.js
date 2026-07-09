const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeLyricsResponse } = require('../server');
const { app } = require('../server');

test('normalizes standard and enhanced provider lyric fields', () => {
  assert.deepEqual(normalizeLyricsResponse({
    lrc: { lyric: 'line' },
    tlyric: { lyric: 'translation' },
    yrc: { lyric: 'word timed' },
    ytlrc: { lyric: 'word translation' },
  }), {
    lrc: 'line',
    tlyric: 'translation',
    yrc: 'word timed',
    ytlrc: 'word translation',
  });
});

test('normalizes missing or malformed provider lyric fields to empty strings', () => {
  assert.deepEqual(normalizeLyricsResponse({ lrc: { lyric: 42 }, yrc: null }), {
    lrc: '',
    tlyric: '',
    yrc: '',
    ytlrc: '',
  });
});

test('lyrics route rejects invalid song ids with 400 before contacting the provider', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/lyrics/not-a-song`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /ID/i);
});
