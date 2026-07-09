import test from 'node:test';
import assert from 'node:assert/strict';

import { RenderScheduler } from '../public/src/core/render-scheduler.mjs';

const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test('rejects unsupported frame-rate targets', () => {
  assert.throws(() => new RenderScheduler(24), TypeError);

  const scheduler = new RenderScheduler();
  assert.throws(() => scheduler.setTarget('60'), TypeError);
});

test('renders at 60 fps around the 16.67ms boundary', () => {
  const scheduler = new RenderScheduler();

  assert.equal(scheduler.shouldRender(100), true);
  assert.equal(scheduler.shouldRender(116.65), false);
  assert.equal(scheduler.shouldRender(116.66), true);
  closeTo(scheduler.deltaSeconds, 0.01666);
  closeTo(scheduler.measuredFps, 1000 / 16.66);
});

test('supports 30 and 120 fps cadence', () => {
  const thirty = new RenderScheduler(30);
  assert.equal(thirty.interval, 1000 / 30);
  assert.equal(thirty.shouldRender(0), true);
  assert.equal(thirty.shouldRender(33.32), false);
  assert.equal(thirty.shouldRender(33.33), true);

  const oneTwenty = new RenderScheduler(120);
  assert.equal(oneTwenty.interval, 1000 / 120);
  assert.equal(oneTwenty.shouldRender(0), true);
  assert.equal(oneTwenty.shouldRender(8.32), false);
  assert.equal(oneTwenty.shouldRender(8.33), true);
});

test('unlocked mode renders every request and records actual delta', () => {
  const scheduler = new RenderScheduler('unlocked');

  assert.equal(scheduler.interval, 0);
  assert.equal(scheduler.shouldRender(10), true);
  assert.equal(scheduler.shouldRender(12.5), true);
  closeTo(scheduler.deltaSeconds, 0.0025);
  closeTo(scheduler.measuredFps, 400);
});

test('changing target resets timing so the next request renders immediately', () => {
  const scheduler = new RenderScheduler(30);

  assert.equal(scheduler.shouldRender(100), true);
  assert.equal(scheduler.shouldRender(110), false);

  scheduler.setTarget(120);

  assert.equal(scheduler.target, 120);
  assert.equal(scheduler.interval, 1000 / 120);
  assert.equal(scheduler.shouldRender(110), true);
  assert.equal(scheduler.deltaSeconds, 0);
  assert.equal(scheduler.measuredFps, 0);
});

test('caps render delta at 0.1 seconds after a long gap', () => {
  const scheduler = new RenderScheduler(60);

  assert.equal(scheduler.shouldRender(0), true);
  assert.equal(scheduler.shouldRender(500), true);
  assert.equal(scheduler.deltaSeconds, 0.1);
  assert.equal(scheduler.measuredFps, 2);
});

test('keeps finite cadence drift bounded after late render requests', () => {
  const scheduler = new RenderScheduler(60);

  assert.equal(scheduler.shouldRender(0), true);
  assert.equal(scheduler.shouldRender(17), true);
  assert.equal(scheduler.shouldRender(33.2), false);
  assert.equal(scheduler.shouldRender(33.33), true);
  assert.equal(scheduler.shouldRender(49.9), false);
  assert.equal(scheduler.shouldRender(50), true);
});

test('finite cadence resets and renders immediately when time moves backward', () => {
  const scheduler = new RenderScheduler(60);

  assert.equal(scheduler.shouldRender(100), true);
  assert.equal(scheduler.shouldRender(116.67), true);
  assert.equal(scheduler.shouldRender(120), false);

  assert.equal(scheduler.shouldRender(90), true);
  assert.equal(scheduler.deltaSeconds, 0);
  assert.equal(scheduler.measuredFps, 0);
  assert.equal(scheduler.shouldRender(100), false);
});

test('unlocked cadence resets non-negative timing when time moves backward', () => {
  const scheduler = new RenderScheduler('unlocked');

  assert.equal(scheduler.shouldRender(100), true);
  assert.equal(scheduler.shouldRender(110), true);

  assert.equal(scheduler.shouldRender(90), true);
  assert.equal(scheduler.deltaSeconds, 0);
  assert.equal(scheduler.measuredFps, 0);
});
