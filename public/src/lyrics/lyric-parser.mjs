const TIMESTAMP_PATTERN = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const METADATA_PATTERN = /\[(?:ar|al|ti|by|offset|re|ve|length):[^\]]*\]/giu;
const WORD_PATTERN = /\((\d+),(\d+),\d+\)([^()]*)/g;
const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const PUNCTUATION_PATTERN = /^[\p{P}\p{S}]+$/u;

function toSeconds(minutes, seconds, fraction = '') {
  const base = Number(minutes) * 60 + Number(seconds);
  return base + (fraction ? Number(fraction) / (10 ** fraction.length) : 0);
}

function nextDistinctTime(lines, index, fallback = 6) {
  const current = lines[index].time;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor].time > current) return lines[cursor].time;
  }
  return current + fallback;
}

export function parseLRC(text = '') {
  const lines = [];
  let order = 0;

  for (const raw of String(text).split(/\r?\n/u)) {
    const timestamps = [...raw.matchAll(TIMESTAMP_PATTERN)];
    if (timestamps.length === 0) continue;
    const value = raw.replace(TIMESTAMP_PATTERN, '').replace(METADATA_PATTERN, '').trim();
    if (!value) continue;

    for (const match of timestamps) {
      const time = toSeconds(match[1], match[2], match[3]);
      if (Number.isFinite(time) && time >= 0) {
        lines.push({ time, text: value, order: order += 1 });
      }
    }
  }

  lines.sort((left, right) => left.time - right.time || left.order - right.order);
  return lines.map((line, index) => ({
    time: line.time,
    end: nextDistinctTime(lines, index),
    text: line.text,
  }));
}

function parseProviderWords(raw, lineStart, lineEnd) {
  const candidates = [];

  for (const match of raw.matchAll(WORD_PATTERN)) {
    const providerStart = Number(match[1]) / 1000;
    const providerDuration = Number(match[2]) / 1000;
    const text = match[3];
    if (!text || !Number.isFinite(providerStart) || !Number.isFinite(providerDuration)
      || providerDuration <= 0) continue;
    candidates.push({
      text,
      providerStart,
      providerEnd: providerStart + providerDuration,
    });
  }

  if (candidates.length === 0) return [];
  const words = [];
  let cursor = lineStart;
  const lineDuration = lineEnd - lineStart;
  const minimumSpan = Math.min(0.01, lineDuration / (candidates.length * 2));

  candidates.forEach((candidate, index) => {
    const remaining = candidates.length - index - 1;
    const latestEnd = lineEnd - minimumSpan * remaining;
    const latestStart = latestEnd - minimumSpan;
    const start = Math.min(latestStart, Math.max(lineStart, cursor, candidate.providerStart));
    const end = Math.min(latestEnd, Math.max(start + minimumSpan, candidate.providerEnd));
    words.push({ text: candidate.text, start, end });
    cursor = end;
  });

  return words;
}

export function parseWordTimedLyrics(text = '') {
  const lines = [];
  let order = 0;

  for (const raw of String(text).split(/\r?\n/u)) {
    const header = raw.match(/^\s*\[(\d+),(\d+)\]/u);
    if (!header) continue;
    const lineStart = Number(header[1]) / 1000;
    const duration = Number(header[2]) / 1000;
    const lineEnd = lineStart + duration;
    if (!Number.isFinite(lineStart) || !Number.isFinite(duration)
      || lineStart < 0 || duration <= 0 || !Number.isFinite(lineEnd)) continue;

    const words = parseProviderWords(raw.slice(header[0].length), lineStart, lineEnd);
    if (words.length === 0) continue;
    lines.push({
      time: lineStart,
      end: lineEnd,
      text: words.map(word => word.text).join('').trim(),
      words,
      order: order += 1,
    });
  }

  lines.sort((left, right) => left.time - right.time || left.order - right.order);
  return lines.map(({ order: _order, ...line }) => line);
}

function fallbackSegments(text) {
  return text.match(/[\p{Script=Latin}\p{N}\p{M}]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s]/gu) || [];
}

function graphemes(text) {
  if (typeof Intl?.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(text)].map(item => item.segment);
  }
  return Array.from(text);
}

function tokensFor(text, { segmenter } = {}) {
  const value = String(text || '').trim();
  if (!value) return [];

  const activeSegmenter = segmenter || (typeof Intl?.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null);
  if (!activeSegmenter?.segment) return fallbackSegments(value);

  return [...activeSegmenter.segment(value)].flatMap(item => {
    const segment = typeof item === 'string' ? item : item.segment;
    if (!segment || /^\s+$/u.test(segment)) return [];
    return CJK_PATTERN.test(segment) && segment.length > 1 ? graphemes(segment) : [segment];
  });
}

function tokenWeight(token) {
  if (PUNCTUATION_PATTERN.test(token)) return 0.5;
  return Math.max(1, graphemes(token).length);
}

export function distributeWords(line, nextTime = line?.end ?? Number(line?.time || 0) + 6, options = {}) {
  const startTime = Number(line?.time);
  const requestedEnd = Number(nextTime);
  if (!Number.isFinite(startTime)) return [];
  const endTime = Number.isFinite(requestedEnd) && requestedEnd > startTime
    ? requestedEnd
    : startTime + 0.2;
  const tokens = tokensFor(line?.text, options);
  if (tokens.length === 0) return [];

  const weights = tokens.map(tokenWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const duration = endTime - startTime;
  let cursor = startTime;

  return tokens.map((text, index) => {
    const start = cursor;
    cursor = index === tokens.length - 1
      ? endTime
      : cursor + (duration * weights[index]) / totalWeight;
    return { text, start, end: cursor };
  });
}

export function mergeTranslations(lines = [], translations = [], tolerance = 0.5) {
  const safeTolerance = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0.5;
  const candidates = translations.filter(item => Number.isFinite(item?.time)
    && typeof item?.text === 'string' && item.text);
  let translationIndex = 0;

  return lines.map(line => {
    const lowerBound = line.time - safeTolerance;
    const upperBound = line.time + safeTolerance;
    while (translationIndex < candidates.length
      && candidates[translationIndex].time < lowerBound) translationIndex += 1;

    let bestIndex = translationIndex;
    if (bestIndex >= candidates.length || candidates[bestIndex].time > upperBound) {
      return { ...line, translation: '' };
    }

    let bestDistance = Math.abs(candidates[bestIndex].time - line.time);
    while (bestIndex + 1 < candidates.length
      && candidates[bestIndex + 1].time <= upperBound) {
      const nextDistance = Math.abs(candidates[bestIndex + 1].time - line.time);
      if (nextDistance >= bestDistance) break;
      bestIndex += 1;
      bestDistance = nextDistance;
    }

    const match = candidates[bestIndex];
    translationIndex = bestIndex + 1;
    return { ...line, translation: match.text };
  });
}

function latestLineAtOrBefore(lines, time) {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (lines[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  let index = low - 1;
  while (index > 0 && lines[index - 1].time === lines[index].time) index -= 1;
  return index;
}

export function findLyricState(lines = [], time = 0) {
  if (!Array.isArray(lines) || lines.length === 0 || !Number.isFinite(time)) {
    return { lineIndex: -1, wordIndex: -1, progress: 0 };
  }

  const lineIndex = latestLineAtOrBefore(lines, time);
  if (lineIndex < 0) return { lineIndex: -1, wordIndex: -1, progress: 0 };

  const line = lines[lineIndex];
  const words = Array.isArray(line.words) && line.words.length > 0
    ? line.words
    : distributeWords(line, line.end);
  if (words.length === 0) return { lineIndex, wordIndex: -1, progress: 0 };

  let wordIndex = -1;
  for (let index = 0; index < words.length; index += 1) {
    if (words[index].start <= time) wordIndex = index;
    else break;
  }
  if (wordIndex < 0) return { lineIndex, wordIndex: -1, progress: 0 };

  const word = words[wordIndex];
  const duration = Math.max(0.001, word.end - word.start);
  const progress = Math.max(0, Math.min(1, (time - word.start) / duration));
  return { lineIndex, wordIndex, progress };
}
