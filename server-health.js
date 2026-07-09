'use strict';

function waitForServer({
  child,
  probe,
  intervalMs = 100,
  timeoutMs = 15_000,
} = {}) {
  if (!child || typeof child.once !== 'function' || typeof child.off !== 'function') {
    return Promise.reject(new TypeError('waitForServer requires a child process'));
  }
  if (typeof probe !== 'function') {
    return Promise.reject(new TypeError('waitForServer requires a health probe'));
  }
  const interval = Number.isFinite(intervalMs) && intervalMs >= 0 ? intervalMs : 100;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer = null;
    let timeoutTimer = null;

    const cleanup = () => {
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      child.off('error', onError);
      child.off('exit', onExit);
    };

    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    const onError = error => finish(new Error(`Sonic Pulse server failed to start: ${error?.message || error}`));
    const onExit = (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
      finish(new Error(`Sonic Pulse server exited before becoming healthy (${reason})`));
    };

    const check = async () => {
      if (settled) return;
      try {
        if (await probe()) {
          finish();
          return;
        }
      } catch (_error) {
        // A failed probe is expected while the local HTTP server is booting.
      }
      if (!settled) pollTimer = setTimeout(check, interval);
    };

    const rejectAfterFinalProbe = async () => {
      if (settled) return;
      try {
        if (await probe()) {
          finish();
          return;
        }
      } catch (_error) {
        // Keep timeout reporting stable when the final probe fails.
      }
      finish(new Error(`Sonic Pulse server health check timed out after ${timeout}ms`));
    };

    child.once('error', onError);
    child.once('exit', onExit);
    if (child.exitCode !== null && child.exitCode !== undefined) {
      onExit(child.exitCode, child.signalCode);
      return;
    }
    timeoutTimer = setTimeout(rejectAfterFinalProbe, timeout);
    check();
  });
}

module.exports = { waitForServer };
