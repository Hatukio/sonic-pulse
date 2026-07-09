import { AudioEngine } from './audio/audio-engine.mjs';
import { RenderScheduler } from './core/render-scheduler.mjs';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from './core/settings-store.mjs';
import {
  qualityAdjustedVisualSettings,
  recommendPerformanceQuality,
} from './core/performance-governor.mjs';
import { LyricEngine } from './lyrics/lyric-engine.mjs';
import { MVController } from './media/mv-controller.mjs';
import { JarvisConsole, formatFrameRate } from './ui/jarvis-console.mjs';
import { SceneEngine } from './visual/scene-engine.mjs';
import { VisualConductor } from './visual/visual-conductor.mjs';

export const STATUS = Object.freeze({
  READY: 'ready',
  LOADING: 'loading',
  DEGRADED: 'degraded',
  ERROR: 'error',
});

const VALID_STATUS = new Set(Object.values(STATUS));
const VALID_STATUS_SOURCES = new Set(['visual', 'lyrics', 'mv', 'desktop', 'performance', 'system']);

export function normalizeSubsystemReport(report = {}) {
  const valid = VALID_STATUS_SOURCES.has(report.source) && VALID_STATUS.has(report.status);
  if (!valid) return { source: 'system', status: STATUS.ERROR, message: '系统状态异常', recoverable: false };
  return {
    source: report.source,
    status: report.status,
    message: String(report.message || ''),
    recoverable: Boolean(report.recoverable),
  };
}

export function nextPerformanceWarning({ target, measuredFps, now, lowSince = null } = {}) {
  if (target === 'unlocked' || !Number.isFinite(target) || !Number.isFinite(measuredFps) || measuredFps >= target * 0.7) {
    return { lowSince: null, message: '' };
  }
  const since = Number.isFinite(lowSince) ? lowSince : now;
  return {
    lowSince: since,
    message: now - since >= 5000 ? `当前 ${measuredFps.toFixed(0)} FPS，低于选择的 ${target} FPS` : '',
  };
}

export function createOnceDisposer(disposers = [], onError = () => {}) {
  let disposed = false;
  return () => {
    if (disposed) return false;
    disposed = true;
    disposers.splice(0).forEach(dispose => {
      try { dispose(); } catch (error) { onError(error); }
    });
    return true;
  };
}

export function createAudioEngine(audioElement, windowRef = {}, options = {}) {
  return new AudioEngine(audioElement, {
    ...options,
    initialGraph: windowRef.__sonicPulseAudioGraph ?? options.initialGraph ?? null,
  });
}

export function createFrameHandler({ scheduler, audioEngine, conductor, scene, telemetry }) {
  return now => {
    if (!scheduler.shouldRender(now)) return false;
    const features = audioEngine.readFeatures();
    const conducted = conductor.update(features, 0.14, scheduler.deltaSeconds);
    scene.render({
      time: now / 1000,
      delta: scheduler.deltaSeconds,
      audio: features,
      personality: conducted.personality,
    });
    telemetry?.({ fps: scheduler.measuredFps, personality: conducted.personality });
    return true;
  };
}

export function restoreDesktopLyrics(settings, api) {
  if (!settings?.desktopLyrics?.enabled || typeof api?.open !== 'function') return null;
  return api.open(settings.desktopLyrics.bounds);
}

export const frameEventInterval = target => target === 'unlocked' ? 0 : 1000 / target;

export async function resetRuntimeDefaults({ mvController, desktopApi, layoutMode }) {
  mvController.disable();
  return layoutMode && desktopApi?.layout ? desktopApi.layout(false) : null;
}

export function resetMVForLocal(controller, present) {
  const detail = typeof controller.reset === 'function'
    ? controller.reset()
    : (controller.disable(), { state: 'unavailable', enabled: false, metadata: null });
  present(detail);
}

export const PLAY_MODES = Object.freeze(['sequence', 'repeat', 'shuffle']);

export function nextPlayMode(mode) {
  const index = PLAY_MODES.indexOf(mode);
  return index < 0 ? PLAY_MODES[0] : PLAY_MODES[(index + 1) % PLAY_MODES.length];
}

export function moveQueueItem(queue = [], fromIndex = -1, toIndex = -1) {
  if (!Array.isArray(queue)) return [];
  const from = Number(fromIndex);
  const to = Number(toIndex);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= queue.length || to >= queue.length || from === to) {
    return queue;
  }
  const next = queue.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const hasInlineMV = song => Boolean(song?.mv || song?.mvId || song?.mvid || song?.officialMV || song?.mvAvailable);

export function buildVinylShelfItems(songs = [], currentSong = null, mvAvailableIds = new Set()) {
  const available = mvAvailableIds instanceof Set ? mvAvailableIds : new Set(mvAvailableIds || []);
  return (Array.isArray(songs) ? songs : []).map((song, index) => {
    const id = String(song?.id ?? index);
    return {
      id,
      index,
      name: song?.name || song?.title || '未命名歌曲',
      artist: artistText(song) || '未知艺术家',
      artwork: artworkUrl(song),
      active: String(currentSong?.id ?? '') === id,
      hasMV: hasInlineMV(song) || available.has(id) || available.has(song?.id),
      source: song?.source || 'netease',
    };
  });
}

const artistText = song => {
  if (typeof song?.artists === 'string') return song.artists;
  const artists = song?.ar || song?.artists || [];
  return Array.isArray(artists) ? artists.map(artist => artist?.name).filter(Boolean).join(' / ') : '未知艺术家';
};

const artworkUrl = song => song?.albumPic || song?.picUrl || song?.al?.picUrl || song?.album?.picUrl || '';
const formatClock = seconds => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};

const eventOn = (target, type, listener, options, cleanup) => {
  target?.addEventListener?.(type, listener, options);
  cleanup.push(() => target?.removeEventListener?.(type, listener, options));
};

const safeJson = async response => {
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
  return payload;
};

const svgPauseLabel = playing => playing ? '暂停' : '播放';

function renderLyricState(stage, state, settings) {
  if (!stage) return;
  stage.dataset.style = state?.style || 'depth';
  stage.style.setProperty('--lyric-scale', String(settings.lyrics.size));
  stage.style.setProperty('--lyric-intensity', String(settings.lyrics.intensity));
  const previous = stage.querySelector('[data-lyric="previous"]');
  const current = stage.querySelector('[data-lyric="current"]');
  const translation = stage.querySelector('[data-lyric="translation"]');
  const next = stage.querySelector('[data-lyric="next"]');
  if (!state?.current) {
    previous.textContent = '';
    current.textContent = '让声音成为光';
    translation.textContent = '';
    next.textContent = state?.next?.text || '';
    return;
  }
  previous.textContent = state.prev?.text || '';
  next.textContent = state.next?.text || '';
  translation.textContent = settings.lyrics.translation ? state.current.translation || '' : '';
  current.replaceChildren();
  const words = state.current.words?.length ? state.current.words : [{ text: state.current.text }];
  words.forEach((word, index) => {
    const span = current.ownerDocument.createElement('span');
    span.className = `word${index < state.wordIndex ? ' is-past' : ''}${index === state.wordIndex ? ' is-active' : ''}`;
    span.textContent = word.text;
    current.append(span);
  });
}

function setRailOpen(shell, rail, trigger, open, type) {
  shell.dataset[type] = String(open);
  rail.setAttribute('aria-hidden', String(!open));
  trigger?.setAttribute('aria-expanded', String(open));
}

function imageFrom(url, windowRef, signal) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error('没有专辑封面'));
    const image = new windowRef.Image();
    image.crossOrigin = 'anonymous';
    const clear = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener?.('abort', abort);
    };
    const abort = () => {
      clear();
      image.src = '';
      reject(Object.assign(new Error('专辑封面请求已取消'), { name: 'AbortError' }));
    };
    image.onload = () => { clear(); resolve(image); };
    image.onerror = () => { clear(); reject(new Error('专辑封面加载失败')); };
    if (signal?.aborted) return abort();
    signal?.addEventListener?.('abort', abort, { once: true });
    image.src = url;
  });
}

export async function loadTrackArtwork({
  scene,
  url,
  windowRef,
  signal,
  isCurrent = () => true,
  fallbackAccent = '#e85c62',
} = {}) {
  if (!scene) return {
    source: 'visual', status: STATUS.DEGRADED,
    message: 'WebGL 不可用，已保留音频与歌词', recoverable: true,
  };
  try {
    const image = await imageFrom(url, windowRef, signal);
    if (signal?.aborted || !isCurrent()) return null;
    scene.setArtwork(image);
    return {
      source: 'visual', status: STATUS.READY,
      message: '专辑点云已生成', recoverable: true,
    };
  } catch (error) {
    if (signal?.aborted || !isCurrent() || error?.name === 'AbortError') return null;
    scene.setProceduralPalette?.(fallbackAccent);
    return {
      source: 'visual', status: STATUS.DEGRADED,
      message: '封面不可用，已生成平台色点云', recoverable: true,
    };
  }
}

export async function runRecoverableDesktopAction(action, { report = () => {}, toast = () => {} } = {}) {
  try { return await action(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report({ source: 'desktop', status: STATUS.ERROR, message, recoverable: true });
    toast(message);
    return null;
  }
}

async function confirmMVRows(songs, token, fetchImpl, onConfirmed, isCurrent) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < songs.length && isCurrent(token)) {
      const song = songs[cursor++];
      if (!Number.isSafeInteger(Number(song.id))) continue;
      try {
        const payload = await safeJson(await fetchImpl(`/api/song/${song.id}/mv`));
        if (isCurrent(token) && payload.available) onConfirmed(String(song.id));
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, songs.length) }, worker));
}

function rendererName(scene) {
  try {
    const gl = scene?.renderer?.getContext?.();
    return gl?.getParameter?.(gl.RENDERER) || 'Three.js / WebGL';
  } catch { return scene ? 'Three.js / WebGL' : '2D 降级'; }
}

export function startImmersiveApp({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  if (!documentRef || !windowRef) return null;
  const canvas = documentRef.getElementById('visualStage');
  const audio = documentRef.getElementById('audio');
  const video = documentRef.getElementById('mvLayer');
  const commandRail = documentRef.getElementById('commandRail');
  if (!canvas || !audio || !video || !commandRail) return null;

  const cleanup = [];
  const settingsStorage = windowRef.localStorage;
  let settings = loadSettings(settingsStorage);
  const scheduler = new RenderScheduler(settings.performance.frameRate);
  const audioEngine = createAudioEngine(audio, windowRef);
  const conductor = new VisualConductor();
  const lyricEngine = new LyricEngine({ audio, style: settings.lyrics.style, eventInterval: frameEventInterval(settings.performance.frameRate) });
  const mvController = new MVController({ video, fetchImpl: windowRef.fetch.bind(windowRef) });
  const jarvis = new JarvisConsole({ root: commandRail, settings });
  const report = value => jarvis.setSubsystemStatus(normalizeSubsystemReport(value));
  const shell = documentRef.getElementById('appShell');
  const lyricStage = documentRef.getElementById('lyricStage');
  let scene = null;
  try {
    scene = new SceneEngine({ canvas, settings: qualityAdjustedVisualSettings(settings) });
    documentRef.body.classList.add('three-ready');
    report({ source: 'visual', status: STATUS.READY, message: 'Three.js / WebGL 已就绪', recoverable: true });
  } catch (error) {
    canvas.hidden = true;
    documentRef.getElementById('systemStatus').textContent = 'WEBGL DEGRADED';
    console.warn('Three.js renderer unavailable.', error);
    report({ source: 'visual', status: STATUS.DEGRADED, message: 'WebGL 不可用，已保留音频与歌词', recoverable: true });
  }

  const runtime = {
    audioEngine, scheduler, conductor, lyricEngine, mvController, jarvis, scene,
    get settings() { return settings; },
    dispose() {},
  };
  windowRef.sonicPulse = runtime;

  const nodes = Object.fromEntries([
    'libraryRail','libraryToggle','libraryClose','energyCore','topFrameRate','playbackFps','systemStatus',
    'loginButton','logoutButton','accountName','accountDot','searchForm','searchInput','likedButton',
    'playlistList','trackList','libraryMessage','localAudio','trackTitle','trackArtist','trackArtwork',
    'artworkFallback','nowPlayingMVBadge','playButton','previousButton','nextButton','seekInput',
    'elapsedTime','durationTime','volumeInput','desktopLyricsToggle','desktopLayoutButton',
    'desktopResetButton','desktopDisplay','desktopLyricsLock','desktopPresetCenter','desktopPresetBottom',
    'desktopPresetLeft','desktopPresetRight','mvToggle','restoreDefaults','toast','vinylShelfCount',
    'vinylShelfList','vinylShelfEmpty','favoriteButton','playModeButton','playModeLabel',
    'lyricsToggleButton','immersiveButton','windowModeButton','moreActionsButton','playbackMorePopover',
  ].map(id => [id, documentRef.getElementById(id)]));

  let queue = [];
  let queueIndex = -1;
  let currentSong = null;
  let playMode = PLAY_MODES.includes(shell.dataset.playMode) ? shell.dataset.playMode : 'sequence';
  let localObjectUrl = null;
  let trackController = null;
  let loadVersion = 0;
  let listVersion = 0;
  let toastTimer = 0;
  let layoutMode = false;
  let lastTelemetry = 0;
  let lowFpsSince = null;
  let qualityAutoHold = false;
  let qualityHoldTimer = 0;
  let latestRenderMs = null;
  let animationFrame = 0;
  let dragQueueIndex = -1;
  const favoriteIds = new Set();
  const mvAvailableIds = new Set();
  const inputTimers = { mouse: 0, keyboard: 0 };

  const toast = (message, error = false) => {
    windowRef.clearTimeout(toastTimer);
    nodes.toast.textContent = message;
    nodes.toast.hidden = false;
    nodes.toast.classList.toggle('is-error', error);
    toastTimer = windowRef.setTimeout(() => { nodes.toast.hidden = true; }, 3500);
  };

  const setMessage = (message, state = '') => {
    nodes.libraryMessage.textContent = message;
    nodes.libraryMessage.className = `rail-message${state ? ` is-${state}` : ''}`;
  };

  const playModeText = mode => ({
    sequence: '顺序',
    repeat: '单曲',
    shuffle: '随机',
  }[mode] || '顺序');

  const updatePlaybackActionState = () => {
    const currentId = String(currentSong?.id ?? '');
    nodes.favoriteButton?.setAttribute('aria-pressed', String(Boolean(currentId && favoriteIds.has(currentId))));
    nodes.favoriteButton?.setAttribute('aria-label', favoriteIds.has(currentId) ? '取消喜欢当前歌曲' : '喜欢当前歌曲');
    shell.dataset.playMode = playMode;
    nodes.playModeButton?.setAttribute('data-play-mode', playMode);
    nodes.playModeButton?.setAttribute('aria-label', `播放方式：${playModeText(playMode)}播放`);
    if (nodes.playModeLabel) nodes.playModeLabel.textContent = playModeText(playMode);
    shell.dataset.lyricsVisible = String(settings.lyrics.enabled);
    nodes.lyricsToggleButton?.setAttribute('aria-pressed', String(settings.lyrics.enabled));
  };

  function persistDesktopResult(result, displayId = settings.desktopLyrics.displayId) {
    if (!result?.bounds) return settings;
    settings = saveSettings({
      ...settings,
      desktopLyrics: {
        ...settings.desktopLyrics,
        bounds: result.bounds,
        displayId: result.displayId ?? displayId,
      },
    }, settingsStorage);
    jarvis.setSettings(settings);
    return settings;
  }

  const applySettings = (candidate, persist = true) => {
    const previous = settings;
    settings = persist ? saveSettings(candidate, settingsStorage) : normalizeSettings(candidate);
    if (previous.performance.frameRate !== settings.performance.frameRate) scheduler.setTarget(settings.performance.frameRate);
    lyricEngine.setEventInterval(frameEventInterval(settings.performance.frameRate));
    scene?.applySettings(qualityAdjustedVisualSettings(settings));
    scene?.resize(windowRef.innerWidth, windowRef.innerHeight, windowRef.devicePixelRatio);
    lyricEngine.setStyle(settings.lyrics.style);
    jarvis.setSettings(settings);
    lyricStage.style.setProperty('--lyric-scale', String(settings.lyrics.size));
    lyricStage.style.setProperty('--lyric-intensity', String(settings.lyrics.intensity));
    nodes.topFrameRate.textContent = formatFrameRate(settings.performance.frameRate);
    nodes.playbackFps.textContent = formatFrameRate(settings.performance.frameRate);
    updatePlaybackActionState();
    renderLyricState(lyricStage, lyricEngine.state, settings);
    if (previous.desktopLyrics.enabled !== settings.desktopLyrics.enabled) {
      const api = windowRef.electronAPI?.desktopLyrics;
      if (!api) {
        if (settings.desktopLyrics.enabled) {
          toast('桌面歌词仅在 Electron 应用中可用', true);
          report({ source: 'desktop', status: STATUS.DEGRADED, message: '浏览器模式不可用', recoverable: true });
        }
      } else if (settings.desktopLyrics.enabled) {
        report({ source: 'desktop', status: STATUS.LOADING, message: '正在打开桌面歌词', recoverable: true });
        api.open(settings.desktopLyrics.bounds).then(result => {
          persistDesktopResult(result);
          return api.lock?.(settings.desktopLyrics.locked);
        }).then(result => {
          if (result?.bounds) persistDesktopResult(result);
          report({ source: 'desktop', status: STATUS.READY, message: '桌面歌词已连接', recoverable: true });
        }).catch(error => {
          toast(error.message, true);
          report({ source: 'desktop', status: STATUS.ERROR, message: error.message, recoverable: true });
        });
      } else api.close().then(persistDesktopResult).catch(error => toast(error.message, true));
    }
    if (settings.desktopLyrics.enabled) sendDesktopState(lyricEngine.state, { motionPhase: 0, audioEnergy: 0 });
    return settings;
  };

  const sendDesktopState = (state, motion = {}) => {
    if (!settings.desktopLyrics.enabled) return;
    windowRef.electronAPI?.desktopLyrics?.state({
      ...state,
      intensity: settings.desktopLyrics.intensity,
      opacity: settings.desktopLyrics.opacity,
      locked: settings.desktopLyrics.locked,
      placement: settings.desktopLyrics.placement,
      motionPhase: motion.motionPhase ?? 0,
      audioEnergy: motion.audioEnergy ?? 0,
    }).catch?.(() => {});
  };

  const setMVPresentation = detail => {
    jarvis.setMVState(detail);
    const active = Boolean(detail.enabled && (detail.state === 'playing' || detail.state === 'loading'));
    shell.dataset.mvActive = String(active);
    nodes.nowPlayingMVBadge.hidden = !detail.metadata?.available;
    scene?.setMVMode(active);
    const mvStatus = detail.state === 'loading' ? STATUS.LOADING
      : detail.state === 'error' ? STATUS.DEGRADED
        : STATUS.READY;
    report({
      source: 'mv',
      status: mvStatus,
      message: detail.state === 'loading' ? '正在确认官方源'
        : detail.state === 'error' ? '官方 MV 暂不可用，继续点云模式'
          : detail.metadata?.available ? '官方 MV 已确认' : '当前歌曲无官方 MV',
      recoverable: true,
    });
    if (detail.state === 'error' && detail.error) toast(detail.error.message || '官方 MV 暂不可用', true);
  };

  eventOn(mvController, 'statechange', event => setMVPresentation(event.detail), undefined, cleanup);
  eventOn(lyricEngine, 'statechange', event => {
    renderLyricState(lyricStage, event.detail, settings);
  }, undefined, cleanup);
  eventOn(jarvis, 'settingschange', async event => {
    if (event.detail.path === 'performance.quality') {
      lowFpsSince = null;
      qualityAutoHold = true;
      windowRef.clearTimeout(qualityHoldTimer);
      qualityHoldTimer = windowRef.setTimeout(() => { qualityAutoHold = false; }, 12000);
    }
    applySettings(event.detail.settings);
    if (event.detail.path === 'desktopLyrics.displayId' && event.detail.value) {
      const api = windowRef.electronAPI?.desktopLyrics;
      if (!api?.setDisplay) return;
      try { persistDesktopResult(await api.setDisplay(event.detail.value), String(event.detail.value)); }
      catch (error) { toast(error.message, true); }
    }
    if (event.detail.path === 'desktopLyrics.placement') {
      const api = windowRef.electronAPI?.desktopLyrics;
      if (!api?.applyPreset) return;
      try { persistDesktopResult(await api.applyPreset(event.detail.value, settings.desktopLyrics.displayId), settings.desktopLyrics.displayId); }
      catch (error) { toast(error.message, true); }
    }
    if (event.detail.path === 'desktopLyrics.locked') {
      const api = windowRef.electronAPI?.desktopLyrics;
      if (!api?.lock) return;
      try { persistDesktopResult(await api.lock(event.detail.value)); }
      catch (error) { toast(error.message, true); }
      layoutMode = !event.detail.value;
      nodes.desktopLayoutButton.textContent = layoutMode ? '完成并锁定' : '编辑位置';
    }
  }, undefined, cleanup);

  const resize = () => scene?.resize(windowRef.innerWidth, windowRef.innerHeight, windowRef.devicePixelRatio);
  resize();
  eventOn(windowRef, 'resize', resize, undefined, cleanup);

  const markInput = kind => {
    jarvis.setInputState(kind, true);
    windowRef.clearTimeout(inputTimers[kind]);
    inputTimers[kind] = windowRef.setTimeout(() => jarvis.setInputState(kind, false), 900);
  };
  eventOn(windowRef, 'pointermove', event => {
    markInput('mouse');
    scene?.setCameraInput((event.clientX / Math.max(1, windowRef.innerWidth)) * 2 - 1, (event.clientY / Math.max(1, windowRef.innerHeight)) * 2 - 1);
  }, { passive: true }, cleanup);
  eventOn(windowRef, 'keydown', () => markInput('keyboard'), undefined, cleanup);

  const updateTransport = () => {
    const duration = Number(audio.duration);
    const current = Number(audio.currentTime) || 0;
    nodes.elapsedTime.textContent = formatClock(current);
    nodes.durationTime.textContent = formatClock(duration);
    nodes.seekInput.value = Number.isFinite(duration) && duration > 0 ? String(Math.round(current / duration * 1000)) : '0';
  };
  eventOn(audio, 'timeupdate', updateTransport, undefined, cleanup);
  eventOn(audio, 'durationchange', updateTransport, undefined, cleanup);
  eventOn(audio, 'play', () => {
    shell.dataset.playing = 'true';
    nodes.playButton.setAttribute('aria-label', svgPauseLabel(true));
    audioEngine.ensureStarted().catch(error => toast(`音频分析不可用：${error.message}`, true));
    if (mvController.enabled) video.play().catch(() => {});
  }, undefined, cleanup);
  eventOn(audio, 'pause', () => {
    shell.dataset.playing = 'false';
    nodes.playButton.setAttribute('aria-label', svgPauseLabel(false));
    video.pause();
  }, undefined, cleanup);
  eventOn(audio, 'ended', () => runtime.next(), undefined, cleanup);
  eventOn(audio, 'error', () => toast('音频加载失败，可能需要会员权限', true), undefined, cleanup);

  const setTrackHeader = song => {
    nodes.trackTitle.textContent = song?.name || '尚未选择歌曲';
    nodes.trackArtist.textContent = artistText(song) || '未知艺术家';
    const url = artworkUrl(song);
    nodes.trackArtwork.src = url;
    nodes.trackArtwork.hidden = !url;
    nodes.trackArtwork.alt = url ? `${song.name} 专辑封面` : '';
    nodes.artworkFallback.hidden = Boolean(url);
    updatePlaybackActionState();
  };

  const renderVinylShelf = () => {
    const items = buildVinylShelfItems(queue, currentSong, mvAvailableIds);
    if (nodes.vinylShelfCount) nodes.vinylShelfCount.textContent = String(items.length);
    nodes.vinylShelfList?.replaceChildren();
    nodes.vinylShelfEmpty.hidden = items.length > 0;
    items.forEach(item => {
      const song = queue[item.index];
      const row = documentRef.createElement('li');
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'vinyl-card';
      button.draggable = true;
      button.dataset.songId = item.id;
      button.dataset.queueIndex = String(item.index);
      button.setAttribute('aria-current', String(item.active));
      button.setAttribute('aria-label', `${item.name} · ${item.artist}${item.hasMV ? ' · 有官方 MV' : ''}`);

      const record = documentRef.createElement('span');
      record.className = 'vinyl-record';
      if (item.artwork) {
        const image = documentRef.createElement('img');
        image.src = item.artwork;
        image.alt = '';
        record.append(image);
      }

      const meta = documentRef.createElement('span');
      meta.className = 'vinyl-meta';
      const title = documentRef.createElement('strong');
      title.textContent = item.name;
      const artist = documentRef.createElement('span');
      artist.textContent = item.artist;
      meta.append(title, artist);

      const badge = documentRef.createElement('span');
      badge.className = 'mv-badge';
      badge.textContent = 'MV';
      badge.hidden = !item.hasMV;

      button.append(record, meta, badge);
      button.addEventListener('click', () => runtime.playSong(song, Number(button.dataset.queueIndex)), { once: false });
      button.addEventListener('dragstart', event => {
        dragQueueIndex = Number(button.dataset.queueIndex);
        event.dataTransfer?.setData('text/plain', String(dragQueueIndex));
        event.dataTransfer?.setDragImage?.(record, 28, 28);
      });
      button.addEventListener('dragover', event => event.preventDefault());
      button.addEventListener('drop', event => {
        event.preventDefault();
        const from = Number(event.dataTransfer?.getData('text/plain') || dragQueueIndex);
        const to = Number(button.dataset.queueIndex);
        const nextQueue = moveQueueItem(queue, from, to);
        if (nextQueue === queue) return;
        queue = nextQueue;
        queueIndex = currentSong ? queue.findIndex(candidate => String(candidate.id) === String(currentSong.id)) : -1;
        renderVinylShelf();
      });
      row.append(button);
      nodes.vinylShelfList?.append(row);
    });
  };

  const updateCurrentRow = () => {
    nodes.trackList.querySelectorAll('[data-song-id]').forEach(row => row.setAttribute('aria-current', String(String(currentSong?.id) === row.dataset.songId)));
    nodes.vinylShelfList?.querySelectorAll('[data-song-id]').forEach(row => row.setAttribute('aria-current', String(String(currentSong?.id) === row.dataset.songId)));
  };

  runtime.playSong = async (song, index = queue.findIndex(item => String(item.id) === String(song.id))) => {
    const version = ++loadVersion;
    trackController?.abort();
    trackController = new AbortController();
    const { signal } = trackController;
    if (localObjectUrl) { windowRef.URL.revokeObjectURL(localObjectUrl); localObjectUrl = null; }
    currentSong = song;
    queueIndex = index;
    setTrackHeader(song);
    updateCurrentRow();
    renderVinylShelf();
    nodes.nowPlayingMVBadge.hidden = true;
    setMessage(`正在加载 ${song.name}`, 'loading');
    audio.src = `/api/audio/${encodeURIComponent(song.id)}`;
    audio.load();
    scene?.setArtwork(null);
    report({ source: 'lyrics', status: STATUS.LOADING, message: '正在同步逐字歌词', recoverable: true });
    const lyricWork = lyricEngine.load(song.id).then(lines => {
      if (version === loadVersion) report({
        source: 'lyrics',
        status: lines.length ? STATUS.READY : STATUS.DEGRADED,
        message: lines.length ? '歌词时间轴已同步' : '暂无歌词，保留沉浸视觉',
        recoverable: true,
      });
      return lines;
    }).catch(error => {
      if (version === loadVersion) {
        toast(`歌词不可用：${error.message}`, true);
        report({ source: 'lyrics', status: STATUS.DEGRADED, message: '歌词不可用，播放不受影响', recoverable: true });
      }
    });
    const detailWork = artworkUrl(song) ? Promise.resolve(song) : windowRef.fetch(`/api/song/${song.id}`, { signal }).then(safeJson).catch(() => song);
    const mvWork = mvController.discover(song.id);
    detailWork.then(async detail => {
      if (version !== loadVersion) return;
      const merged = { ...song, ...detail };
      currentSong = merged;
      if (queueIndex >= 0) queue[queueIndex] = merged;
      setTrackHeader(merged);
      renderVinylShelf();
      const artworkReport = await loadTrackArtwork({
        scene,
        url: artworkUrl(merged),
        windowRef,
        signal,
        isCurrent: () => version === loadVersion,
      });
      if (artworkReport) report(artworkReport);
    });
    await Promise.allSettled([lyricWork, mvWork]);
    if (version !== loadVersion) return;
    setMessage(`正在播放 · ${song.name}`);
    await audio.play().catch(error => toast(`无法播放：${error.message}`, true));
  };

  runtime.previous = () => {
    if (!queue.length) return;
    const index = (queueIndex - 1 + queue.length) % queue.length;
    runtime.playSong(queue[index], index);
  };
  runtime.next = () => {
    if (!queue.length) return;
    const index = playMode === 'repeat'
      ? Math.max(0, queueIndex)
      : playMode === 'shuffle' && queue.length > 1
        ? (queueIndex + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length
        : (queueIndex + 1) % queue.length;
    runtime.playSong(queue[index], index);
  };

  const discoverRowBadges = songs => {
    const token = ++listVersion;
    confirmMVRows(songs, token, windowRef.fetch.bind(windowRef), id => {
      mvAvailableIds.add(String(id));
      const badge = nodes.trackList.querySelector(`[data-song-id="${CSS.escape(id)}"] .mv-badge`);
      if (badge) badge.hidden = false;
      renderVinylShelf();
    }, value => value === listVersion);
  };

  const renderTracks = songs => {
    queue = songs;
    queueIndex = currentSong ? songs.findIndex(song => String(song.id) === String(currentSong.id)) : -1;
    renderVinylShelf();
    nodes.trackList.replaceChildren();
    songs.forEach((song, index) => {
      const item = documentRef.createElement('li');
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'track-row';
      button.dataset.songId = String(song.id);
      button.setAttribute('aria-current', String(String(currentSong?.id) === String(song.id)));
      const number = documentRef.createElement('span');
      number.className = 'track-number';
      number.textContent = String(index + 1).padStart(2, '0');
      const meta = documentRef.createElement('span');
      meta.className = 'track-meta';
      const title = documentRef.createElement('strong');
      title.textContent = song.name || '未命名歌曲';
      const artist = documentRef.createElement('span');
      artist.textContent = artistText(song);
      meta.append(title, artist);
      const badge = documentRef.createElement('span');
      badge.className = 'mv-badge';
      badge.textContent = 'MV';
      badge.hidden = true;
      button.append(number, meta, badge);
      button.addEventListener('click', () => runtime.playSong(song, index), { once: false });
      item.append(button);
      nodes.trackList.append(item);
    });
    setMessage(songs.length ? `${songs.length} 首歌曲 · 正在确认官方 MV` : '没有找到歌曲');
    renderVinylShelf();
    discoverRowBadges(songs);
  };

  const loadLiked = async () => {
    setMessage('正在加载我喜欢的音乐', 'loading');
    nodes.playlistList.replaceChildren();
    try { renderTracks((await safeJson(await windowRef.fetch('/api/liked'))).songs || []); }
    catch (error) { setMessage(error.message, 'error'); }
  };

  const loadPlaylists = async () => {
    setMessage('正在加载歌单', 'loading');
    nodes.trackList.replaceChildren();
    try {
      const playlists = (await safeJson(await windowRef.fetch('/api/playlists'))).playlist || [];
      nodes.playlistList.replaceChildren();
      playlists.forEach(playlist => {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.textContent = playlist.name;
        button.addEventListener('click', async () => {
          nodes.playlistList.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node === button)));
          setMessage(`正在读取 ${playlist.name}`, 'loading');
          try { renderTracks((await safeJson(await windowRef.fetch(`/api/playlist/${playlist.id}/tracks`))).songs || []); }
          catch (error) { setMessage(error.message, 'error'); }
        });
        nodes.playlistList.append(button);
      });
      setMessage(playlists.length ? '选择一个歌单' : '没有可用歌单');
    } catch (error) { setMessage(error.message, 'error'); }
  };

  const refreshAccount = async () => {
    try {
      const me = await safeJson(await windowRef.fetch('/api/me'));
      nodes.accountName.textContent = me.loggedIn ? me.nickname || '网易云已连接' : '网易云未连接';
      nodes.accountDot.classList.toggle('is-online', Boolean(me.loggedIn));
      nodes.loginButton.hidden = Boolean(me.loggedIn);
      nodes.logoutButton.hidden = !me.loggedIn;
      if (me.loggedIn) await loadLiked();
      return me;
    } catch (error) {
      setMessage(error.message, 'error');
      return { loggedIn: false };
    }
  };

  eventOn(nodes.libraryToggle, 'click', () => setRailOpen(shell, nodes.libraryRail, nodes.libraryToggle, shell.dataset.libraryOpen !== 'true', 'libraryOpen'), undefined, cleanup);
  eventOn(nodes.libraryClose, 'click', () => setRailOpen(shell, nodes.libraryRail, nodes.libraryToggle, false, 'libraryOpen'), undefined, cleanup);
  eventOn(nodes.energyCore, 'click', () => setRailOpen(shell, commandRail, nodes.energyCore, shell.dataset.consoleOpen !== 'true', 'consoleOpen'), undefined, cleanup);
  eventOn(nodes.likedButton, 'click', loadLiked, undefined, cleanup);
  documentRef.querySelectorAll('[data-library-view]').forEach(tab => eventOn(tab, 'click', () => {
    documentRef.querySelectorAll('[data-library-view]').forEach(node => node.setAttribute('aria-pressed', String(node === tab)));
    if (tab.dataset.libraryView === 'playlists') loadPlaylists();
  }, undefined, cleanup));
  eventOn(nodes.searchForm, 'submit', async event => {
    event.preventDefault();
    const keyword = nodes.searchInput.value.trim();
    if (!keyword) return;
    setMessage(`正在搜索 ${keyword}`, 'loading');
    try { renderTracks((await safeJson(await windowRef.fetch(`/api/search?keyword=${encodeURIComponent(keyword)}&limit=25`))).songs || []); }
    catch (error) { setMessage(error.message, 'error'); }
  }, undefined, cleanup);
  eventOn(nodes.loginButton, 'click', async () => {
    const api = windowRef.electronAPI;
    if (!api?.openLogin) return toast('登录需要在 Electron 应用中完成', true);
    nodes.loginButton.disabled = true;
    try {
      const result = await api.openLogin();
      if (!result?.cookie) return;
      await api.setCookie(result.cookie);
      await refreshAccount();
    } finally { nodes.loginButton.disabled = false; }
  }, undefined, cleanup);
  eventOn(nodes.logoutButton, 'click', async () => {
    await windowRef.fetch('/api/logout', { method: 'POST' });
    queue = [];
    currentSong = null;
    queueIndex = -1;
    nodes.trackList.replaceChildren();
    nodes.playlistList.replaceChildren();
    renderVinylShelf();
    await refreshAccount();
  }, undefined, cleanup);
  eventOn(nodes.localAudio, 'change', () => {
    const file = nodes.localAudio.files?.[0];
    if (!file) return;
    ++loadVersion;
    trackController?.abort();
    trackController = null;
    resetMVForLocal(mvController, setMVPresentation);
    const emptyLyrics = lyricEngine.clear();
    renderLyricState(lyricStage, emptyLyrics, settings);
    sendDesktopState(emptyLyrics, { motionPhase: 0, audioEnergy: 0 });
    report({ source: 'lyrics', status: STATUS.DEGRADED, message: '本地音频暂无在线歌词', recoverable: true });
    if (localObjectUrl) windowRef.URL.revokeObjectURL(localObjectUrl);
    localObjectUrl = windowRef.URL.createObjectURL(file);
    const song = { id: `local:${file.name}`, name: file.name.replace(/\.[^.]+$/, ''), artists: '本地音频', local: true };
    queue = [song]; queueIndex = 0; currentSong = song;
    setTrackHeader(song); scene?.setArtwork(null);
    renderVinylShelf();
    audio.src = localObjectUrl; audio.load(); audio.play().catch(error => toast(error.message, true));
    setMessage(`本地播放 · ${song.name}`);
  }, undefined, cleanup);

  eventOn(nodes.playButton, 'click', () => {
    if (!audio.src && queue[0]) return runtime.playSong(queue[0], 0);
    if (!audio.src) return setRailOpen(shell, nodes.libraryRail, nodes.libraryToggle, true, 'libraryOpen');
    if (audio.paused) audio.play().catch(error => toast(error.message, true));
    else audio.pause();
  }, undefined, cleanup);
  eventOn(nodes.previousButton, 'click', runtime.previous, undefined, cleanup);
  eventOn(nodes.nextButton, 'click', runtime.next, undefined, cleanup);
  eventOn(nodes.seekInput, 'input', () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Number(nodes.seekInput.value) / 1000 * audio.duration;
  }, undefined, cleanup);
  eventOn(nodes.volumeInput, 'input', () => { audio.volume = Number(nodes.volumeInput.value); }, undefined, cleanup);
  audio.volume = Number(nodes.volumeInput.value);

  eventOn(nodes.favoriteButton, 'click', () => {
    if (!currentSong) return setRailOpen(shell, nodes.libraryRail, nodes.libraryToggle, true, 'libraryOpen');
    const id = String(currentSong.id);
    if (favoriteIds.has(id)) {
      favoriteIds.delete(id);
      toast('已取消喜欢');
    } else {
      favoriteIds.add(id);
      toast('已加入喜欢');
    }
    updatePlaybackActionState();
  }, undefined, cleanup);
  eventOn(nodes.playModeButton, 'click', () => {
    playMode = nextPlayMode(playMode);
    updatePlaybackActionState();
    toast(`播放方式：${playModeText(playMode)}`);
  }, undefined, cleanup);
  eventOn(nodes.lyricsToggleButton, 'click', () => {
    applySettings({ ...settings, lyrics: { ...settings.lyrics, enabled: !settings.lyrics.enabled } });
    toast(settings.lyrics.enabled ? '主屏歌词已显示' : '主屏歌词已隐藏');
  }, undefined, cleanup);
  eventOn(nodes.immersiveButton, 'click', async () => {
    try {
      if (documentRef.fullscreenElement) await documentRef.exitFullscreen?.();
      else await shell.requestFullscreen?.();
    } catch (error) { toast(error.message || '无法进入全屏', true); }
  }, undefined, cleanup);
  eventOn(documentRef, 'fullscreenchange', () => {
    nodes.immersiveButton?.setAttribute('aria-pressed', String(Boolean(documentRef.fullscreenElement)));
  }, undefined, cleanup);
  eventOn(nodes.windowModeButton, 'click', () => {
    const expanded = shell.dataset.windowMode !== 'expanded';
    shell.dataset.windowMode = expanded ? 'expanded' : 'standard';
    nodes.windowModeButton.setAttribute('aria-pressed', String(expanded));
    toast(expanded ? '窗口沉浸模式已开启' : '窗口沉浸模式已关闭');
  }, undefined, cleanup);
  eventOn(nodes.moreActionsButton, 'click', () => {
    const open = nodes.moreActionsButton.getAttribute('aria-expanded') !== 'true';
    nodes.moreActionsButton.setAttribute('aria-expanded', String(open));
    nodes.playbackMorePopover.hidden = !open;
  }, undefined, cleanup);
  nodes.playbackMorePopover?.querySelectorAll('[data-quick-action]').forEach(button => eventOn(button, 'click', () => {
    nodes.moreActionsButton.setAttribute('aria-expanded', 'false');
    nodes.playbackMorePopover.hidden = true;
    if (button.dataset.quickAction === 'desktop') nodes.desktopLayoutButton.click();
    if (button.dataset.quickAction === 'mv') nodes.mvToggle.click();
    if (button.dataset.quickAction === 'console') setRailOpen(shell, commandRail, nodes.energyCore, true, 'consoleOpen');
  }, undefined, cleanup));
  eventOn(documentRef, 'click', event => {
    if (nodes.playbackMorePopover.hidden) return;
    if (nodes.playbackMorePopover.contains(event.target) || nodes.moreActionsButton.contains(event.target)) return;
    nodes.moreActionsButton.setAttribute('aria-expanded', 'false');
    nodes.playbackMorePopover.hidden = true;
  }, undefined, cleanup);

  eventOn(nodes.mvToggle, 'click', () => {
    if (mvController.enabled) mvController.disable();
    else mvController.enable();
  }, undefined, cleanup);
  eventOn(nodes.desktopLayoutButton, 'click', async () => {
    const api = windowRef.electronAPI?.desktopLyrics;
    if (!api) return toast('桌面歌词布局仅在 Electron 应用中可用', true);
    if (!settings.desktopLyrics.enabled) applySettings({ ...settings, desktopLyrics: { ...settings.desktopLyrics, enabled: true } });
    layoutMode = !layoutMode;
    settings = saveSettings({
      ...settings,
      desktopLyrics: { ...settings.desktopLyrics, locked: !layoutMode },
    }, settingsStorage);
    jarvis.setSettings(settings);
    const result = await runRecoverableDesktopAction(
      () => api.layout(layoutMode),
      { report, toast: message => toast(message, true) },
    );
    if (!result) { layoutMode = !layoutMode; return; }
    persistDesktopResult(result);
    nodes.desktopLayoutButton.textContent = layoutMode ? '完成并锁定' : '编辑位置';
    report({ source: 'desktop', status: STATUS.READY, message: layoutMode ? '布局模式已开启' : '桌面歌词已连接', recoverable: true });
  }, undefined, cleanup);
  eventOn(nodes.desktopResetButton, 'click', async () => {
    const api = windowRef.electronAPI?.desktopLyrics;
    if (!api) return toast('桌面歌词仅在 Electron 应用中可用', true);
    const result = await runRecoverableDesktopAction(
      () => api.reset(settings.desktopLyrics.displayId, settings.desktopLyrics.placement),
      { report, toast: message => toast(message, true) },
    );
    if (!result) return;
    persistDesktopResult(result);
    layoutMode = false;
    nodes.desktopLayoutButton.textContent = '编辑位置';
    toast('桌面歌词位置已重置');
  }, undefined, cleanup);
  eventOn(nodes.restoreDefaults, 'click', async () => {
    const api = windowRef.electronAPI?.desktopLyrics;
    await runRecoverableDesktopAction(
      () => resetRuntimeDefaults({ mvController, desktopApi: api, layoutMode }),
      { report, toast: message => toast(message, true) },
    );
    layoutMode = false;
    nodes.desktopLayoutButton.textContent = '编辑位置';
    applySettings(DEFAULT_SETTINGS);
    toast('已恢复默认视觉设置');
  }, undefined, cleanup);

  const renderLoop = now => {
    animationFrame = windowRef.requestAnimationFrame(renderLoop);
    if (!scheduler.shouldRender(now)) return;
    const features = audioEngine.readFeatures();
    const conducted = conductor.update(features, 0.14, scheduler.deltaSeconds);
    const personality = settings.visual.personality === 'auto' ? conducted.personality : settings.visual.personality;
    const reducedMotion = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const motionPhase = reducedMotion ? 0 : (Math.sin(now / 420) + 1) / 2;
    const motionTurn = reducedMotion ? 0 : (now % 12000) / 12000;
    const audioEnergy = reducedMotion ? 0 : Math.max(features.bass, features.mid, features.onset);
    shell.style.setProperty('--motion-phase', String(motionPhase));
    shell.style.setProperty('--motion-turn', String(motionTurn));
    shell.style.setProperty('--audio-energy', String(audioEnergy));
    const renderStart = windowRef.performance?.now?.() ?? now;
    scene?.render({
      time: reducedMotion ? 0 : now / 1000,
      delta: reducedMotion ? 0 : scheduler.deltaSeconds,
      audio: reducedMotion ? { bass: 0, mid: 0, treble: 0, onset: 0, dynamicRange: 0 } : features,
      personality,
    });
    latestRenderMs = scene ? (windowRef.performance?.now?.() ?? now) - renderStart : null;
    const lyricState = currentSong?.local ? null : lyricEngine.update({
      time: audio.currentTime,
      personality,
      intensity: settings.lyrics.intensity,
      palette: ['#72f6ff', '#ffb15c'],
    });
    renderLyricState(lyricStage, lyricState, settings);
    sendDesktopState(lyricState || lyricEngine.state, { motionPhase, audioEnergy });
    if (mvController.enabled) mvController.sync(audio.currentTime);
    if (now - lastTelemetry >= 250) {
      lastTelemetry = now;
      const target = scheduler.target;
      const warningState = nextPerformanceWarning({ target, measuredFps: scheduler.measuredFps, now, lowSince: lowFpsSince });
      lowFpsSince = warningState.lowSince;
      const warning = warningState.message;
      const budget = target === 'unlocked' ? null : 1000 / target;
      jarvis.setTelemetry({
        fps: scheduler.measuredFps,
        renderer: rendererName(scene),
        warning,
        renderMs: latestRenderMs,
        frameBudgetLoad: budget && Number.isFinite(latestRenderMs) ? latestRenderMs / budget * 100 : null,
        quality: settings.performance.quality,
      });
      const recommendation = recommendPerformanceQuality({
        quality: settings.performance.quality,
        autoQuality: settings.performance.autoQuality && !qualityAutoHold,
        target,
        measuredFps: scheduler.measuredFps,
        lowSince: lowFpsSince,
        now,
      });
      if (recommendation.changed) {
        lowFpsSince = null;
        applySettings({
          ...settings,
          performance: { ...settings.performance, quality: recommendation.quality },
        });
        toast(recommendation.reason);
      }
      report({
        source: 'performance',
        status: warning ? STATUS.DEGRADED : STATUS.READY,
        message: warning || '帧调度稳定',
        recoverable: true,
      });
      nodes.systemStatus.textContent = scene ? `VISUAL CORE · ${personality.toUpperCase()}` : 'AUDIO MODE · WEBGL OFF';
    }
  };
  animationFrame = windowRef.requestAnimationFrame(renderLoop);
  cleanup.push(() => windowRef.clearTimeout(qualityHoldTimer));

  applySettings(settings, false);
  const desktopApi = windowRef.electronAPI?.desktopLyrics;
  desktopApi?.displays?.().then(result => {
    const displays = result?.displays || [];
    nodes.desktopDisplay.replaceChildren();
    const automatic = documentRef.createElement('option');
    automatic.value = '';
    automatic.textContent = '自动 / 当前屏幕';
    nodes.desktopDisplay.append(automatic);
    displays.forEach(display => {
      const option = documentRef.createElement('option');
      option.value = display.id;
      option.textContent = display.label;
      nodes.desktopDisplay.append(option);
    });
    nodes.desktopDisplay.value = settings.desktopLyrics.displayId || '';
  }).catch(error => toast(error.message, true));
  const unsubscribeLayout = desktopApi?.onLayoutResult?.(result => {
    layoutMode = false;
    nodes.desktopLayoutButton.textContent = '编辑位置';
    settings = saveSettings({
      ...settings,
      desktopLyrics: { ...settings.desktopLyrics, locked: true },
    }, settingsStorage);
    jarvis.setSettings(settings);
    persistDesktopResult(result);
  });
  if (unsubscribeLayout) cleanup.push(unsubscribeLayout);
  restoreDesktopLyrics(settings, desktopApi)?.then?.(async result => {
    persistDesktopResult(result);
    const lockResult = await desktopApi?.lock?.(settings.desktopLyrics.locked);
    if (lockResult?.bounds) persistDesktopResult(lockResult);
  }).catch?.(error => toast(error.message, true));
  setMVPresentation({ state: 'unavailable', enabled: false, metadata: null });
  refreshAccount();

  const cleanupError = error => console.error('Sonic Pulse cleanup failed.', error);
  runtime.dispose = createOnceDisposer([
    () => windowRef.cancelAnimationFrame(animationFrame),
    () => createOnceDisposer(cleanup, cleanupError)(),
    () => Object.values(inputTimers).forEach(timer => windowRef.clearTimeout(timer)),
    () => windowRef.clearTimeout(toastTimer),
    () => { if (localObjectUrl) windowRef.URL.revokeObjectURL(localObjectUrl); },
    () => trackController?.abort(),
    () => jarvis.destroy(),
    () => lyricEngine.destroy(),
    () => mvController.destroy(),
    () => scene?.dispose(),
    () => documentRef.body.classList.remove('three-ready'),
  ], cleanupError);
  eventOn(windowRef, 'beforeunload', runtime.dispose, { once: true }, cleanup);
  return runtime;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') startImmersiveApp();
