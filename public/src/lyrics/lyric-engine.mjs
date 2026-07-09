import {
  distributeWords,
  findLyricState,
  mergeTranslations,
  parseLRC,
  parseWordTimedLyrics,
} from './lyric-parser.mjs';

const STYLES = new Set(['auto', 'depth', 'orbit', 'particles', 'energy']);
const PERSONALITIES = new Set(['auto', 'ambient', 'pop', 'impact', 'fluid']);
const STYLE_FOR_PERSONALITY = Object.freeze({
  auto: 'depth',
  ambient: 'depth',
  pop: 'orbit',
  impact: 'energy',
  fluid: 'particles',
});
const DEFAULT_PALETTE = Object.freeze(['#65faff', '#ffb45e']);

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach(child => deepFreeze(child, seen));
  return Object.freeze(value);
}

function emptyState() {
  return deepFreeze({
    current: null,
    prev: null,
    next: null,
    lineIndex: -1,
    wordIndex: -1,
    progress: 0,
    style: 'depth',
    personality: 'auto',
    palette: [...DEFAULT_PALETTE],
    intensity: 0.8,
  });
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function eventWithDetail(type, detail) {
  if (typeof CustomEvent === 'function') return new CustomEvent(type, { detail });
  const event = new Event(type);
  Object.defineProperty(event, 'detail', { value: detail, enumerable: true });
  return event;
}

function responseError(response) {
  return new Error(`Lyric request failed (${response?.status ?? 'unknown'})`);
}

function normalizedPalette(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const colors = value.filter(color => typeof color === 'string' && color.trim()).map(color => color.trim());
  return colors.length > 0 ? colors : fallback;
}

function fallbackWordTiming(lines) {
  return lines.map(line => ({
    ...line,
    words: distributeWords(line, line.end),
  }));
}

function translationLines(payload) {
  for (const source of [payload?.ytlrc, payload?.tlyric]) {
    const parsed = parseLRC(source);
    if (parsed.length > 0) return parsed;
    const providerParsed = parseWordTimedLyrics(source);
    if (providerParsed.length > 0) return providerParsed;
  }
  return [];
}

function positiveSongId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function samePalette(left = [], right = []) {
  return left.length === right.length && left.every((color, index) => color === right[index]);
}

function sameLine(left, right) {
  return left === right || (left?.time === right?.time
    && left?.text === right?.text
    && left?.translation === right?.translation);
}

function sameObservableState(left, right) {
  return Boolean(left && right)
    && left.lineIndex === right.lineIndex
    && left.wordIndex === right.wordIndex
    && left.progress === right.progress
    && left.style === right.style
    && left.personality === right.personality
    && left.intensity === right.intensity
    && samePalette(left.palette, right.palette)
    && sameLine(left.current, right.current)
    && sameLine(left.prev, right.prev)
    && sameLine(left.next, right.next);
}

function isCriticalChange(previous, next) {
  return !previous
    || previous.lineIndex !== next.lineIndex
    || previous.wordIndex !== next.wordIndex
    || previous.style !== next.style
    || previous.personality !== next.personality
    || !sameLine(previous.current, next.current);
}

export class LyricEngine extends EventTarget {
  constructor({
    fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
    audio = null,
    clock = null,
    style = 'auto',
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    eventInterval = 33,
  } = {}) {
    super();
    if (typeof fetchImpl !== 'function') throw new TypeError('LyricEngine requires fetch');
    this.fetch = fetchImpl;
    this.audio = audio;
    this.clock = typeof clock === 'function' ? clock : null;
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.eventInterval = Number.isFinite(eventInterval) && eventInterval >= 0 ? eventInterval : 33;
    this.style = STYLES.has(style) ? style : 'auto';
    this._lines = deepFreeze([]);
    this._state = emptyState();
    this.lastEmittedState = null;
    this.lastEventTime = Number.NEGATIVE_INFINITY;
    this.requestGeneration = 0;
    this.abortController = null;
    this.destroyed = false;
  }

  get lines() {
    return this._lines;
  }

  get state() {
    return this._state;
  }

  async load(id) {
    const songId = positiveSongId(id);
    if (!songId) throw new TypeError('LyricEngine song id must be a positive integer');
    if (this.destroyed) return [];
    const generation = ++this.requestGeneration;
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    this._lines = deepFreeze([]);

    try {
      const response = await this.fetch(`/api/lyrics/${songId}`, {
        signal: controller.signal,
      });
      if (!response?.ok) throw responseError(response);
      const payload = await response.json();
      if (this.destroyed || generation !== this.requestGeneration) return [];

      const providerLines = parseWordTimedLyrics(payload?.yrc);
      const baseLines = providerLines.length > 0
        ? providerLines
        : fallbackWordTiming(parseLRC(payload?.lrc));
      this._lines = deepFreeze(mergeTranslations(baseLines, translationLines(payload)));
      return this._lines;
    } catch (error) {
      if (this.destroyed || generation !== this.requestGeneration
        || error?.name === 'AbortError' || controller.signal.aborted) return [];
      throw error;
    } finally {
      if (generation === this.requestGeneration && this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  setStyle(style) {
    this.style = STYLES.has(style) ? style : 'auto';
    return this.style;
  }

  setEventInterval(milliseconds) {
    this.eventInterval = Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : 33;
    return this.eventInterval;
  }

  clear() {
    if (this.destroyed) return this._state;
    this.requestGeneration += 1;
    this.abortController?.abort();
    this.abortController = null;
    this._lines = deepFreeze([]);
    this._state = emptyState();
    this.lastEmittedState = this._state;
    this.lastEventTime = Number(this.now());
    this.dispatchEvent(eventWithDetail('statechange', this._state));
    return this._state;
  }

  currentTime() {
    const value = this.clock ? this.clock() : this.audio?.currentTime;
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  update(presentation = {}) {
    if (this.destroyed) return this._state;
    const time = Number.isFinite(presentation.time) && presentation.time >= 0
      ? presentation.time
      : this.currentTime();
    const lyricState = findLyricState(this.lines, time);
    const personality = PERSONALITIES.has(presentation.personality)
      ? presentation.personality
      : (presentation.personality === undefined ? this._state.personality : 'auto');
    const palette = normalizedPalette(presentation.palette, this._state.palette);
    const intensity = Number.isFinite(presentation.intensity)
      ? clamp(presentation.intensity, 0, 1)
      : this._state.intensity;
    const style = this.style === 'auto' ? STYLE_FOR_PERSONALITY[personality] : this.style;
    const current = lyricState.lineIndex >= 0 ? this._lines[lyricState.lineIndex] : null;

    const nextState = deepFreeze({
      current,
      prev: lyricState.lineIndex > 0 ? this._lines[lyricState.lineIndex - 1] : null,
      next: lyricState.lineIndex >= 0
        ? (this._lines[lyricState.lineIndex + 1] || null)
        : (this._lines[0] || null),
      lineIndex: lyricState.lineIndex,
      wordIndex: lyricState.wordIndex,
      progress: lyricState.progress,
      style,
      personality,
      palette: [...palette],
      intensity,
    });
    this._state = nextState;

    const timestamp = Number(this.now());
    const eventTime = Number.isFinite(timestamp) ? timestamp : Date.now();
    const changed = !sameObservableState(this.lastEmittedState, nextState);
    const intervalElapsed = eventTime - this.lastEventTime >= this.eventInterval;
    if (changed && (isCriticalChange(this.lastEmittedState, nextState) || intervalElapsed)) {
      this.lastEmittedState = nextState;
      this.lastEventTime = eventTime;
      this.dispatchEvent(eventWithDetail('statechange', nextState));
    }
    return nextState;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.requestGeneration += 1;
    this.abortController?.abort();
    this.abortController = null;
    this._lines = deepFreeze([]);
    this._state = emptyState();
    this.lastEmittedState = null;
  }
}
