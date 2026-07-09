const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { waitForServer } = require('../server-health');

function childProcess() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

test('resolves only after the health probe succeeds and removes child listeners', async () => {
  const child = childProcess();
  let attempts = 0;
  await waitForServer({
    child,
    probe: async () => ++attempts >= 3,
    intervalMs: 1,
    timeoutMs: 100,
  });

  assert.equal(attempts, 3);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('exit'), 0);
});

test('rejects after the total startup timeout when health never arrives', async () => {
  const child = childProcess();
  await assert.rejects(
    waitForServer({
      child,
      probe: async () => false,
      intervalMs: 1,
      timeoutMs: 8,
    }),
    /timed out/i,
  );
});

test('rejects immediately when the server child exits before becoming healthy', async () => {
  const child = childProcess();
  const waiting = waitForServer({
    child,
    probe: async () => false,
    intervalMs: 20,
    timeoutMs: 100,
  });
  child.exitCode = 1;
  child.emit('exit', 1, null);
  await assert.rejects(waiting, /exited.*1/i);
});
