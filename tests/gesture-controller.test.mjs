import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyMotionGesture,
  gestureToCommand,
} from '../public/src/input/gesture-controller.mjs';

test('gesture classifier converts local camera motion into playback gestures', () => {
  assert.equal(classifyMotionGesture([
    { x: 0.78, y: 0.5, energy: 0.18, time: 0 },
    { x: 0.55, y: 0.5, energy: 0.2, time: 120 },
    { x: 0.28, y: 0.48, energy: 0.22, time: 240 },
  ]), 'swipeLeft');

  assert.equal(classifyMotionGesture([
    { x: 0.44, y: 0.78, energy: 0.2, time: 0 },
    { x: 0.46, y: 0.55, energy: 0.18, time: 120 },
    { x: 0.47, y: 0.25, energy: 0.22, time: 240 },
  ]), 'swipeUp');
});

test('gesture command mapping is explicit and safe for media controls', () => {
  assert.equal(gestureToCommand('swipeLeft'), 'next');
  assert.equal(gestureToCommand('swipeRight'), 'previous');
  assert.equal(gestureToCommand('swipeUp'), 'volumeUp');
  assert.equal(gestureToCommand('swipeDown'), 'volumeDown');
  assert.equal(gestureToCommand('unknown'), null);
});
