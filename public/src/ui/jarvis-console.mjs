const valueAtPath = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);

export function patchSettings(settings, path, value) {
  const keys = String(path).split('.').filter(Boolean);
  if (!keys.length) return settings;
  const root = { ...settings };
  let source = settings;
  let target = root;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) target[key] = value;
    else {
      target[key] = { ...(source?.[key] || {}) };
      source = source?.[key];
      target = target[key];
    }
  });
  return root;
}

export const formatFrameRate = value => value === 'unlocked' ? 'UNLOCKED' : `${value} FPS`;

const settingsEvent = detail => {
  if (typeof CustomEvent === 'function') return new CustomEvent('settingschange', { detail });
  const event = new Event('settingschange');
  Object.defineProperty(event, 'detail', { value: detail });
  return event;
};

const coerce = control => {
  if (control.dataset.setting === 'desktopLyrics.displayId' && control.value === '') return null;
  if (control.type === 'checkbox') return control.checked;
  if (control.dataset.value !== undefined) {
    const value = control.dataset.value;
    if (value === 'unlocked') return value;
    const numeric = Number(value);
    return Number.isFinite(numeric) && value.trim() !== '' ? numeric : value;
  }
  if (control.type === 'range' || control.type === 'number') return Number(control.value);
  return control.value;
};

export class JarvisConsole extends EventTarget {
  constructor({ root, settings } = {}) {
    super();
    if (!root) throw new TypeError('JarvisConsole requires a root element');
    this.root = root;
    this.settings = settings;
    this.onInput = event => {
      if (event.target.type === 'range') this.handleControl(event.target);
    };
    this.onChange = event => {
      if (event.target.type !== 'range') this.handleControl(event.target);
    };
    this.onClick = event => {
      const control = event.target.closest?.('[data-setting][data-value]');
      if (control) this.handleControl(control);
    };
    root.addEventListener('input', this.onInput);
    root.addEventListener('change', this.onChange);
    root.addEventListener('click', this.onClick);
    this.setSettings(settings);
  }

  handleControl(control) {
    const path = control?.dataset?.setting;
    if (!path) return;
    if (control.matches?.('button') && control.dataset.value === undefined) return;
    const value = coerce(control);
    this.settings = patchSettings(this.settings, path, value);
    this.setSettings(this.settings);
    this.dispatchEvent(settingsEvent({ settings: this.settings, path, value }));
  }

  setSettings(settings) {
    this.settings = settings;
    this.root.querySelectorAll('[data-setting]').forEach(control => {
      const value = valueAtPath(settings, control.dataset.setting);
      if (control.dataset.value !== undefined) {
        const selected = String(value) === control.dataset.value;
        control.setAttribute('aria-pressed', String(selected));
      } else if (control.type === 'checkbox') {
        control.checked = Boolean(value);
      } else if (value !== undefined && value !== null) {
        control.value = String(value);
        const output = this.root.querySelector(`[data-output-for="${control.id}"]`);
        if (output) output.value = control.dataset.unit ? `${value}${control.dataset.unit}` : String(value);
      }
    });
    const frame = this.root.querySelector('#selectedFrameRate');
    if (frame) frame.textContent = formatFrameRate(settings.performance.frameRate);
  }

  setMVState(detail = {}) {
    const toggle = this.root.querySelector('#mvToggle');
    const state = this.root.querySelector('#mvAvailability');
    const quality = this.root.querySelector('#mvQuality');
    const sync = this.root.querySelector('#mvSyncStatus');
    const available = Boolean(detail.metadata?.available);
    if (toggle) {
      toggle.disabled = !available || detail.state === 'loading';
      toggle.setAttribute('aria-pressed', String(Boolean(detail.enabled)));
      toggle.textContent = detail.enabled ? '关闭官方 MV' : '启用官方 MV';
    }
    if (state) state.textContent = detail.state === 'loading' ? '正在确认官方源' : available ? '已确认官方 MV' : detail.state === 'error' ? '官方源异常' : '当前歌曲无官方 MV';
    if (quality) quality.textContent = detail.selectedQuality ? `${detail.selectedQuality}P · 官方最高可用` : '—';
    if (sync) sync.textContent = detail.enabled ? '音频时钟同步' : '待命';
  }

  setTelemetry({ fps = 0, renderer = 'WebGL 未就绪', warning = '', frameBudgetLoad = null, renderMs = null, quality = '' } = {}) {
    const measured = this.root.querySelector('#measuredFps');
    const rendererNode = this.root.querySelector('#rendererStatus');
    const warningNode = this.root.querySelector('#performanceWarning');
    const loadNode = this.root.querySelector('#gpuLoad');
    const qualityNode = this.root.querySelector('#qualityStatus');
    if (measured) measured.textContent = Number.isFinite(fps) ? `${fps.toFixed(0)} FPS` : '—';
    if (rendererNode) rendererNode.textContent = renderer;
    if (qualityNode) qualityNode.textContent = quality || 'balanced';
    if (loadNode) loadNode.textContent = Number.isFinite(frameBudgetLoad) && Number.isFinite(renderMs)
      ? `${frameBudgetLoad.toFixed(0)}% · ${renderMs.toFixed(1)}ms`
      : 'N/A';
    if (warningNode) {
      warningNode.textContent = warning;
      warningNode.hidden = !warning;
    }
  }

  setInputState(kind, active) {
    const node = this.root.querySelector(kind === 'mouse' ? '#mouseStatus' : '#keyboardStatus');
    if (!node) return;
    node.textContent = active ? '活跃' : '待命';
    node.dataset.active = String(Boolean(active));
  }

  setSubsystemStatus(report = {}) {
    const node = this.root.querySelector(`[data-subsystem-status="${report.source}"]`);
    if (!node) return false;
    node.textContent = report.message || '';
    node.dataset.status = report.status || 'error';
    node.dataset.recoverable = String(Boolean(report.recoverable));
    return true;
  }

  destroy() {
    this.root.removeEventListener('input', this.onInput);
    this.root.removeEventListener('change', this.onChange);
    this.root.removeEventListener('click', this.onClick);
  }
}
