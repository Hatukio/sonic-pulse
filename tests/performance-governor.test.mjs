import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PERFORMANCE_QUALITY_PROFILES,
  nextLowerQuality,
  normalizePerformanceQuality,
  performanceProfileFor,
  qualityAdjustedVisualSettings,
  recommendPerformanceQuality,
} from '../public/src/core/performance-governor.mjs';

test('performance quality profiles expose user-facing power tiers', () => {
  assert.deepEqual(Object.keys(PERFORMANCE_QUALITY_PROFILES), ['eco', 'balanced', 'ultra']);
  assert.equal(normalizePerformanceQuality('eco'), 'eco');
  assert.equal(normalizePerformanceQuality('ultra'), 'ultra');
  assert.equal(normalizePerformanceQuality('turbo'), 'balanced');
  assert.equal(performanceProfileFor('eco').label, '低功耗');
});

test('qualityAdjustedVisualSettings scales render pressure without mutating source settings', () => {
  const settings = {
    performance: { quality: 'eco' },
    visual: { particleCount: 100000, bloom: 1, trails: 0.5 },
  };

  const adjusted = qualityAdjustedVisualSettings(settings);
  assert.equal(settings.visual.particleCount, 100000);
  assert.ok(adjusted.visual.particleCount < settings.visual.particleCount);
  assert.ok(adjusted.visual.bloom < settings.visual.bloom);
  assert.equal(adjusted.performance.renderScale, performanceProfileFor('eco').renderScale);
});

test('recommendPerformanceQuality suggests one-step degradation only when auto quality is enabled and sustained low FPS is proven', () => {
  assert.equal(nextLowerQuality('ultra'), 'balanced');
  assert.equal(nextLowerQuality('balanced'), 'eco');
  assert.equal(nextLowerQuality('eco'), 'eco');

  assert.deepEqual(recommendPerformanceQuality({
    quality: 'ultra',
    autoQuality: false,
    target: 120,
    measuredFps: 40,
    lowSince: 0,
    now: 7000,
  }), { quality: 'ultra', changed: false, reason: '' });

  assert.deepEqual(recommendPerformanceQuality({
    quality: 'ultra',
    autoQuality: true,
    holdUntil: 10000,
    target: 120,
    measuredFps: 40,
    lowSince: 0,
    now: 7000,
  }), { quality: 'ultra', changed: false, reason: '' });

  assert.deepEqual(recommendPerformanceQuality({
    quality: 'ultra',
    autoQuality: true,
    target: 120,
    measuredFps: 40,
    lowSince: 0,
    now: 7000,
  }), {
    quality: 'balanced',
    changed: true,
    reason: '已将画质从 ultra 调整为 balanced 以稳定帧率',
  });
});
