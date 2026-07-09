const api = globalThis.desktopLyricsAPI;
const root = document.documentElement;
const body = document.body;
const previous = document.getElementById('lyricPrev');
const current = document.getElementById('lyricCurrent');
const translation = document.getElementById('lyricTranslation');
const next = document.getElementById('lyricNext');
const finishLayout = document.getElementById('finishLayout');
const lockState = document.getElementById('lockState');

function lineText(line) {
  return typeof line?.text === 'string' ? line.text : '';
}

function renderCurrentLine(line, wordIndex, progress) {
  current.replaceChildren();
  const text = lineText(line);
  const words = Array.isArray(line?.words) && line.words.length
    ? line.words
    : (text ? [{ text }] : []);
  current.classList.toggle('is-spaced', /\s/u.test(text));

  words.forEach((word, index) => {
    const segment = document.createElement('span');
    segment.className = 'word';
    const base = document.createElement('span');
    base.className = 'word-base';
    base.textContent = lineText(word);
    const fill = document.createElement('span');
    fill.className = 'word-fill';
    fill.textContent = lineText(word);
    const wordProgress = index < wordIndex ? 1 : (index === wordIndex ? progress : 0);
    segment.style.setProperty('--word-progress', String(wordProgress));
    fill.style.setProperty('--word-progress', String(wordProgress));
    segment.append(base, fill);
    current.append(segment);
  });
}

function applyState(state = {}) {
  const palette = Array.isArray(state.palette) ? state.palette : [];
  root.style.setProperty('--lyric-primary', palette[0] || '#65faff');
  root.style.setProperty('--lyric-accent', palette[1] || palette[0] || '#ffb45e');
  root.style.setProperty('--lyric-intensity', String(state.intensity ?? 0.8));
  root.style.setProperty('--lyric-progress', String(state.progress ?? 0));
  root.style.setProperty('--desktop-opacity', String(state.opacity ?? 0.88));
  root.style.setProperty('--motion-phase', String(state.motionPhase ?? 0));
  root.style.setProperty('--audio-energy', String(state.audioEnergy ?? 0));
  body.dataset.style = state.style || 'depth';
  body.dataset.personality = state.personality || 'auto';
  body.dataset.locked = String(state.locked !== false);
  body.classList.toggle('layout-mode', state.layoutMode === true);
  if (lockState) lockState.textContent = state.locked === false || state.layoutMode === true ? '可拖拽编辑' : '点击穿透';
  previous.textContent = lineText(state.prev);
  next.textContent = lineText(state.next);
  translation.textContent = typeof state.current?.translation === 'string'
    ? state.current.translation
    : '';
  renderCurrentLine(state.current, state.wordIndex ?? -1, state.progress ?? 0);
}

let pendingBounds = null;
let boundsFrame = 0;

function flushBounds() {
  boundsFrame = 0;
  if (!pendingBounds || !api) return;
  const bounds = pendingBounds;
  pendingBounds = null;
  api.setBounds(bounds).catch(() => {});
}

function queueBounds(bounds) {
  pendingBounds = bounds;
  if (!boundsFrame) boundsFrame = requestAnimationFrame(flushBounds);
}

function beginResize(event) {
  if (!body.classList.contains('layout-mode') || !api) return;
  event.preventDefault();
  const handle = event.currentTarget;
  const direction = handle.dataset.resize;
  const initialPointer = { x: event.screenX, y: event.screenY };
  const initialBounds = {
    x: globalThis.screenX,
    y: globalThis.screenY,
    width: globalThis.outerWidth,
    height: globalThis.outerHeight,
  };
  handle.setPointerCapture(event.pointerId);

  const move = moveEvent => {
    const dx = moveEvent.screenX - initialPointer.x;
    const dy = moveEvent.screenY - initialPointer.y;
    const proposed = { ...initialBounds };
    if (direction.includes('e')) proposed.width += dx;
    if (direction.includes('s')) proposed.height += dy;
    if (direction.includes('w')) {
      proposed.x += dx;
      proposed.width -= dx;
    }
    if (direction.includes('n')) {
      proposed.y += dy;
      proposed.height -= dy;
    }
    queueBounds(proposed);
  };

  const stop = stopEvent => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', stop);
    handle.removeEventListener('pointercancel', stop);
    if (handle.hasPointerCapture(stopEvent.pointerId)) handle.releasePointerCapture(stopEvent.pointerId);
  };

  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

document.querySelectorAll('[data-resize]').forEach(handle => {
  handle.addEventListener('pointerdown', beginResize);
});

finishLayout.addEventListener('click', () => {
  api?.finishLayout().catch(() => {});
});

const unsubscribe = api?.onState(applyState);
globalThis.addEventListener('beforeunload', () => {
  unsubscribe?.();
  if (boundsFrame) cancelAnimationFrame(boundsFrame);
}, { once: true });

applyState();
