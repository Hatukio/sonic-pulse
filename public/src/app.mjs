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
import {
  buildOpenMeteoForecastUrl,
  formatWeatherSummary,
  requestCurrentPosition,
} from './assistant/weather-context.mjs';
import {
  classifyMotionGesture,
  createMotionSampler,
  gestureToCommand,
} from './input/gesture-controller.mjs';
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
const VALID_STATUS_SOURCES = new Set(['visual', 'background', 'surface', 'assistant', 'lyrics', 'mv', 'desktop', 'performance', 'system']);

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

export function backgroundModeText(mode) {
  return {
    sonic: 'Sonic 动态场',
    wallpaperEngine: 'Wallpaper Engine',
    localVideo: '本地视频',
    web: 'Web 动态页',
  }[mode] || 'Sonic 动态场';
}

export function assistantProviderText(provider) {
  return {
    local: 'Sonic 本地陪伴',
    doubao: '豆包 / 火山方舟',
    qwen: '通义千问 / 阿里云百炼',
    deepseek: 'DeepSeek',
    ollama: 'Ollama 本地模型',
    lmstudio: 'LM Studio 本地模型',
    openaiCompatible: 'OpenAI-compatible 自定义',
  }[provider] || 'Sonic 本地陪伴';
}

export const ASSISTANT_PROVIDER_DEFAULTS = Object.freeze({
  local: { model: 'sonic-local-companion', endpoint: '' },
  doubao: { model: 'doubao-1-5-pro-32k-250115', endpoint: 'https://ark.cn-beijing.volces.com/api/v3' },
  qwen: { model: 'qwen-plus', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  deepseek: { model: 'deepseek-v4-flash', endpoint: 'https://api.deepseek.com' },
  ollama: { model: 'llama3.2', endpoint: 'http://127.0.0.1:11434' },
  lmstudio: { model: 'local-model', endpoint: 'http://127.0.0.1:1234/v1' },
  openaiCompatible: { model: 'user-selected-model', endpoint: 'https://api.example.com/v1' },
});

const ONLINE_ASSISTANT_PROVIDERS = new Set(['doubao', 'qwen', 'deepseek', 'openaiCompatible']);

export function buildAssistantActionItems(payload = {}) {
  const seen = new Set();
  const result = [];
  const add = action => {
    if (action?.type !== 'search') return;
    const keyword = String(action.keyword || '').replace(/\s+/g, ' ').trim();
    if (!keyword || keyword.length > 80 || seen.has(keyword)) return;
    seen.add(keyword);
    result.push({
      type: 'search',
      label: String(action.label || '搜索推荐音乐').replace(/\s+/g, ' ').trim().slice(0, 24) || '搜索推荐音乐',
      keyword,
    });
  };
  (Array.isArray(payload.actions) ? payload.actions : []).forEach(add);
  (Array.isArray(payload.recommendations) ? payload.recommendations : []).forEach(item => add({
    type: 'search',
    label: item?.title ? `搜索 ${item.title}` : '搜索推荐音乐',
    keyword: item?.query || item?.title,
  }));
  return result.slice(0, 3);
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
    'loginButton','logoutButton','accountName','accountDot','providerStrip','searchForm','searchInput','likedButton',
    'playlistList','trackList','libraryMessage','localAudio','trackTitle','trackArtist','trackArtwork',
    'artworkFallback','nowPlayingMVBadge','playButton','previousButton','nextButton','seekInput',
    'elapsedTime','durationTime','volumeInput','desktopLyricsToggle','desktopLayoutButton',
    'desktopResetButton','desktopDisplay','desktopLyricsLock','desktopPresetCenter','desktopPresetBottom',
    'desktopPresetLeft','desktopPresetRight','mvToggle','restoreDefaults','toast','vinylShelfCount',
    'vinylShelfList','vinylShelfEmpty','favoriteButton','playModeButton','playModeLabel',
    'lyricsToggleButton','immersiveButton','windowModeButton','moreActionsButton','playbackMorePopover',
    'backgroundMode','wallpaperEngineStatus','wallpaperSelect','wallpaperRefreshButton','wallpaperApplyButton',
    'wallpaperHint','surfaceMode','surfaceClickThroughToggle','surfaceOpacity','surfaceHint',
    'jarvisCompanion','assistantListenButton','assistantStatusText','assistantTranscript',
    'assistantProvider','assistantModel','assistantEndpoint','assistantApiKey','assistantMood','assistantWeather',
    'assistantWeatherButton','assistantWeatherStatus',
    'assistantVoiceInput','assistantVoiceOutput','assistantPromptInput','assistantSendButton','assistantReply','assistantActions',
    'gestureStatus','gestureToggleButton','gestureCameraPreview',
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
  let wallpaperItems = [];
  let assistantSessionApiKey = '';
  let assistantRecognition = null;
  let surfaceHydrated = false;
  let gestureStream = null;
  let gestureSampler = null;
  let gestureFrame = 0;
  let gestureCooldownUntil = 0;
  let gestureCanvas = null;
  const gestureSamples = [];
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

  const setWallpaperMessage = (message, status = STATUS.READY) => {
    if (nodes.wallpaperEngineStatus) nodes.wallpaperEngineStatus.textContent = message;
    report({ source: 'background', status, message, recoverable: true });
  };

  const renderWallpaperOptions = (items = []) => {
    wallpaperItems = Array.isArray(items) ? items : [];
    nodes.wallpaperSelect?.replaceChildren();
    const placeholder = documentRef.createElement('option');
    placeholder.value = '';
    placeholder.textContent = wallpaperItems.length ? '选择一个已安装壁纸' : '未发现可用壁纸';
    nodes.wallpaperSelect?.append(placeholder);
    wallpaperItems.forEach(item => {
      const option = documentRef.createElement('option');
      option.value = item.file;
      option.textContent = `${item.title || '未命名壁纸'} · ${item.type || 'file'}`;
      nodes.wallpaperSelect?.append(option);
    });
    if (settings.background.wallpaperEngine.selectedFile) {
      nodes.wallpaperSelect.value = settings.background.wallpaperEngine.selectedFile;
    }
  };

  const applyBackgroundPresentation = () => {
    shell.dataset.backgroundMode = settings.background.mode;
    const hint = backgroundModeText(settings.background.mode);
    if (nodes.wallpaperHint) {
      nodes.wallpaperHint.textContent = settings.background.mode === 'wallpaperEngine'
        ? 'Windows 将调用 Wallpaper Engine 官方命令；如果未安装，则自动保留 Sonic 动态背景。'
        : `${hint} 已作为播放器背景策略；Wallpaper Engine 仍可单独应用到 Windows 桌面。`;
    }
  };

  const applySurfacePresentation = previous => {
    const surface = settings.surface || DEFAULT_SETTINGS.surface;
    const effectiveClickThrough = surface.mode === 'transparent' && surface.clickThrough;
    shell.dataset.surfaceMode = surface.mode;
    shell.dataset.hudClickThrough = String(Boolean(effectiveClickThrough));
    shell.style.setProperty('--surface-opacity', String(surface.opacity));
    if (nodes.surfaceHint) {
      nodes.surfaceHint.textContent = surface.mode === 'transparent'
        ? '透明 HUD 已准备；开启点击穿透后用 Cmd/Ctrl + Shift + H 取回控制。'
        : '沉浸舞台会保留 Sonic 深色玻璃背景；透明 HUD 适合叠在用户壁纸上。';
    }
    const unchanged = previous && previous.surface?.mode === surface.mode && previous.surface?.clickThrough === surface.clickThrough;
    if (surfaceHydrated && unchanged) return;
    surfaceHydrated = true;
    const api = windowRef.electronAPI?.hud;
    if (!api?.setState) {
      if (surface.mode === 'transparent' || surface.clickThrough) {
        report({ source: 'surface', status: STATUS.DEGRADED, message: '透明 HUD 需在桌面应用中生效', recoverable: true });
      }
      return;
    }
    api.setState({
      surfaceMode: surface.mode,
      clickThrough: effectiveClickThrough,
      alwaysOnTop: surface.mode === 'transparent',
    }).then(result => {
      shell.dataset.hudClickThrough = String(Boolean(result?.clickThrough));
      report({
        source: 'surface',
        status: STATUS.READY,
        message: result?.surfaceMode === 'transparent' ? '透明 HUD 已同步到窗口' : '沉浸玻璃窗口',
        recoverable: true,
      });
    }).catch(error => {
      report({ source: 'surface', status: STATUS.ERROR, message: error.message || 'HUD 同步失败', recoverable: true });
      toast(error.message || 'HUD 同步失败', true);
    });
  };

  const assistantDefaultsFor = provider => ASSISTANT_PROVIDER_DEFAULTS[provider] || ASSISTANT_PROVIDER_DEFAULTS.local;

  const syncAssistantHints = () => {
    const provider = settings.assistant.provider;
    const defaults = assistantDefaultsFor(provider);
    if (nodes.assistantEndpoint) nodes.assistantEndpoint.placeholder = defaults.endpoint || '本地免费模式无需服务地址';
    if (nodes.assistantModel) nodes.assistantModel.placeholder = defaults.model;
    const onlineProvider = ONLINE_ASSISTANT_PROVIDERS.has(provider);
    if (nodes.assistantApiKey) {
      nodes.assistantApiKey.disabled = !onlineProvider;
      nodes.assistantApiKey.placeholder = onlineProvider ? '仅本次会话使用，不保存' : '本地 Provider 不需要 Key';
    }
    const message = provider === 'local'
      ? 'Sonic 本地陪伴可用，不调用云端模型'
      : provider === 'doubao'
        ? '豆包 / 火山方舟需要用户自己的 API Key'
        : provider === 'qwen'
          ? '通义千问 / 百炼需要用户自己的 API Key'
          : provider === 'deepseek'
            ? 'DeepSeek 需要用户自己的 API Key'
            : provider === 'ollama'
              ? '请先在本机启动 Ollama 模型服务'
              : provider === 'lmstudio'
                ? '请先在 LM Studio 启动本地 Server'
                : '自定义在线模型需要用户自己的 API Key';
    report({
      source: 'assistant',
      status: onlineProvider && !assistantSessionApiKey ? STATUS.DEGRADED : STATUS.READY,
      message,
      recoverable: true,
    });
    if (nodes.assistantStatusText) nodes.assistantStatusText.textContent = assistantProviderText(provider);
  };

  const assistantContext = () => ({
    mood: settings.assistant.mood,
    date: new Date().toLocaleDateString('zh-CN'),
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    weather: settings.assistant.weather || '未知天气',
    currentSong: currentSong?.name || '尚未播放歌曲',
    artist: artistText(currentSong),
    playbackState: audio.paused ? 'paused' : 'playing',
  });

  const renderAssistantActions = payload => {
    const actions = buildAssistantActionItems(payload);
    nodes.assistantActions?.replaceChildren();
    if (!actions.length) {
      nodes.assistantActions?.setAttribute('hidden', '');
      return actions;
    }
    nodes.assistantActions?.removeAttribute('hidden');
    actions.forEach(action => {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'assistant-action-chip';
      button.dataset.assistantAction = action.type;
      button.dataset.keyword = action.keyword;
      button.textContent = action.label;
      nodes.assistantActions?.append(button);
    });
    return actions;
  };

  const speakAssistant = text => {
    const content = String(text || '').trim();
    if (!content || !settings.assistant.voiceOutput || !windowRef.speechSynthesis) return false;
    try {
      windowRef.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(content.slice(0, 360));
      utterance.lang = 'zh-CN';
      utterance.rate = 0.96;
      utterance.pitch = 0.92;
      windowRef.speechSynthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  };

  const setAssistantBusy = busy => {
    if (nodes.assistantSendButton) nodes.assistantSendButton.disabled = busy;
    nodes.assistantListenButton?.setAttribute('aria-pressed', String(Boolean(busy)));
    nodes.jarvisCompanion?.classList.toggle('is-thinking', Boolean(busy));
  };

  const askAssistant = async prompt => {
    const message = String(prompt || nodes.assistantPromptInput?.value || '').trim() || '根据现在的状态推荐音乐';
    if (nodes.assistantTranscript) nodes.assistantTranscript.textContent = message;
    setAssistantBusy(true);
    report({ source: 'assistant', status: STATUS.LOADING, message: 'Jarvis 正在判断音乐氛围', recoverable: true });
    try {
      const payload = await safeJson(await windowRef.fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: settings.assistant.provider,
          model: settings.assistant.model,
          endpoint: settings.assistant.endpoint,
          apiKey: ONLINE_ASSISTANT_PROVIDERS.has(settings.assistant.provider) ? assistantSessionApiKey : '',
          message,
          context: assistantContext(),
        }),
      }));
      const text = payload.text || payload.speak || '我在，但这次没有拿到有效回复。';
      if (nodes.assistantReply) nodes.assistantReply.textContent = text;
      if (nodes.assistantStatusText) nodes.assistantStatusText.textContent = `${assistantProviderText(payload.provider || settings.assistant.provider)} · 已回应`;
      report({ source: 'assistant', status: STATUS.READY, message: `${assistantProviderText(payload.provider || settings.assistant.provider)} 已回应`, recoverable: true });
      renderAssistantActions(payload);
      speakAssistant(payload.speak || text);
      return payload;
    } catch (error) {
      const messageText = error.message || 'Jarvis 暂时不可用';
      if (nodes.assistantReply) nodes.assistantReply.textContent = messageText;
      renderAssistantActions(null);
      report({ source: 'assistant', status: STATUS.ERROR, message: messageText, recoverable: true });
      toast(messageText, true);
      return null;
    } finally {
      setAssistantBusy(false);
    }
  };

  const startAssistantListening = () => {
    if (!settings.assistant.voiceInput) {
      toast('请先开启语音输入', true);
      return;
    }
    const SpeechRecognition = windowRef.SpeechRecognition || windowRef.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const fallback = '当前运行环境不支持语音识别，可先使用文字输入。';
      if (nodes.assistantTranscript) nodes.assistantTranscript.textContent = fallback;
      report({ source: 'assistant', status: STATUS.DEGRADED, message: fallback, recoverable: true });
      return;
    }
    if (assistantRecognition) {
      assistantRecognition.stop();
      assistantRecognition = null;
      return;
    }
    assistantRecognition = new SpeechRecognition();
    assistantRecognition.lang = 'zh-CN';
    assistantRecognition.interimResults = false;
    assistantRecognition.continuous = false;
    nodes.assistantListenButton?.setAttribute('aria-pressed', 'true');
    nodes.jarvisCompanion?.classList.add('is-listening');
    report({ source: 'assistant', status: STATUS.LOADING, message: '正在听你说话', recoverable: true });
    assistantRecognition.onresult = event => {
      const transcript = Array.from(event.results || [])
        .map(result => result?.[0]?.transcript)
        .filter(Boolean)
        .join(' ')
        .trim();
      if (transcript) {
        if (nodes.assistantPromptInput) nodes.assistantPromptInput.value = transcript;
        askAssistant(transcript);
      }
    };
    assistantRecognition.onerror = event => {
      const errorMessage = event?.error ? `语音识别失败：${event.error}` : '语音识别失败';
      report({ source: 'assistant', status: STATUS.DEGRADED, message: errorMessage, recoverable: true });
      if (nodes.assistantTranscript) nodes.assistantTranscript.textContent = errorMessage;
    };
    assistantRecognition.onend = () => {
      assistantRecognition = null;
      nodes.assistantListenButton?.setAttribute('aria-pressed', 'false');
      nodes.jarvisCompanion?.classList.remove('is-listening');
      syncAssistantHints();
    };
    assistantRecognition.start();
  };

  const refreshWallpaperEngine = async ({ scan = true } = {}) => {
    const api = windowRef.electronAPI?.wallpaperEngine;
    if (!api) {
      renderWallpaperOptions([]);
      setWallpaperMessage('浏览器模式不可用', STATUS.DEGRADED);
      return null;
    }
    setWallpaperMessage(scan ? '正在扫描壁纸' : '正在检测', STATUS.LOADING);
    try {
      const status = await api.status();
      if (!status.available) {
        renderWallpaperOptions([]);
        const message = status.platform === 'win32' ? '未安装 Wallpaper Engine' : '当前系统不支持桌面控制';
        setWallpaperMessage(message, STATUS.DEGRADED);
        return status;
      }
      if (!scan) {
        setWallpaperMessage('已检测到 Wallpaper Engine', STATUS.READY);
        return status;
      }
      const payload = await api.scan();
      renderWallpaperOptions(payload.items || []);
      setWallpaperMessage(payload.count ? `发现 ${payload.count} 个壁纸` : '未发现已安装壁纸', payload.count ? STATUS.READY : STATUS.DEGRADED);
      return payload;
    } catch (error) {
      renderWallpaperOptions([]);
      setWallpaperMessage(error.message || 'Wallpaper Engine 检测失败', STATUS.ERROR);
      toast(error.message || 'Wallpaper Engine 检测失败', true);
      return null;
    }
  };

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
    applyBackgroundPresentation();
    applySurfacePresentation(previous);
    syncAssistantHints();
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

  const setAssistantWeatherStatus = (message, status = STATUS.READY) => {
    if (nodes.assistantWeatherStatus) {
      nodes.assistantWeatherStatus.textContent = message;
      nodes.assistantWeatherStatus.dataset.status = status;
    }
  };

  const refreshAssistantWeather = async () => {
    if (nodes.assistantWeatherButton) nodes.assistantWeatherButton.disabled = true;
    setAssistantWeatherStatus('正在请求系统定位权限…', STATUS.LOADING);
    try {
      const position = await requestCurrentPosition(windowRef.navigator);
      const url = buildOpenMeteoForecastUrl(position.coords);
      setAssistantWeatherStatus('正在读取当前位置天气…', STATUS.LOADING);
      const payload = await safeJson(await windowRef.fetch(url));
      const summary = formatWeatherSummary(payload);
      applySettings({
        ...settings,
        assistant: {
          ...settings.assistant,
          weather: summary,
        },
      });
      if (nodes.assistantWeather) nodes.assistantWeather.value = summary;
      setAssistantWeatherStatus('已按当前位置更新天气，只保存天气摘要。', STATUS.READY);
      toast(`天气已更新：${summary}`);
      return summary;
    } catch (error) {
      const message = error?.message || '自动天气不可用，请手动填写天气/环境';
      setAssistantWeatherStatus(message, STATUS.DEGRADED);
      report({ source: 'assistant', status: STATUS.DEGRADED, message, recoverable: true });
      toast(message, true);
      return null;
    } finally {
      if (nodes.assistantWeatherButton) nodes.assistantWeatherButton.disabled = false;
    }
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
    let nextSettings = event.detail.settings;
    if (event.detail.path === 'assistant.provider') {
      const defaults = assistantDefaultsFor(event.detail.value);
      const previousDefaults = Object.values(ASSISTANT_PROVIDER_DEFAULTS);
      const shouldReplaceModel = previousDefaults.some(item => item.model === settings.assistant.model) || !settings.assistant.model;
      const shouldReplaceEndpoint = previousDefaults.some(item => item.endpoint && item.endpoint === settings.assistant.endpoint) || !settings.assistant.endpoint;
      nextSettings = {
        ...nextSettings,
        assistant: {
          ...nextSettings.assistant,
          model: shouldReplaceModel ? defaults.model : nextSettings.assistant.model,
          endpoint: shouldReplaceEndpoint ? defaults.endpoint : nextSettings.assistant.endpoint,
        },
      };
    }
    applySettings(nextSettings);
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
    if (event.detail.path === 'background.mode') {
      if (event.detail.value === 'wallpaperEngine') refreshWallpaperEngine({ scan: true });
      else setWallpaperMessage(`${backgroundModeText(event.detail.value)} 已启用`, STATUS.READY);
    }
    if (event.detail.path?.startsWith('assistant.')) syncAssistantHints();
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

  const setGestureStatus = (message, active = false) => {
    if (!nodes.gestureStatus) return;
    nodes.gestureStatus.textContent = message;
    nodes.gestureStatus.dataset.active = String(Boolean(active));
  };

  const executeGestureCommand = command => {
    if (command === 'next') runtime.next();
    else if (command === 'previous') runtime.previous();
    else if (command === 'volumeUp') {
      audio.volume = Math.min(1, audio.volume + 0.08);
      nodes.volumeInput.value = String(audio.volume);
    } else if (command === 'volumeDown') {
      audio.volume = Math.max(0, audio.volume - 0.08);
      nodes.volumeInput.value = String(audio.volume);
    } else return false;
    jarvis.setInputState('gesture', true);
    windowRef.clearTimeout(inputTimers.gesture);
    inputTimers.gesture = windowRef.setTimeout(() => jarvis.setInputState('gesture', false), 900);
    setGestureStatus(command === 'next' ? '下一首'
      : command === 'previous' ? '上一首'
        : command === 'volumeUp' ? '音量+' : '音量-', true);
    return true;
  };

  const stopCameraGestures = () => {
    if (gestureFrame) windowRef.cancelAnimationFrame(gestureFrame);
    gestureFrame = 0;
    gestureSampler = null;
    gestureSamples.splice(0);
    gestureStream?.getTracks?.().forEach(track => track.stop());
    gestureStream = null;
    if (nodes.gestureCameraPreview) nodes.gestureCameraPreview.srcObject = null;
    nodes.gestureToggleButton?.setAttribute('aria-pressed', 'false');
    if (nodes.gestureToggleButton) nodes.gestureToggleButton.textContent = '启用摄像头手势';
    setGestureStatus('未启用');
  };

  const startCameraGestureLoop = () => {
    const loop = now => {
      gestureFrame = windowRef.requestAnimationFrame(loop);
      const sample = gestureSampler?.sample(now);
      if (!sample) return;
      gestureSamples.push(sample);
      while (gestureSamples.length > 8) gestureSamples.shift();
      if (now < gestureCooldownUntil) return;
      const gesture = classifyMotionGesture(gestureSamples);
      const command = gestureToCommand(gesture);
      if (!command) return;
      gestureCooldownUntil = now + 900;
      gestureSamples.splice(0);
      executeGestureCommand(command);
    };
    gestureFrame = windowRef.requestAnimationFrame(loop);
  };

  const startCameraGestures = async () => {
    if (gestureStream) return stopCameraGestures();
    if (!windowRef.navigator?.mediaDevices?.getUserMedia) {
      const message = '当前环境不支持摄像头手势';
      setGestureStatus(message);
      toast(message, true);
      return null;
    }
    nodes.gestureToggleButton?.setAttribute('aria-pressed', 'true');
    if (nodes.gestureToggleButton) nodes.gestureToggleButton.textContent = '正在请求摄像头…';
    setGestureStatus('待授权');
    try {
      gestureStream = await windowRef.navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
        audio: false,
      });
      if (nodes.gestureCameraPreview) {
        nodes.gestureCameraPreview.srcObject = gestureStream;
        await nodes.gestureCameraPreview.play?.();
      }
      gestureCanvas = gestureCanvas || documentRef.createElement('canvas');
      gestureSampler = createMotionSampler({
        video: nodes.gestureCameraPreview,
        canvas: gestureCanvas,
      });
      if (!gestureSampler) throw new Error('摄像头手势初始化失败');
      if (nodes.gestureToggleButton) nodes.gestureToggleButton.textContent = '关闭摄像头手势';
      setGestureStatus('已启用', true);
      toast('摄像头手势已启用：左右切歌，上下调音量');
      startCameraGestureLoop();
      return gestureStream;
    } catch (error) {
      stopCameraGestures();
      const message = error?.message || '摄像头权限被拒绝';
      setGestureStatus('授权失败');
      toast(message, true);
      return null;
    }
  };

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
  eventOn(nodes.providerStrip, 'click', event => {
    const button = event.target.closest?.('[data-provider]');
    if (!button) return;
    const provider = button.dataset.provider;
    if (provider === 'netease') {
      nodes.providerStrip?.querySelectorAll('[data-provider]').forEach(node => node.setAttribute('aria-pressed', String(node === button)));
      setMessage('网易云音乐已启用');
      return;
    }
    const message = provider === 'qq'
      ? 'QQ 音乐官方接入已预留：需要配置 SONIC_QQ_MUSIC_APP_ID / SONIC_QQ_MUSIC_APP_KEY 后启用。'
      : provider === 'qishui'
        ? '汽水音乐官方接入已预留：需要配置 SONIC_QISHUI_CLIENT_ID / SONIC_QISHUI_CLIENT_SECRET 后启用。'
        : 'Apple Music 官方 API 接入仍在计划中。';
    setMessage(message, 'loading');
    toast(message);
  }, undefined, cleanup);
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
  eventOn(nodes.wallpaperRefreshButton, 'click', () => refreshWallpaperEngine({ scan: true }), undefined, cleanup);
  eventOn(nodes.wallpaperApplyButton, 'click', async () => {
    const api = windowRef.electronAPI?.wallpaperEngine;
    const file = nodes.wallpaperSelect?.value;
    if (!api) return toast('Wallpaper Engine 控制仅在桌面应用中可用', true);
    if (!file) return toast('请先选择一个已安装壁纸', true);
    setWallpaperMessage('正在应用到桌面', STATUS.LOADING);
    try {
      await api.open(file);
      settings = saveSettings({
        ...settings,
        background: {
          ...settings.background,
          mode: 'wallpaperEngine',
          wallpaperEngine: {
            ...settings.background.wallpaperEngine,
            selectedFile: file,
          },
        },
      }, settingsStorage);
      jarvis.setSettings(settings);
      applyBackgroundPresentation();
      setWallpaperMessage('Wallpaper Engine 已接管桌面', STATUS.READY);
      toast('已应用 Wallpaper Engine 壁纸');
    } catch (error) {
      setWallpaperMessage(error.message || '应用 Wallpaper Engine 失败', STATUS.ERROR);
      toast(error.message || '应用 Wallpaper Engine 失败', true);
    }
  }, undefined, cleanup);
  eventOn(nodes.assistantApiKey, 'input', () => {
    assistantSessionApiKey = String(nodes.assistantApiKey?.value || '');
    syncAssistantHints();
  }, undefined, cleanup);
  eventOn(nodes.assistantWeatherButton, 'click', refreshAssistantWeather, undefined, cleanup);
  eventOn(nodes.assistantSendButton, 'click', () => askAssistant(), undefined, cleanup);
  eventOn(nodes.assistantPromptInput, 'keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    askAssistant();
  }, undefined, cleanup);
  eventOn(nodes.assistantListenButton, 'click', event => {
    event.stopPropagation();
    startAssistantListening();
  }, undefined, cleanup);
  eventOn(nodes.assistantActions, 'click', event => {
    const button = event.target.closest?.('[data-assistant-action="search"]');
    if (!button) return;
    const keyword = button.dataset.keyword || '';
    if (!keyword) return;
    nodes.searchInput.value = keyword;
    setRailOpen(shell, nodes.libraryRail, nodes.libraryToggle, true, 'libraryOpen');
    nodes.searchForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }, undefined, cleanup);
  eventOn(nodes.gestureToggleButton, 'click', startCameraGestures, undefined, cleanup);
  eventOn(nodes.jarvisCompanion, 'click', event => {
    if (event.target === nodes.assistantListenButton || nodes.assistantListenButton?.contains?.(event.target)) return;
    setRailOpen(shell, commandRail, nodes.energyCore, true, 'consoleOpen');
    nodes.assistantPromptInput?.focus?.();
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
  refreshWallpaperEngine({ scan: settings.background.mode === 'wallpaperEngine' });
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
    () => assistantRecognition?.stop?.(),
    () => stopCameraGestures(),
    () => windowRef.speechSynthesis?.cancel?.(),
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
