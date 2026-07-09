const LEGAL_QUALITIES = new Set([240, 480, 720, 1080, 2160]);

function qualityList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map(Number)
    .filter(value => Number.isInteger(value) && LEGAL_QUALITIES.has(value)))]
    .sort((a, b) => b - a);
}

function stateEvent(detail) {
  if (typeof CustomEvent === 'function') return new CustomEvent('statechange', { detail });
  const event = new Event('statechange');
  Object.defineProperty(event, 'detail', { value: detail, enumerable: true });
  return event;
}

export class MVController extends EventTarget {
  constructor({ video, fetchImpl = globalThis.fetch } = {}) {
    super();
    if (!video || typeof video.play !== 'function' || typeof video.pause !== 'function') {
      throw new TypeError('MVController requires a video element');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('MVController requires fetch');

    this.video = video;
    this.fetchImpl = fetchImpl;
    this.video.muted = true;
    this.video.playsInline = true;
    this.state = 'unavailable';
    this.metadata = null;
    this.selectedQuality = null;
    this.enabled = false;
    this.destroyed = false;
    this.discoveryVersion = 0;
    this.mediaGeneration = 0;
    this.mediaListeners = null;
    this.discoveryController = null;
  }

  setState(state, error = null) {
    this.state = state;
    const detail = {
      state,
      enabled: this.enabled,
      pointCloudVisible: !this.enabled,
      metadata: this.metadata,
      selectedQuality: this.selectedQuality,
      error,
    };
    this.dispatchEvent(stateEvent(detail));
    return detail;
  }

  clearSource() {
    this.video.pause();
    if (this.video.src || this.video.getAttribute?.('src')) {
      this.video.removeAttribute('src');
      this.video.load?.();
    }
  }

  invalidateMediaOperation() {
    this.mediaGeneration += 1;
    if (this.mediaListeners) {
      this.video.removeEventListener('playing', this.mediaListeners.playing);
      this.video.removeEventListener('error', this.mediaListeners.error);
      this.mediaListeners = null;
    }
    return this.mediaGeneration;
  }

  isCurrentMediaOperation(generation) {
    return !this.destroyed && generation === this.mediaGeneration;
  }

  async discover(songId) {
    if (this.destroyed) return null;
    const version = ++this.discoveryVersion;
    this.discoveryController?.abort();
    const controller = new AbortController();
    this.discoveryController = controller;
    this.invalidateMediaOperation();
    this.enabled = false;
    const id = Number(songId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      this.metadata = null;
      this.selectedQuality = null;
      this.enabled = false;
      this.setState('error', new TypeError('无效歌曲 ID'));
      return null;
    }

    this.clearSource();
    this.metadata = null;
    this.selectedQuality = null;
    this.setState('loading');

    try {
      const result = await this.fetchImpl(`/api/song/${id}/mv`, { signal: controller.signal });
      if (!result?.ok) throw new Error(`官方 MV 元数据请求失败 (${result?.status || 'network'})`);
      const payload = await result.json();
      if (this.destroyed || version !== this.discoveryVersion || controller.signal.aborted) return null;

      const mvId = Number(payload?.mvId);
      const qualities = qualityList(payload?.qualities);
      if (!payload?.available || !Number.isSafeInteger(mvId) || mvId <= 0 || qualities.length === 0) {
        this.metadata = null;
        this.selectedQuality = null;
        this.setState('unavailable');
        return null;
      }

      this.metadata = {
        available: true,
        mvId,
        name: payload.name || null,
        qualities,
      };
      this.selectedQuality = qualities[0];
      this.setState('available');
      return this.metadata;
    } catch (error) {
      if (this.destroyed || version !== this.discoveryVersion || controller.signal.aborted || error?.name === 'AbortError') return null;
      this.metadata = null;
      this.selectedQuality = null;
      this.enabled = false;
      this.setState('error', error instanceof Error ? error : new Error(String(error)));
      return null;
    } finally {
      if (this.discoveryController === controller) this.discoveryController = null;
    }
  }

  async enable() {
    if (this.destroyed || !this.metadata || !this.selectedQuality) return false;
    const generation = this.invalidateMediaOperation();
    this.enabled = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.src = `/api/mv/${this.metadata.mvId}/stream?quality=${this.selectedQuality}`;
    const playing = () => {
      if (this.isCurrentMediaOperation(generation) && this.enabled) this.setState('playing');
    };
    const mediaError = () => {
      if (!this.isCurrentMediaOperation(generation) || !this.enabled) return;
      const error = new Error(this.video.error?.message || '官方 MV 播放失败');
      this.invalidateMediaOperation();
      this.enabled = false;
      this.setState('error', error);
    };
    this.mediaListeners = { playing, error: mediaError };
    this.video.addEventListener('playing', playing);
    this.video.addEventListener('error', mediaError);
    this.video.load?.();
    this.setState('loading');

    try {
      await this.video.play();
      if (!this.isCurrentMediaOperation(generation) || !this.enabled) return false;
      if (this.state !== 'playing') this.setState('playing');
      return true;
    } catch (error) {
      if (!this.isCurrentMediaOperation(generation)) return false;
      this.invalidateMediaOperation();
      this.enabled = false;
      this.setState('error', error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  disable() {
    if (this.destroyed) return false;
    this.invalidateMediaOperation();
    this.video.pause();
    this.enabled = false;
    this.setState(this.metadata ? 'available' : 'unavailable');
    return true;
  }

  reset() {
    if (this.destroyed) return this.setState('unavailable');
    this.discoveryVersion += 1;
    this.discoveryController?.abort();
    this.discoveryController = null;
    this.invalidateMediaOperation();
    this.enabled = false;
    this.clearSource();
    this.metadata = null;
    this.selectedQuality = null;
    return this.setState('unavailable');
  }

  sync(currentTime) {
    if (this.destroyed || !this.enabled || !Number.isFinite(currentTime) || currentTime < 0) return false;
    const videoTime = Number(this.video.currentTime);
    if (!Number.isFinite(videoTime) || Math.abs(videoTime - currentTime) <= 0.35) return false;
    this.video.currentTime = currentTime;
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.discoveryVersion += 1;
    this.discoveryController?.abort();
    this.discoveryController = null;
    this.invalidateMediaOperation();
    this.destroyed = true;
    this.enabled = false;
    this.clearSource();
    this.metadata = null;
    this.selectedQuality = null;
    this.state = 'unavailable';
  }
}
