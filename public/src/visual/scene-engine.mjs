import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';

import { buildPointCloudData } from './point-cloud-generator.mjs';

export const FORM = Object.freeze({ artwork: 0, nebula: 1, tunnel: 2, ribbons: 3 });

export const resolveForm = (form) => FORM[form] ?? FORM.artwork;

export const clampDevicePixelRatio = (value) => (
  Number.isFinite(value) && value > 0 ? Math.min(value, 2) : 1
);

export const advanceMorph = (current, target, deltaSeconds, speed = 5.5) => {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return current;
  const elapsed = Math.min(deltaSeconds, 0.1);
  const alpha = 1 - Math.exp(-Math.max(0, speed) * elapsed);
  return current + (target - current) * alpha;
};

export function cameraPose(mode, time = 0, onset = 0, input = { x: 0, y: 0 }) {
  const safeTime = Number.isFinite(time) ? time : 0;
  const safeOnset = Math.max(0, Math.min(1, Number(onset) || 0));
  const x = Math.max(-1, Math.min(1, Number(input?.x) || 0));
  const y = Math.max(-1, Math.min(1, Number(input?.y) || 0));
  if (mode === 'orbit') return { x: Math.sin(safeTime * 0.24) * 0.18, y: Math.cos(safeTime * 0.19) * 0.07, z: 3.2 };
  if (mode === 'cinematic') return { x: Math.sin(safeTime * 0.12) * 0.065 + Math.sin(safeTime * 1.7) * safeOnset * 0.04, y: Math.cos(safeTime * 0.09) * 0.025, z: 3.2 };
  if (mode === 'manual') return { x: x * 0.22, y: y * 0.14, z: 3.2 };
  return { x: 0, y: 0, z: 3.2 };
}

const luminanceAt = (rgba, pixelIndex) => {
  const offset = pixelIndex * 4;
  return (
    (Number(rgba[offset]) || 0) * 0.2126
    + (Number(rgba[offset + 1]) || 0) * 0.7152
    + (Number(rgba[offset + 2]) || 0) * 0.0722
  ) / 255;
};

export function computeEdgeWeights(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError('computeEdgeWeights requires positive integer dimensions');
  }
  if (!rgba || rgba.length < width * height * 4) {
    throw new RangeError('RGBA data is shorter than the image dimensions');
  }

  const weights = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width) + x;
      const center = luminanceAt(rgba, index);
      let contrast = 0;
      if (x > 0) contrast = Math.max(contrast, Math.abs(center - luminanceAt(rgba, index - 1)));
      if (x + 1 < width) contrast = Math.max(contrast, Math.abs(center - luminanceAt(rgba, index + 1)));
      if (y > 0) contrast = Math.max(contrast, Math.abs(center - luminanceAt(rgba, index - width)));
      if (y + 1 < height) contrast = Math.max(contrast, Math.abs(center - luminanceAt(rgba, index + width)));
      const alpha = Math.max(0, Math.min(1, (Number(rgba[(index * 4) + 3]) || 0) / 255));
      weights[index] = alpha * (0.08 + (contrast * contrast * 3.5));
    }
  }
  return weights;
}

export function syncGeometryAttribute({
  geometry,
  rendererAttributes,
  name,
  data,
  itemSize,
  createAttribute = (array, size) => new THREE.BufferAttribute(array, size),
}) {
  const existing = geometry.getAttribute(name);
  if (existing?.array?.length === data.length) {
    existing.array.set(data);
    existing.needsUpdate = true;
    return existing;
  }
  if (existing) {
    if (rendererAttributes?.remove) rendererAttributes.remove(existing);
    else geometry.dispose();
  }
  const replacement = createAttribute(data, itemSize);
  geometry.setAttribute(name, replacement);
  return replacement;
}

export function segmentedPulseProfile(particleLane = 0, audio = {}, time = 0) {
  const lane = Math.max(0, Math.min(1, Number(particleLane) || 0));
  const bassLane = Math.max(0, 1 - lane / 0.34);
  const midLane = Math.max(0, 1 - Math.abs(lane - 0.48) / 0.26);
  const highLane = Math.max(0, (lane - 0.62) / 0.38);
  const onset = Math.max(0, Number(audio.onset) || 0);
  const breathing = 0.86 + Math.sin((Number(time) || 0) * 2.4 + lane * 11) * 0.14;
  return {
    depth: (Number(audio.bass) || 0) * bassLane * breathing + onset * 0.18,
    twist: (Number(audio.mid) || 0) * midLane * (0.72 + onset * 0.28),
    sparkle: (Number(audio.treble) || 0) * highLane + onset * highLane * 0.42,
  };
}

export function layeredRhythmProfile(audio = {}, time = 0) {
  const bass = Math.max(0, Math.min(1, Number(audio.bass) || 0));
  const mid = Math.max(0, Math.min(1, Number(audio.mid) || 0));
  const treble = Math.max(0, Math.min(1, Number(audio.treble) || 0));
  const onset = Math.max(0, Math.min(1, Number(audio.onset) || 0));
  const safeTime = Number.isFinite(time) ? time : 0;
  const pulse = (Math.sin(safeTime * 2.1) + 1) / 2;
  return {
    bassImpact: Math.pow(bass, 0.72) * (0.82 + onset * 0.36),
    midWave: Math.pow(mid, 0.84) * (0.7 + pulse * 0.3),
    trebleGlitter: Math.pow(treble, 0.64) * (0.68 + onset * 0.42),
    shockwave: Math.pow(onset, 0.66),
    layerSpread: Math.max(bass * 0.58, mid * 0.38, treble * 0.28) + onset * 0.24,
  };
}

const VERTEX_SHADER = `
  attribute float particleId;
  uniform float uTime, uBass, uMid, uTreble, uOnset, uBassImpact, uMidWave, uTrebleGlitter, uShockwave, uLayerSpread, uFormFrom, uFormTo, uFormMix, uPointSize;
  varying vec3 vColor;

  vec3 formPosition(float form, vec3 source, float id) {
    float angle = id * 31.4159265 + uTime * 0.22;
    vec3 nebula = normalize(vec3(cos(angle * 1.7), sin(angle * 1.3), sin(angle)))
      * (0.5 + id * 1.55 + uBass * 0.4);
    vec3 tunnel = vec3(
      cos(angle) * (0.28 + id),
      sin(angle) * (0.28 + id),
      mod(id * 8.0 - uTime * (0.4 + uBass), 8.0) - 4.0
    );
    vec3 ribbon = vec3(
      source.x,
      source.y + sin(source.x * 5.0 + uTime + id * 4.0) * 0.28,
      source.z + cos(source.y * 4.0 + uTime) * 0.22
    );
    if (form < 0.5) return source;
    if (form < 1.5) return nebula;
    if (form < 2.5) return tunnel;
    return ribbon;
  }

  void main() {
    vec3 fromPosition = formPosition(uFormFrom, position, particleId);
    vec3 toPosition = formPosition(uFormTo, position, particleId);
    vec3 pointPosition = mix(fromPosition, toPosition, smoothstep(0.0, 1.0, uFormMix));
    float lane = fract(particleId * 23.713);
    float bassLane = 1.0 - smoothstep(0.18, 0.42, lane);
    float midLane = smoothstep(0.22, 0.46, lane) * (1.0 - smoothstep(0.58, 0.82, lane));
    float highLane = smoothstep(0.62, 0.94, lane);
    float depthPulse = bassLane * (uBass * 0.12 + uBassImpact * 0.18 + uLayerSpread * 0.08);
    float twistPulse = midLane * (uMid * 0.08 + uMidWave * 0.13) * sin(uTime * 1.4 + particleId * 19.0);
    float sparklePulse = highLane * (uTreble * 0.08 + uTrebleGlitter * 0.12) * sin(uTime * 6.0 + particleId * 73.0);
    float shockPulse = uShockwave * smoothstep(0.15, 0.98, lane) * (0.045 + lane * 0.05);
    pointPosition += normalize(pointPosition + vec3(0.001)) * (depthPulse + shockPulse + uOnset * (0.02 + lane * 0.025));
    pointPosition.xz = mat2(cos(twistPulse), -sin(twistPulse), sin(twistPulse), cos(twistPulse)) * pointPosition.xz;
    pointPosition.y += sparklePulse;
    vec4 viewPosition = modelViewMatrix * vec4(pointPosition, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = min(15.0, uPointSize * (1.0 + uBassImpact * 1.1 + highLane * uTrebleGlitter * 1.75 + uShockwave * 0.45) * (1.0 / max(0.15, -viewPosition.z)));
    vColor = color + vec3(highLane * uTrebleGlitter * 0.22, midLane * uMidWave * 0.08, bassLane * uBassImpact * 0.1);
  }
`;

const FRAGMENT_SHADER = `
  varying vec3 vColor;
  uniform float uMV;
  void main() {
    float distanceFromCenter = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.05, distanceFromCenter) * (1.0 - uMV * 0.55);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

const parseAccent = (value) => {
  const match = /^#([\da-f]{6})$/i.exec(String(value || ''));
  if (!match) return [58, 214, 255];
  return [0, 2, 4].map(offset => Number.parseInt(match[1].slice(offset, offset + 2), 16));
};

export const proceduralArtwork = (size = 128, accent = '#3ad6ff') => {
  const [red, green, blue] = parseAccent(accent);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size) + x;
      const offset = index * 4;
      const dx = ((x + 0.5) / size) - 0.5;
      const dy = ((y + 0.5) / size) - 0.5;
      const radius = Math.hypot(dx, dy);
      const glow = Math.max(0, 1 - radius * 1.9);
      data[offset] = Math.round(10 + red * glow * 0.95);
      data[offset + 1] = Math.round(24 + green * glow * 0.95);
      data[offset + 2] = Math.round(40 + blue * glow * 0.95);
      data[offset + 3] = radius < 0.52 ? 255 : 0;
    }
  }
  return { data, width: size, height: size };
};

const imagePixels = (image, canvasFactory, accent) => {
  if (!image) return proceduralArtwork(128, accent);
  if (image.data && image.width && image.height) {
    return { data: image.data, width: image.width, height: image.height };
  }

  const size = 256;
  const canvas = canvasFactory
    ? canvasFactory(size, size)
    : typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size });
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, size, size);
  return { data: context.getImageData(0, 0, size, size).data, width: size, height: size };
};

export class SceneEngine {
  constructor({ canvas, settings, canvasFactory } = {}) {
    if (!canvas) throw new TypeError('SceneEngine requires a canvas');
    this.settings = settings;
    this.canvasFactory = canvasFactory;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
    this.camera.position.z = 3.2;
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uOnset: { value: 0 },
        uBassImpact: { value: 0 },
        uMidWave: { value: 0 },
        uTrebleGlitter: { value: 0 },
        uShockwave: { value: 0 },
        uLayerSpread: { value: 0 },
        uFormFrom: { value: FORM.artwork },
        uFormTo: { value: FORM.artwork },
        uFormMix: { value: 1 },
        uPointSize: { value: 2.2 },
        uMV: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.points);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      settings?.visual?.bloom ?? 0.65,
      0.7,
      0.08,
    );
    this.trails = new AfterimagePass(settings?.visual?.trails ?? 0.45);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.trails);
    this.formFrom = FORM.artwork;
    this.formTo = FORM.artwork;
    this.formMix = 1;
    this.cameraInput = { x: 0, y: 0 };
    this.artwork = null;
    this.proceduralAccent = '#3ad6ff';
    this.disposed = false;
    this.setArtwork(null);
  }

  resize(width, height, dpr = globalThis.devicePixelRatio ?? 1) {
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    const renderScale = Number.isFinite(this.settings?.performance?.renderScale)
      ? this.settings.performance.renderScale
      : 1;
    this.renderer.setPixelRatio(clampDevicePixelRatio(dpr * renderScale));
    this.renderer.setSize(safeWidth, safeHeight, false);
    this.composer.setSize(safeWidth, safeHeight);
    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
  }

  updateAttribute(name, data, itemSize) {
    syncGeometryAttribute({
      geometry: this.geometry,
      rendererAttributes: this.renderer.attributes,
      name,
      data,
      itemSize,
    });
  }

  rebuildArtwork() {
    const { data: rgba, width, height } = this.artwork ?? proceduralArtwork();
    const pointData = buildPointCloudData(rgba, width, height, {
      count: this.settings?.visual?.particleCount ?? 70000,
      seed: 7,
      depth: this.settings?.visual?.depth ?? 1,
      sampleWeights: computeEdgeWeights(rgba, width, height),
    });
    this.updateAttribute('position', pointData.positions, 3);
    this.updateAttribute('color', pointData.colors, 3);
    this.updateAttribute('particleId', pointData.ids, 1);
    this.geometry.computeBoundingSphere();
  }

  setArtwork(image) {
    this.artwork = imagePixels(image, this.canvasFactory, this.proceduralAccent);
    this.rebuildArtwork();
  }

  setProceduralPalette(accent) {
    this.proceduralAccent = /^#[\da-f]{6}$/i.test(String(accent || '')) ? accent : '#3ad6ff';
    this.artwork = proceduralArtwork(128, this.proceduralAccent);
    this.rebuildArtwork();
  }

  setForm(form) {
    const next = resolveForm(form);
    if (next === this.formTo) return;
    this.formFrom = this.formMix < 0.5 ? this.formFrom : this.formTo;
    this.formTo = next;
    this.formMix = 0;
    this.material.uniforms.uFormFrom.value = this.formFrom;
    this.material.uniforms.uFormTo.value = this.formTo;
    this.material.uniforms.uFormMix.value = 0;
  }

  applySettings(settings) {
    const previousCount = this.settings?.visual?.particleCount;
    const previousDepth = this.settings?.visual?.depth;
    this.settings = settings;
    this.bloom.strength = settings.visual.bloom;
    this.trails.uniforms.damp.value = settings.visual.trails;
    if (previousCount !== settings.visual.particleCount || previousDepth !== settings.visual.depth) {
      this.rebuildArtwork();
    }
    this.setForm(settings.visual.form);
  }

  setCameraInput(x, y) {
    this.cameraInput.x = Math.max(-1, Math.min(1, Number(x) || 0));
    this.cameraInput.y = Math.max(-1, Math.min(1, Number(y) || 0));
  }

  render({ time = 0, delta = 0, audio = {}, personality = 'ambient' } = {}) {
    this.formMix = advanceMorph(this.formMix, 1, delta);
    const uniforms = this.material.uniforms;
    uniforms.uTime.value = time;
    uniforms.uBass.value += ((audio.bass ?? 0) - uniforms.uBass.value) * Math.min(1, delta * 8);
    uniforms.uMid.value += ((audio.mid ?? 0) - uniforms.uMid.value) * Math.min(1, delta * 8);
    uniforms.uTreble.value += ((audio.treble ?? 0) - uniforms.uTreble.value) * Math.min(1, delta * 8);
    uniforms.uOnset.value = audio.onset ?? 0;
    const rhythm = layeredRhythmProfile(audio, time);
    uniforms.uBassImpact.value += (rhythm.bassImpact - uniforms.uBassImpact.value) * Math.min(1, delta * 10);
    uniforms.uMidWave.value += (rhythm.midWave - uniforms.uMidWave.value) * Math.min(1, delta * 9);
    uniforms.uTrebleGlitter.value += (rhythm.trebleGlitter - uniforms.uTrebleGlitter.value) * Math.min(1, delta * 12);
    uniforms.uShockwave.value = rhythm.shockwave;
    uniforms.uLayerSpread.value += (rhythm.layerSpread - uniforms.uLayerSpread.value) * Math.min(1, delta * 8);
    uniforms.uFormMix.value = this.formMix;
    const mode = this.settings?.visual?.camera || 'cinematic';
    const pose = cameraPose(mode, time, personality === 'impact' ? audio.onset : 0, this.cameraInput);
    this.camera.position.set(pose.x, pose.y, pose.z);
    this.composer.render(delta);
  }

  setMVMode(enabled) {
    this.material.uniforms.uMV.value = enabled ? 1 : 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
    this.bloom.dispose?.();
    this.trails.dispose?.();
    this.composer.dispose?.();
    this.renderer.dispose();
  }
}
