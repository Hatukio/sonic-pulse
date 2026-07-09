const MIN_SAMPLES = 3;
const MIN_ENERGY = 0.08;
const MIN_TRAVEL = 0.32;
const MAX_DURATION_MS = 1200;

export function classifyMotionGesture(samples = []) {
  const points = (Array.isArray(samples) ? samples : [])
    .filter(sample => Number.isFinite(sample?.x) && Number.isFinite(sample?.y))
    .slice(-8);
  if (points.length < MIN_SAMPLES) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const duration = Number(last.time) - Number(first.time);
  if (Number.isFinite(duration) && duration > MAX_DURATION_MS) return null;

  const energy = points.reduce((sum, sample) => sum + Math.max(0, Number(sample.energy) || 0), 0) / points.length;
  if (energy < MIN_ENERGY) return null;

  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if (Math.abs(dx) < MIN_TRAVEL && Math.abs(dy) < MIN_TRAVEL) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'swipeLeft' : 'swipeRight';
  return dy < 0 ? 'swipeUp' : 'swipeDown';
}

export function gestureToCommand(gesture) {
  return {
    swipeLeft: 'next',
    swipeRight: 'previous',
    swipeUp: 'volumeUp',
    swipeDown: 'volumeDown',
  }[gesture] || null;
}

export function createMotionSampler({ video, canvas, sampleSize = 64 } = {}) {
  const context = canvas?.getContext?.('2d', { willReadFrequently: true });
  let previous = null;
  if (!video || !canvas || !context) return null;
  canvas.width = sampleSize;
  canvas.height = sampleSize;

  return {
    sample(time = performance.now()) {
      if (!video.videoWidth || !video.videoHeight) return null;
      context.drawImage(video, 0, 0, sampleSize, sampleSize);
      const data = context.getImageData(0, 0, sampleSize, sampleSize).data;
      if (!previous) {
        previous = new Uint8ClampedArray(data);
        return null;
      }
      let energy = 0;
      let weightedX = 0;
      let weightedY = 0;
      for (let y = 0; y < sampleSize; y += 1) {
        for (let x = 0; x < sampleSize; x += 1) {
          const index = (y * sampleSize + x) * 4;
          const diff = (
            Math.abs(data[index] - previous[index])
            + Math.abs(data[index + 1] - previous[index + 1])
            + Math.abs(data[index + 2] - previous[index + 2])
          ) / 765;
          if (diff < 0.05) continue;
          energy += diff;
          weightedX += x * diff;
          weightedY += y * diff;
        }
      }
      previous = new Uint8ClampedArray(data);
      if (energy <= 0) return null;
      const normalizedEnergy = Math.min(1, energy / (sampleSize * sampleSize * 0.08));
      return {
        x: weightedX / energy / Math.max(1, sampleSize - 1),
        y: weightedY / energy / Math.max(1, sampleSize - 1),
        energy: normalizedEnergy,
        time,
      };
    },
    reset() {
      previous = null;
    },
  };
}
