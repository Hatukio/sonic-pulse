const SUPPORTED_TARGETS = new Set([30, 60, 120, 'unlocked']);
const TIMING_TOLERANCE_MS = 0.01;

export class RenderScheduler {
  constructor(target = 60) {
    this.target = undefined;
    this.interval = 0;
    this.lastRequest = null;
    this.lastObservedRequest = null;
    this.lastRender = null;
    this.deltaSeconds = 0;
    this.measuredFps = 0;

    this.setTarget(target);
  }

  setTarget(target) {
    if (!SUPPORTED_TARGETS.has(target)) {
      throw new TypeError(`Unsupported render target: ${target}`);
    }

    if (target === this.target) return;

    this.target = target;
    this.interval = target === 'unlocked' ? 0 : 1000 / target;
    this.lastRequest = null;
    this.lastObservedRequest = null;
    this.lastRender = null;
    this.deltaSeconds = 0;
    this.measuredFps = 0;
  }

  shouldRender(now) {
    if (this.lastObservedRequest !== null && now < this.lastObservedRequest) {
      this.lastObservedRequest = now;
      this.lastRequest = now;
      this.lastRender = now;
      this.deltaSeconds = 0;
      this.measuredFps = 0;
      return true;
    }

    this.lastObservedRequest = now;

    if (this.lastRequest === null) {
      this.lastRequest = now;
      this.lastRender = now;
      return true;
    }

    if (this.interval > 0) {
      const requestElapsed = now - this.lastRequest;
      if (requestElapsed + TIMING_TOLERANCE_MS < this.interval) return false;

      const elapsedIntervals = Math.max(
        1,
        Math.floor((requestElapsed + TIMING_TOLERANCE_MS) / this.interval),
      );
      this.lastRequest += elapsedIntervals * this.interval;
    } else {
      this.lastRequest = now;
    }

    const renderElapsed = now - this.lastRender;
    this.deltaSeconds = Math.min(renderElapsed / 1000, 0.1);
    this.measuredFps = renderElapsed > 0 ? 1000 / renderElapsed : 0;
    this.lastRender = now;
    return true;
  }
}
