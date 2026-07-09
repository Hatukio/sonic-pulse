'use strict';

const DEFAULT_BOUNDS = Object.freeze({ width: 900, height: 240 });
const DEFAULT_PALETTE = Object.freeze(['#65faff', '#ffb45e']);
const STYLES = new Set(['depth', 'orbit', 'particles', 'energy']);
const PERSONALITIES = new Set(['auto', 'ambient', 'pop', 'impact', 'fluid']);
const PLACEMENTS = new Set(['center', 'bottom', 'left', 'right']);
const COLOR_PATTERN = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function assertWorkArea(workArea) {
  const valid = workArea
    && typeof workArea === 'object'
    && Number.isFinite(workArea.x)
    && Number.isFinite(workArea.y)
    && Number.isFinite(workArea.width)
    && Number.isFinite(workArea.height)
    && workArea.width > 0
    && workArea.height > 0;
  if (!valid) throw new TypeError('Desktop lyrics require a valid work area');
}

function normalizeDesktopBounds(bounds, workArea) {
  assertWorkArea(workArea);
  const source = bounds && typeof bounds === 'object' ? bounds : {};
  const width = Math.min(
    workArea.width,
    Math.max(Math.min(320, workArea.width), finiteNumber(source.width, DEFAULT_BOUNDS.width)),
  );
  const height = Math.min(
    workArea.height,
    Math.max(Math.min(120, workArea.height), finiteNumber(source.height, DEFAULT_BOUNDS.height)),
  );
  const defaultX = workArea.x + (workArea.width - width) / 2;
  const defaultY = workArea.y + workArea.height - height - 80;
  const requestedX = finiteNumber(source.x, defaultX);
  const requestedY = finiteNumber(source.y, defaultY);
  const x = Math.min(workArea.x + workArea.width - width, Math.max(workArea.x, requestedX));
  const y = Math.min(workArea.y + workArea.height - height, Math.max(workArea.y, requestedY));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function sameDesktopBounds(left, right) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  return ['x', 'y', 'width', 'height'].every(key => (
    Number.isFinite(left[key])
    && Number.isFinite(right[key])
    && left[key] === right[key]
  ));
}

function boundedString(value, maximum = 500) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function boundedIndex(value) {
  return Number.isFinite(value) ? Math.max(-1, Math.floor(value)) : -1;
}

function clamp(value, minimum, maximum, fallback) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function normalizeColor(value) {
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) return null;
  const color = value.toLowerCase();
  if (color.length === 4 || color.length === 5) {
    return `#${[...color.slice(1)].map(character => character.repeat(2)).join('')}`;
  }
  return color;
}

function sanitizeWords(words) {
  if (!Array.isArray(words)) return [];
  return words.slice(0, 200).map(word => ({
    text: boundedString(word?.text, 80),
    start: clamp(word?.start, 0, 24 * 60 * 60, 0),
    end: clamp(word?.end, 0, 24 * 60 * 60, 0),
  }));
}

function sanitizeLine(line) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) return null;
  return {
    text: boundedString(line.text),
    translation: boundedString(line.translation),
    words: sanitizeWords(line.words),
  };
}

function sanitizeDesktopLyricState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const palette = Array.isArray(source.palette)
    ? source.palette.map(normalizeColor).filter(Boolean).slice(0, 4)
    : [];
  return {
    current: sanitizeLine(source.current),
    prev: sanitizeLine(source.prev),
    next: sanitizeLine(source.next),
    lineIndex: boundedIndex(source.lineIndex),
    wordIndex: boundedIndex(source.wordIndex),
    progress: clamp(source.progress, 0, 1, 0),
    style: STYLES.has(source.style) ? source.style : 'depth',
    personality: PERSONALITIES.has(source.personality) ? source.personality : 'auto',
    palette: palette.length ? palette : [...DEFAULT_PALETTE],
    intensity: clamp(source.intensity, 0, 1, 0.8),
    opacity: clamp(source.opacity, 0.2, 1, 0.88),
    locked: typeof source.locked === 'boolean' ? source.locked : true,
    placement: PLACEMENTS.has(source.placement) ? source.placement : 'bottom',
    motionPhase: clamp(source.motionPhase, 0, 1, 0),
    audioEnergy: clamp(source.audioEnergy, 0, 1, 0),
  };
}

module.exports = {
  normalizeDesktopBounds,
  sameDesktopBounds,
  sanitizeDesktopLyricState,
};
