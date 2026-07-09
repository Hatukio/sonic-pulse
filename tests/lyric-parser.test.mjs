import test from 'node:test';
import assert from 'node:assert/strict';

import {
  distributeWords,
  findLyricState,
  mergeTranslations,
  parseLRC,
  parseWordTimedLyrics,
} from '../public/src/lyrics/lyric-parser.mjs';

test('parseLRC supports multiple timestamps, centiseconds, milliseconds, and metadata', () => {
  const lines = parseLRC([
    '[ar:Sonic Pulse]',
    '[00:04.250]Later',
    '[00:01.50][00:02.500]Echo',
    '[ti:Arc Theatre]',
  ].join('\n'));

  assert.deepEqual(lines.map(({ time, text }) => ({ time, text })), [
    { time: 1.5, text: 'Echo' },
    { time: 2.5, text: 'Echo' },
    { time: 4.25, text: 'Later' },
  ]);
  assert.deepEqual(lines.map(line => line.end), [2.5, 4.25, 10.25]);
});

test('parseLRC preserves source order for duplicate timestamps and gives them a useful interval', () => {
  const lines = parseLRC('[00:01.000]First\n[00:01.000]Second\n[00:03.000]Third');

  assert.deepEqual(lines.map(line => line.text), ['First', 'Second', 'Third']);
  assert.deepEqual(lines.map(line => line.end), [3, 3, 9]);
});

test('parseLRC ignores metadata tags even when they share a timed line', () => {
  const lines = parseLRC('[ar:Arc Theatre][by:Sonic Pulse][00:01.00]Glow');

  assert.equal(lines[0].text, 'Glow');
});

test('parseWordTimedLyrics preserves valid provider timing and clamps words monotonically to the line', () => {
  const [line] = parseWordTimedLyrics(
    '[1000,2000](900,500,0)We(1300,900,0) become(1900,1800,0) light',
  );

  assert.equal(line.time, 1);
  assert.equal(line.end, 3);
  assert.equal(line.text, 'We become light');
  assert.deepEqual(line.words, [
    { text: 'We', start: 1, end: 1.4 },
    { text: ' become', start: 1.4, end: 2.2 },
    { text: ' light', start: 2.2, end: 3 },
  ]);
});

test('parseWordTimedLyrics filters malformed lines and words without producing NaN', () => {
  const lines = parseWordTimedLyrics([
    '[bad,2000](1000,500,0)Bad',
    '[1000,-2](1000,500,0)Bad',
    '[2000,1000](oops,10,0)Bad(2200,300,0)Good(2400,-1,0)Bad',
    '[5000,1000](5000,0,0)Zero',
  ].join('\n'));

  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Good');
  assert.deepEqual(lines[0].words, [{ text: 'Good', start: 2.2, end: 2.5 }]);
  assert.ok(lines.every(line => Number.isFinite(line.time) && Number.isFinite(line.end)));
});

test('parseWordTimedLyrics keeps duplicate line times stable', () => {
  const lines = parseWordTimedLyrics([
    '[1000,1000](1000,500,0)First',
    '[1000,1000](1000,500,0)Second',
  ].join('\n'));

  assert.deepEqual(lines.map(line => line.text), ['First', 'Second']);
});

test('parseWordTimedLyrics preserves every valid word through severe provider overlap', () => {
  const [line] = parseWordTimedLyrics(
    '[1000,1000](1000,900,0)A(1000,100,0)B(1000,100,0)C',
  );

  assert.equal(line.text, 'ABC');
  assert.deepEqual(line.words.map(word => word.text), ['A', 'B', 'C']);
  assert.ok(line.words.every((word, index) => word.start >= line.time
    && word.end <= line.end
    && word.end > word.start
    && (index === 0 || word.start >= line.words[index - 1].end)));
});

test('distributeWords splits Latin by word and CJK by grapheme', () => {
  const latin = distributeWords({ time: 1, end: 4, text: 'We become light' });
  const cjk = distributeWords({ time: 0, end: 4, text: '光影交织' });

  assert.deepEqual(latin.map(word => word.text), ['We', 'become', 'light']);
  assert.deepEqual(cjk.map(word => word.text), ['光', '影', '交', '织']);
});

test('distributeWords uses injected grapheme segmentation and gives punctuation half weight', () => {
  const segmenter = {
    segment(text) {
      if (text === '你👩‍🚀！') return [
        { segment: '你', isWordLike: true },
        { segment: '👩‍🚀', isWordLike: false },
        { segment: '！', isWordLike: false },
      ];
      return [{ segment: text, isWordLike: true }];
    },
  };
  const words = distributeWords(
    { time: 0, end: 2, text: '你👩‍🚀！' },
    2,
    { segmenter },
  );

  assert.deepEqual(words.map(word => word.text), ['你', '👩‍🚀', '！']);
  const cjkDuration = words[0].end - words[0].start;
  const emojiDuration = words[1].end - words[1].start;
  const punctuationDuration = words[2].end - words[2].start;
  assert.ok(Math.abs(cjkDuration - emojiDuration) < 1e-12);
  assert.ok(Math.abs(punctuationDuration - cjkDuration / 2) < 1e-12);
});

test('distributeWords creates monotonic timing bounded by the line interval', () => {
  const words = distributeWords({ time: 1.5, text: 'We become light' }, 4);

  assert.equal(words[0].start, 1.5);
  assert.ok(words[1].start > words[0].start);
  assert.equal(words.at(-1).end, 4);
  assert.ok(words.every((word, index) => word.end >= word.start
    && (index === 0 || word.start >= words[index - 1].end)));
});

test('mergeTranslations matches within tolerance without mutating source lines', () => {
  const lines = [{ time: 1, end: 2, text: 'Glow' }, { time: 3, end: 4, text: 'Light' }];
  const merged = mergeTranslations(lines, [
    { time: 1.49, text: '发光' },
    { time: 3.51, text: '太远' },
  ]);

  assert.equal(merged[0].translation, '发光');
  assert.equal(merged[1].translation, '');
  assert.equal('translation' in lines[0], false);
});

test('mergeTranslations chooses the closest dense match and never reuses a translation', () => {
  const lines = [
    { time: 1, end: 1.3, text: 'One' },
    { time: 1.3, end: 1.6, text: 'Two' },
    { time: 1.6, end: 2, text: 'Three' },
  ];
  const translations = [
    { time: 0.7, text: 'too early' },
    { time: 1.05, text: '一' },
    { time: 1.31, text: '二' },
    { time: 1.59, text: '三' },
  ];

  assert.deepEqual(
    mergeTranslations(lines, translations).map(line => line.translation),
    ['一', '二', '三'],
  );
  assert.deepEqual(
    mergeTranslations(
      [{ time: 1, text: 'A' }, { time: 1.2, text: 'B' }],
      [{ time: 1.1, text: 'only' }],
    ).map(line => line.translation),
    ['only', ''],
  );
  assert.deepEqual(
    mergeTranslations(
      [{ time: 1, text: 'A' }, { time: 1.1, text: 'B' }],
      [{ time: 1.05, text: 'first' }, { time: 1.05, text: 'second' }],
    ).map(line => line.translation),
    ['first', 'second'],
  );
});

test('findLyricState handles empty lyrics and time before the first line', () => {
  assert.deepEqual(findLyricState([], 2), { lineIndex: -1, wordIndex: -1, progress: 0 });
  assert.deepEqual(findLyricState([{ time: 5, end: 7, text: 'Soon' }], 2), {
    lineIndex: -1,
    wordIndex: -1,
    progress: 0,
  });
});

test('findLyricState finds the active provider word with unrounded progress', () => {
  const line = {
    time: 1,
    end: 3,
    text: 'We glow',
    words: [
      { text: 'We', start: 1, end: 2 },
      { text: 'glow', start: 2, end: 3 },
    ],
  };

  assert.deepEqual(findLyricState([line], 2.2), {
    lineIndex: 0,
    wordIndex: 1,
    progress: 0.20000000000000018,
  });
});

test('findLyricState holds the previous word through a word gap', () => {
  const line = {
    time: 1,
    end: 4,
    text: 'We glow',
    words: [
      { text: 'We', start: 1, end: 1.5 },
      { text: 'glow', start: 2, end: 3 },
    ],
  };

  assert.deepEqual(findLyricState([line], 1.75), {
    lineIndex: 0,
    wordIndex: 0,
    progress: 1,
  });
});

test('findLyricState holds the previous line in a line gap and clamps after the final line', () => {
  const lines = [
    { time: 1, end: 2, text: 'One', words: [{ text: 'One', start: 1, end: 2 }] },
    { time: 4, end: 5, text: 'Two', words: [{ text: 'Two', start: 4, end: 5 }] },
  ];

  assert.deepEqual(findLyricState(lines, 3), { lineIndex: 0, wordIndex: 0, progress: 1 });
  assert.deepEqual(findLyricState(lines, 8), { lineIndex: 1, wordIndex: 0, progress: 1 });
});

test('findLyricState honors stable source order when timestamps are duplicated', () => {
  const lines = parseLRC('[00:01.00]First\n[00:01.00]Second\n[00:03.00]Third');

  assert.equal(findLyricState(lines, 1.5).lineIndex, 0);
});
