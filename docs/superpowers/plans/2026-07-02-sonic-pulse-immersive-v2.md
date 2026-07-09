# Sonic Pulse Immersive V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Arc Theatre experience with a Three.js point-cloud renderer, official NetEase MV playback, rhythm-adaptive in-app and desktop lyrics, four animation frame-rate modes, and a functional JARVIS command rail.

**Architecture:** Keep Express and Electron as the host, but split the monolithic renderer into browser-native ES modules. Three.js owns the visual scene; pure data modules own scheduling, point generation, lyric timing, settings, and audio-to-visual classification so they can be tested with Node's built-in test runner. Electron owns the separate desktop lyric window and secure IPC.

**Tech Stack:** Electron 31, Express 4, NeteaseCloudMusicApi 4, Three.js, Web Audio API, WebGL, browser ES modules, Node `node:test`.

**Repository note:** `/Users/hatukio/Downloads/files` is not currently a Git repository. The commit steps below are checkpoints to run only after Git is initialized; implementation must not claim commits were created otherwise.

---

## File Structure

### Existing files to modify

- `package.json` — dependencies and test scripts.
- `server.js` — normalized MV metadata and range-aware MV stream proxy.
- `main.js` — lifecycle and IPC for the desktop lyric window.
- `preload.js` — secure renderer APIs for desktop lyrics.
- `public/index.html` — Arc Theatre semantic shell and ES-module entry point.

### Files to create

- `public/styles/arc-theatre.css` — visual tokens and complete Arc Theatre chrome.
- `public/src/core/render-scheduler.mjs` — 30/60/120/unlocked render gating.
- `public/src/core/settings-store.mjs` — versioned settings validation and persistence.
- `public/src/audio/audio-engine.mjs` — Web Audio graph and normalized audio features.
- `public/src/visual/point-cloud-generator.mjs` — deterministic image-to-point data.
- `public/src/visual/visual-conductor.mjs` — rhythm-personality classification and smoothing.
- `public/src/visual/scene-engine.mjs` — Three.js scene, shaders, forms, camera, post-processing.
- `public/src/media/mv-controller.mjs` — MV state machine and audio-clock synchronization.
- `public/src/lyrics/lyric-parser.mjs` — line- and word-timed parsing.
- `public/src/lyrics/lyric-engine.mjs` — in-app spatial lyric state and presentation.
- `public/src/ui/jarvis-console.mjs` — command-rail bindings.
- `public/src/app.mjs` — application composition and lifecycle.
- `public/desktop-lyrics.html` — transparent overlay document.
- `public/styles/desktop-lyrics.css` — overlay styles and layout-mode affordances.
- `public/src/desktop/desktop-lyrics.mjs` — overlay renderer and drag/resize behavior.
- `desktop-preload.js` — overlay-only IPC surface.
- `desktop-lyrics-state.js` — pure bounds/defaults helper for Electron and tests.
- `tests/render-scheduler.test.mjs`
- `tests/point-cloud-generator.test.mjs`
- `tests/visual-conductor.test.mjs`
- `tests/lyric-parser.test.mjs`
- `tests/settings-store.test.mjs`
- `tests/desktop-lyrics-state.test.js`
- `tests/mv-normalization.test.js`

---

### Task 1: Establish the test harness and versioned settings contract

**Files:**
- Modify: `package.json`
- Create: `public/src/core/settings-store.mjs`
- Create: `tests/settings-store.test.mjs`

- [ ] **Step 1: Add a failing settings test**

```js
// tests/settings-store.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings } from '../public/src/core/settings-store.mjs';

test('normalizes invalid persisted settings without overriding valid choices', () => {
  assert.deepEqual(normalizeSettings({
    version: 1,
    performance: { frameRate: 120 },
    visual: { personality: 'unknown', particleCount: -4 },
  }), {
    ...DEFAULT_SETTINGS,
    performance: { ...DEFAULT_SETTINGS.performance, frameRate: 120 },
  });
});

test('accepts unlocked frame rate and desktop placement', () => {
  const settings = normalizeSettings({
    version: 1,
    performance: { frameRate: 'unlocked' },
    desktopLyrics: { enabled: true, opacity: 0.72, displayId: '2', bounds: { x: 10, y: 20, width: 900, height: 240 } },
  });
  assert.equal(settings.performance.frameRate, 'unlocked');
  assert.equal(settings.desktopLyrics.opacity, 0.72);
  assert.equal(settings.desktopLyrics.bounds.width, 900);
});
```

- [ ] **Step 2: Add the test command and run it to verify failure**

Modify `package.json`:

```json
"scripts": {
  "start": "node server.js",
  "dev": "electron .",
  "test": "node --test tests/*.test.js tests/*.test.mjs",
  "build:mac": "electron-builder --mac"
}
```

Run: `npm test`

Expected: FAIL because `public/src/core/settings-store.mjs` does not exist.

- [ ] **Step 3: Implement settings normalization and persistence**

```js
// public/src/core/settings-store.mjs
export const SETTINGS_KEY = 'sonic-pulse:settings:v1';
export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  performance: { frameRate: 60 },
  visual: { form: 'artwork', personality: 'auto', particleCount: 70000, depth: 1, bloom: 0.65, trails: 0.45, camera: 'cinematic' },
  lyrics: { enabled: true, style: 'auto', intensity: 0.8, size: 1, translation: true },
  mv: { enabled: false },
  desktopLyrics: { enabled: false, opacity: 0.88, intensity: 0.7, displayId: null, bounds: null },
});

const FRAME_RATES = new Set([30, 60, 120, 'unlocked']);
const FORMS = new Set(['artwork', 'nebula', 'tunnel', 'ribbons']);
const PERSONALITIES = new Set(['auto', 'ambient', 'pop', 'impact', 'fluid']);

const finite = (value, fallback, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const bounds = value => value && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))
  ? { x: value.x, y: value.y, width: Math.max(320, value.width), height: Math.max(120, value.height) }
  : null;

export function normalizeSettings(input = {}) {
  const frameRate = FRAME_RATES.has(input.performance?.frameRate) ? input.performance.frameRate : DEFAULT_SETTINGS.performance.frameRate;
  const form = FORMS.has(input.visual?.form) ? input.visual.form : DEFAULT_SETTINGS.visual.form;
  const personality = PERSONALITIES.has(input.visual?.personality) ? input.visual.personality : DEFAULT_SETTINGS.visual.personality;
  return {
    version: 1,
    performance: { frameRate },
    visual: {
      ...DEFAULT_SETTINGS.visual,
      form,
      personality,
      particleCount: finite(input.visual?.particleCount, DEFAULT_SETTINGS.visual.particleCount, 10000, 180000),
      depth: finite(input.visual?.depth, DEFAULT_SETTINGS.visual.depth, 0, 2),
      bloom: finite(input.visual?.bloom, DEFAULT_SETTINGS.visual.bloom, 0, 1.5),
      trails: finite(input.visual?.trails, DEFAULT_SETTINGS.visual.trails, 0, 0.95),
      camera: ['locked', 'orbit', 'cinematic', 'manual'].includes(input.visual?.camera) ? input.visual.camera : DEFAULT_SETTINGS.visual.camera,
    },
    lyrics: {
      ...DEFAULT_SETTINGS.lyrics,
      enabled: input.lyrics?.enabled ?? DEFAULT_SETTINGS.lyrics.enabled,
      style: ['auto', 'depth', 'orbit', 'particles', 'energy'].includes(input.lyrics?.style) ? input.lyrics.style : DEFAULT_SETTINGS.lyrics.style,
      intensity: finite(input.lyrics?.intensity, DEFAULT_SETTINGS.lyrics.intensity, 0, 1),
      size: finite(input.lyrics?.size, DEFAULT_SETTINGS.lyrics.size, 0.6, 1.8),
      translation: input.lyrics?.translation ?? DEFAULT_SETTINGS.lyrics.translation,
    },
    mv: { enabled: false },
    desktopLyrics: {
      ...DEFAULT_SETTINGS.desktopLyrics,
      enabled: input.desktopLyrics?.enabled ?? DEFAULT_SETTINGS.desktopLyrics.enabled,
      opacity: finite(input.desktopLyrics?.opacity, DEFAULT_SETTINGS.desktopLyrics.opacity, 0.2, 1),
      intensity: finite(input.desktopLyrics?.intensity, DEFAULT_SETTINGS.desktopLyrics.intensity, 0, 1),
      displayId: input.desktopLyrics?.displayId == null ? null : String(input.desktopLyrics.displayId),
      bounds: bounds(input.desktopLyrics?.bounds),
    },
  };
}

export function loadSettings(storage = localStorage) {
  try { return normalizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY) || '{}')); }
  catch { return normalizeSettings(); }
}

export function saveSettings(settings, storage = localStorage) {
  const normalized = normalizeSettings(settings);
  storage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}
```

- [ ] **Step 4: Run the test and verify pass**

Run: `npm test`

Expected: both settings tests PASS.

- [ ] **Step 5: Commit checkpoint if Git exists**

```bash
git add package.json package-lock.json public/src/core/settings-store.mjs tests/settings-store.test.mjs
git commit -m "test: establish immersive settings contract"
```

---

### Task 2: Implement frame-rate scheduling

**Files:**
- Create: `public/src/core/render-scheduler.mjs`
- Create: `tests/render-scheduler.test.mjs`

- [ ] **Step 1: Write failing scheduler tests**

```js
// tests/render-scheduler.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderScheduler } from '../public/src/core/render-scheduler.mjs';

test('60 fps renders at approximately 16.67 ms intervals', () => {
  const scheduler = new RenderScheduler(60);
  assert.equal(scheduler.shouldRender(0), true);
  assert.equal(scheduler.shouldRender(8), false);
  assert.equal(scheduler.shouldRender(17), true);
});

test('unlocked renders every request and preserves elapsed seconds', () => {
  const scheduler = new RenderScheduler('unlocked');
  scheduler.shouldRender(100);
  assert.equal(scheduler.shouldRender(101), true);
  assert.equal(scheduler.deltaSeconds, 0.001);
});
```

- [ ] **Step 2: Run the focused test to verify failure**

Run: `node --test tests/render-scheduler.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the scheduler**

```js
// public/src/core/render-scheduler.mjs
export class RenderScheduler {
  constructor(target = 60) { this.setTarget(target); this.lastRequest = null; this.lastRender = null; this.deltaSeconds = 0; this.measuredFps = 0; }
  setTarget(target) {
    if (![30, 60, 120, 'unlocked'].includes(target)) throw new TypeError('Unsupported frame rate');
    this.target = target;
    this.interval = target === 'unlocked' ? 0 : 1000 / target;
  }
  shouldRender(now) {
    if (this.lastRequest == null) {
      this.lastRequest = this.lastRender = now;
      return true;
    }
    this.lastRequest = now;
    const elapsed = now - this.lastRender;
    if (this.interval && elapsed + 0.25 < this.interval) return false;
    this.deltaSeconds = Math.min(0.1, elapsed / 1000);
    this.measuredFps = elapsed > 0 ? 1000 / elapsed : 0;
    this.lastRender = this.interval ? now - (elapsed % this.interval) : now;
    return true;
  }
}
```

- [ ] **Step 4: Run scheduler and full tests**

Run: `node --test tests/render-scheduler.test.mjs && npm test`

Expected: PASS.

- [ ] **Step 5: Commit checkpoint if Git exists**

```bash
git add public/src/core/render-scheduler.mjs tests/render-scheduler.test.mjs
git commit -m "feat: add selectable render scheduler"
```

---

### Task 3: Add deterministic artwork-to-point-cloud data and audio personalities

**Files:**
- Create: `public/src/visual/point-cloud-generator.mjs`
- Create: `public/src/visual/visual-conductor.mjs`
- Create: `tests/point-cloud-generator.test.mjs`
- Create: `tests/visual-conductor.test.mjs`

- [ ] **Step 1: Write failing pure-data tests**

```js
// tests/point-cloud-generator.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPointCloudData } from '../public/src/visual/point-cloud-generator.mjs';

test('creates stable positions and normalized colors from image data', () => {
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 255, 255, 20, 20, 20, 255, 255, 255, 255, 255]);
  const first = buildPointCloudData(pixels, 2, 2, { count: 4, seed: 7, depth: 1 });
  const second = buildPointCloudData(pixels, 2, 2, { count: 4, seed: 7, depth: 1 });
  assert.deepEqual([...first.positions], [...second.positions]);
  assert.equal(first.positions.length, 12);
  assert.equal(first.colors.length, 12);
  assert.ok([...first.colors].every(value => value >= 0 && value <= 1));
});
```

```js
// tests/visual-conductor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPersonality } from '../public/src/visual/visual-conductor.mjs';

test('classifies calm and impact passages from normalized features', () => {
  assert.equal(classifyPersonality({ bass: .12, mid: .16, treble: .1, onset: .08, dynamicRange: .2 }), 'ambient');
  assert.equal(classifyPersonality({ bass: .82, mid: .61, treble: .7, onset: .9, dynamicRange: .72 }), 'impact');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/point-cloud-generator.test.mjs tests/visual-conductor.test.mjs`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement deterministic generation and classification**

```js
// public/src/visual/point-cloud-generator.mjs
const randomFrom = seed => () => ((seed = Math.imul(seed ^ seed >>> 15, 1 | seed)) ^ seed + Math.imul(seed ^ seed >>> 7, 61 | seed)) >>> 0) / 4294967296;

export function buildPointCloudData(rgba, width, height, { count = 70000, seed = 1, depth = 1 } = {}) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const ids = new Float32Array(count);
  const random = randomFrom(seed);
  for (let i = 0; i < count; i++) {
    const pixel = Math.min(width * height - 1, Math.floor(random() * width * height));
    const p = pixel * 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const luminance = (rgba[p] * .2126 + rgba[p + 1] * .7152 + rgba[p + 2] * .0722) / 255;
    positions[i * 3] = (x / Math.max(1, width - 1) - .5) * 2;
    positions[i * 3 + 1] = (.5 - y / Math.max(1, height - 1)) * 2 * height / width;
    positions[i * 3 + 2] = (luminance - .5) * depth + (random() - .5) * .04;
    colors[i * 3] = rgba[p] / 255;
    colors[i * 3 + 1] = rgba[p + 1] / 255;
    colors[i * 3 + 2] = rgba[p + 2] / 255;
    ids[i] = i / count;
  }
  return { positions, colors, ids };
}
```

```js
// public/src/visual/visual-conductor.mjs
export function classifyPersonality({ bass, mid, treble, onset, dynamicRange }) {
  const energy = bass * .45 + mid * .35 + treble * .2;
  if (onset > .68 && energy > .58) return 'impact';
  if (energy < .24 && onset < .25) return 'ambient';
  if (bass < .45 && mid > bass && onset < .5) return 'fluid';
  return 'pop';
}

export class VisualConductor {
  constructor() { this.current = { bass: 0, mid: 0, treble: 0, onset: 0, dynamicRange: 0 }; this.personality = 'ambient'; }
  update(next, smoothing = .14) {
    for (const key of Object.keys(this.current)) this.current[key] += (next[key] - this.current[key]) * smoothing;
    this.personality = classifyPersonality(this.current);
    return { ...this.current, personality: this.personality };
  }
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test`

Expected: point-cloud and conductor tests PASS.

- [ ] **Step 5: Commit checkpoint if Git exists**

```bash
git add public/src/visual tests/point-cloud-generator.test.mjs tests/visual-conductor.test.mjs
git commit -m "feat: add point cloud data and visual conductor"
```

---

### Task 4: Build the Three.js SceneEngine and AudioEngine vertical slice

**Files:**
- Modify: `package.json`
- Modify: `server.js:1-140`
- Create: `public/src/audio/audio-engine.mjs`
- Create: `public/src/visual/scene-engine.mjs`
- Create: `public/src/app.mjs`
- Modify: `public/index.html:471-1437`

- [ ] **Step 1: Install Three.js and expose import-map vendor routes**

Run: `npm install three`

Add before static middleware in `server.js`:

```js
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.use('/vendor/three-addons', express.static(path.join(__dirname, 'node_modules/three/examples/jsm')));
```

Add to `public/index.html` before the module entry:

```html
<script type="importmap">
{"imports":{"three":"/vendor/three/three.module.js","three/addons/":"/vendor/three-addons/"}}
</script>
<script type="module" src="/src/app.mjs"></script>
```

- [ ] **Step 2: Implement `AudioEngine` with one reusable media source**

```js
// public/src/audio/audio-engine.mjs
export class AudioEngine extends EventTarget {
  constructor(audio) { super(); this.audio = audio; this.context = null; this.analyser = null; this.data = null; this.lastBass = 0; }
  async ensureStarted() {
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
      const source = this.context.createMediaElementSource(this.audio);
      source.connect(this.analyser); this.analyser.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }
  readFeatures() {
    if (!this.analyser) return { bass: 0, mid: 0, treble: 0, onset: 0, dynamicRange: 0 };
    this.analyser.getByteFrequencyData(this.data);
    const average = (from, to) => { let sum = 0; for (let i = from; i < to; i++) sum += this.data[i]; return sum / Math.max(1, to - from) / 255; };
    const bass = average(0, 82), mid = average(82, 358), treble = average(563, 768);
    const onset = Math.max(0, bass - this.lastBass) * 4; this.lastBass = bass;
    return { bass, mid, treble, onset: Math.min(1, onset), dynamicRange: Math.max(bass, mid, treble) - Math.min(bass, mid, treble) };
  }
}
```

- [ ] **Step 3: Implement the minimum SceneEngine**

`SceneEngine` creates `WebGLRenderer`, `PerspectiveCamera`, one `Points` draw call, and an `EffectComposer` with `RenderPass`, `UnrealBloomPass`, and `AfterimagePass`. Start from this complete vertical slice and extend only the shader form equations during implementation:

```js
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { buildPointCloudData } from './point-cloud-generator.mjs';

const FORM = Object.freeze({ artwork: 0, nebula: 1, tunnel: 2, ribbons: 3 });

export class SceneEngine {
  constructor({ canvas, settings }) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, .01, 100);
    this.camera.position.z = 3.2;
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: {
        uTime: { value: 0 }, uBass: { value: 0 }, uOnset: { value: 0 },
        uForm: { value: FORM.artwork }, uPointSize: { value: 2.2 }, uMV: { value: 0 },
      },
      vertexShader: `
        attribute float particleId;
        uniform float uTime, uBass, uOnset, uForm, uPointSize;
        varying vec3 vColor;
        void main(){
          vec3 p=position; float a=particleId*6.2831853+uTime*.22;
          vec3 nebula=normalize(vec3(cos(a*1.7),sin(a*1.3),sin(a)))*(0.5+particleId*1.55+uBass*.4);
          vec3 tunnel=vec3(cos(a)*(.28+particleId),sin(a)*(.28+particleId),mod(particleId*8.0-uTime*(.4+uBass),8.0)-4.0);
          vec3 ribbon=vec3(p.x,p.y+sin(p.x*5.0+uTime+particleId*4.0)*.28,p.z+cos(p.y*4.0+uTime)*.22);
          if(uForm<.5) p=p; else if(uForm<1.5) p=nebula; else if(uForm<2.5) p=tunnel; else p=ribbon;
          p+=normalize(p+vec3(.001))*uOnset*.06;
          vec4 mv=modelViewMatrix*vec4(p,1.0); gl_Position=projectionMatrix*mv;
          gl_PointSize=uPointSize*(1.0+uBass*1.8)*(1.0/-mv.z); vColor=color;
        }`,
      fragmentShader: `
        varying vec3 vColor; uniform float uMV;
        void main(){ float d=length(gl_PointCoord-.5); float alpha=smoothstep(.5,.05,d)*(1.0-uMV*.55); gl_FragColor=vec4(vColor,alpha); }
      `,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.points);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), settings.visual.bloom, .7, .08);
    this.trails = new AfterimagePass(settings.visual.trails);
    this.composer.addPass(this.bloom); this.composer.addPass(this.trails);
  }
  resize(width, height, dpr = devicePixelRatio) {
    this.renderer.setPixelRatio(Math.min(dpr, 2)); this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }
  setArtwork(image) {
    const canvas = new OffscreenCanvas(256, 256); const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 256, 256); const pixels = context.getImageData(0, 0, 256, 256).data;
    const data = buildPointCloudData(pixels, 256, 256, { count: this.settings.visual.particleCount, seed: 7, depth: this.settings.visual.depth });
    this.geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    this.geometry.setAttribute('particleId', new THREE.BufferAttribute(data.ids, 1));
    this.geometry.computeBoundingSphere();
  }
  setForm(form) { this.material.uniforms.uForm.value = FORM[form] ?? FORM.artwork; }
  applySettings(settings) {
    this.settings = settings; this.bloom.strength = settings.visual.bloom; this.trails.uniforms.damp.value = settings.visual.trails;
  }
  render({ time, delta, audio, personality }) {
    this.material.uniforms.uTime.value = time; this.material.uniforms.uBass.value += (audio.bass - this.material.uniforms.uBass.value) * Math.min(1, delta * 8);
    this.material.uniforms.uOnset.value = audio.onset; this.camera.position.x = personality === 'impact' ? Math.sin(time * 1.7) * audio.onset * .04 : 0;
    this.composer.render(delta);
  }
  setMVMode(enabled) { this.material.uniforms.uMV.value = enabled ? 1 : 0; }
  dispose() { this.geometry.dispose(); this.material.dispose(); this.composer.dispose(); this.renderer.dispose(); }
}
```

Implementation requirements:

- Reuse geometry and update attributes during artwork changes.
- Use shader uniforms for time, bass, onset, form morph, point size, and MV mode.
- Clamp renderer DPR to `Math.min(devicePixelRatio, 2)`.
- Dispose geometry, materials, render targets, and textures.
- Keep point-cloud draw calls at one. Add edge-weighted sampling and smooth form interpolation inside this class without changing its public API.

- [ ] **Step 4: Compose the scheduler, audio, conductor, and scene in `app.mjs`**

```js
const scheduler = new RenderScheduler(settings.performance.frameRate);
function frame(now) {
  requestAnimationFrame(frame);
  if (!scheduler.shouldRender(now)) return;
  const features = audioEngine.readFeatures();
  const conducted = conductor.update(features);
  scene.render({ time: now / 1000, delta: scheduler.deltaSeconds, audio: features, personality: conducted.personality, lyrics: lyricEngine?.state });
  consoleController?.updateTelemetry({ fps: scheduler.measuredFps });
}
requestAnimationFrame(frame);
```

- [ ] **Step 5: Run tests and a browser smoke check**

Run: `npm test`

Run: `npm start`

Expected: `/` returns 200; selecting a local audio file starts one Web Audio graph and displays an artwork/procedural point cloud without console errors.

- [ ] **Step 6: Commit checkpoint if Git exists**

```bash
git add package.json package-lock.json server.js public/index.html public/src/audio public/src/visual/scene-engine.mjs public/src/app.mjs
git commit -m "feat: add Three.js immersive scene vertical slice"
```

---

### Task 5: Add official NetEase MV metadata and streaming

**Files:**
- Modify: `server.js:8-138`
- Create: `tests/mv-normalization.test.js`
- Create: `public/src/media/mv-controller.mjs`

- [ ] **Step 1: Extract and test MV normalization**

Create an exported helper in `server.js` without starting a second listener during tests:

```js
function normalizeMV(song, detail) {
  const mvId = Number(song?.mv || 0);
  if (!mvId || !detail) return { available: false, mvId: null, name: null, qualities: [] };
  const qualities = Object.keys(detail.brs || {}).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  return { available: true, mvId, name: detail.name || song.name, qualities };
}
module.exports.normalizeMV = normalizeMV;
```

```js
// tests/mv-normalization.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMV } = require('../server');

test('only marks confirmed official MV metadata available', () => {
  assert.deepEqual(normalizeMV({ mv: 0 }, null), { available: false, mvId: null, name: null, qualities: [] });
  assert.deepEqual(normalizeMV({ mv: 88, name: 'Track' }, { name: 'Official', brs: { 480: 'a', 1080: 'b', 720: 'c' } }),
    { available: true, mvId: 88, name: 'Official', qualities: [1080, 720, 480] });
});
```

- [ ] **Step 2: Refactor server startup and verify the failing test**

Move `app.listen` behind:

```js
if (require.main === module) app.listen(PORT, () => console.log(`✅ Sonic Pulse: http://localhost:${PORT}`));
module.exports.app = app;
```

Run: `node --test tests/mv-normalization.test.js`

Expected: FAIL until `normalizeMV` and MV imports are implemented.

- [ ] **Step 3: Implement official MV routes**

Import `song_detail`, `mv_detail`, and `mv_url`. Add:

```js
app.get('/api/song/:id/mv', async (req, res) => {
  try {
    const songs = await song_detail({ ids: req.params.id, cookie: state.cookie || '' });
    const song = songs.body.songs?.[0];
    if (!song?.mv) return res.json(normalizeMV(song, null));
    const details = await mv_detail({ mvid: song.mv, cookie: state.cookie || '' });
    res.json(normalizeMV(song, details.body.data));
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.get('/api/mv/:id/stream', async (req, res) => {
  try {
    const result = await mv_url({ id: req.params.id, r: 1080, cookie: state.cookie || '' });
    const remoteUrl = result.body.data?.url;
    if (!remoteUrl) return res.status(404).json({ error: '官方 MV 暂不可用' });
    const client = remoteUrl.startsWith('https') ? https : http;
    const headers = req.headers.range ? { Range: req.headers.range } : {};
    const upstream = client.get(remoteUrl, { headers }, upstreamRes => {
      res.status(upstreamRes.statusCode || 200);
      ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(name => {
        if (upstreamRes.headers[name]) res.setHeader(name, upstreamRes.headers[name]);
      });
      upstreamRes.pipe(res);
    });
    upstream.on('error', error => { if (!res.headersSent) res.status(502).json({ error: error.message }); else res.destroy(error); });
    req.on('close', () => upstream.destroy());
  } catch (error) { res.status(502).json({ error: error.message }); }
});
```

- [ ] **Step 4: Implement the MV state machine**

`MVController` must expose `discover(songId)`, `enable()`, `disable()`, `sync(currentTime)`, and `destroy()`. It keeps the video muted, uses `/api/mv/:id/stream`, corrects drift greater than 0.35 seconds, and dispatches `statechange` events with `unavailable`, `available`, `loading`, `playing`, or `error`.

- [ ] **Step 5: Run tests and route smoke checks**

Run: `npm test`

Run while the server is active: `curl -sS http://127.0.0.1:3000/api/song/0/mv`

Expected: valid JSON and no process crash; real-song checks require a signed-in Electron session.

- [ ] **Step 6: Commit checkpoint if Git exists**

```bash
git add server.js tests/mv-normalization.test.js public/src/media/mv-controller.mjs
git commit -m "feat: add official NetEase MV playback"
```

---

### Task 6: Implement word-aware lyric parsing and immersive lyric state

**Files:**
- Modify: `server.js`
- Create: `public/src/lyrics/lyric-parser.mjs`
- Create: `public/src/lyrics/lyric-engine.mjs`
- Create: `tests/lyric-parser.test.mjs`

- [ ] **Step 1: Write failing parser tests**

```js
// tests/lyric-parser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLRC, distributeWords, findLyricState } from '../public/src/lyrics/lyric-parser.mjs';

test('parses LRC milliseconds and creates monotonic fallback word timing', () => {
  const lines = parseLRC('[00:01.50]We become light\n[00:04.00]Tonight');
  const words = distributeWords(lines[0], lines[1].time);
  assert.equal(lines[0].time, 1.5);
  assert.equal(words[0].start, 1.5);
  assert.ok(words[1].start > words[0].start);
  assert.ok(words.at(-1).end <= 4);
});

test('finds active line and active word', () => {
  const line = { time: 1, end: 3, text: 'We glow', words: [{ text: 'We', start: 1, end: 2 }, { text: 'glow', start: 2, end: 3 }] };
  assert.deepEqual(findLyricState([line], 2.2), { lineIndex: 0, wordIndex: 1, progress: .2 });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `node --test tests/lyric-parser.test.mjs`

Expected: FAIL because the parser module is missing.

- [ ] **Step 3: Implement the parser**

Use the following implementation:

```js
const linePattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]([^\n]*)/g;
const punctuation = /[\p{P}\p{S}]/u;
const toSeconds = (minutes, seconds, fraction = '') => Number(minutes) * 60 + Number(seconds) + (fraction ? Number(fraction) / 10 ** fraction.length : 0);

export function parseLRC(text = '') {
  const lines = []; let match;
  while ((match = linePattern.exec(text))) {
    const value = match[4].trim();
    if (value) lines.push({ time: toSeconds(match[1], match[2], match[3]), text: value });
  }
  return lines.sort((a, b) => a.time - b.time).map((line, index, all) => ({ ...line, end: all[index + 1]?.time ?? line.time + 6 }));
}

export function parseWordTimedLyrics(text = '') {
  return text.split(/\r?\n/).flatMap(raw => {
    const header = raw.match(/^\[(\d+),(\d+)\]/); if (!header) return [];
    const lineStart = Number(header[1]) / 1000; const lineEnd = lineStart + Number(header[2]) / 1000;
    const words = [...raw.matchAll(/\((\d+),(\d+),\d+\)([^()]+)/g)].map(match => ({ text: match[3], start: Number(match[1]) / 1000, end: (Number(match[1]) + Number(match[2])) / 1000 }));
    return [{ time: lineStart, end: lineEnd, text: words.map(word => word.text).join(''), words }];
  });
}

const tokensFor = text => /\s/u.test(text) ? text.trim().split(/\s+/u) : [...text.trim()];
export function distributeWords(line, nextTime = line.end ?? line.time + 6) {
  const tokens = tokensFor(line.text); const total = Math.max(.2, nextTime - line.time);
  const weights = tokens.map(token => punctuation.test(token) ? .5 : Math.max(1, [...token].length));
  const sum = weights.reduce((value, weight) => value + weight, 0); let cursor = line.time;
  return tokens.map((text, index) => { const start = cursor; cursor += total * weights[index] / sum; return { text, start, end: cursor }; });
}

export function mergeTranslations(lines, translations) {
  return lines.map(line => ({ ...line, translation: translations.find(item => Math.abs(item.time - line.time) < .5)?.text || '' }));
}

export function findLyricState(lines, time) {
  let lineIndex = lines.findIndex(line => time >= line.time && time < line.end); if (lineIndex < 0) lineIndex = Math.max(0, lines.findLastIndex(line => line.time <= time));
  const line = lines[lineIndex]; if (!line) return { lineIndex: -1, wordIndex: -1, progress: 0 };
  const words = line.words?.length ? line.words : distributeWords(line, line.end); const wordIndex = Math.max(0, words.findIndex(word => time >= word.start && time < word.end));
  const word = words[wordIndex]; const progress = Math.max(0, Math.min(1, (time - word.start) / Math.max(.001, word.end - word.start)));
  return { lineIndex, wordIndex, progress };
}
```

Rules:

- Support `[mm:ss.xx]` and `[mm:ss.xxx]`.
- Preserve provider word timing when present.
- Split fallback words by whitespace for Latin text and by Unicode character for CJK text.
- Allocate punctuation half the duration weight of letters.
- Return progress rounded only in tests, not in runtime state.

- [ ] **Step 4: Return enhanced lyric fields from the server**

Use the provider's enhanced lyric response when available and return:

```js
res.json({ lrc, tlyric, yrc: r.body.yrc?.lyric || '', ytlrc: r.body.ytlrc?.lyric || '' });
```

- [ ] **Step 5: Implement `LyricEngine`**

`LyricEngine` loads `/api/lyrics/:id`, builds normalized lines, updates state from the audio clock, chooses `depth`, `orbit`, `particles`, or `energy` from the conducted personality unless the user locks a style, and dispatches a serializable state for the desktop overlay.

- [ ] **Step 6: Run tests and verify synchronization manually**

Run: `npm test`

Expected: parser tests PASS. Manual smoke: seeking updates the active phrase and word within one animation frame.

- [ ] **Step 7: Commit checkpoint if Git exists**

```bash
git add server.js public/src/lyrics tests/lyric-parser.test.mjs
git commit -m "feat: add word-aware immersive lyrics"
```

---

### Task 7: Add the secure desktop lyric window

**Files:**
- Create: `desktop-lyrics-state.js`
- Create: `desktop-preload.js`
- Create: `public/desktop-lyrics.html`
- Create: `public/styles/desktop-lyrics.css`
- Create: `public/src/desktop/desktop-lyrics.mjs`
- Modify: `main.js:1-104`
- Modify: `preload.js:1-6`
- Create: `tests/desktop-lyrics-state.test.js`

- [ ] **Step 1: Write failing bounds tests**

```js
// tests/desktop-lyrics-state.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDesktopBounds } = require('../desktop-lyrics-state');

test('keeps the lyric window visible on the selected display', () => {
  assert.deepEqual(normalizeDesktopBounds({ x: -5000, y: 9000, width: 80, height: 40 }, { x: 0, y: 0, width: 1920, height: 1080 }),
    { x: 0, y: 960, width: 320, height: 120 });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `node --test tests/desktop-lyrics-state.test.js`

Expected: FAIL because helper is missing.

- [ ] **Step 3: Implement bounds normalization**

```js
// desktop-lyrics-state.js
function normalizeDesktopBounds(bounds, workArea) {
  const width = Math.min(workArea.width, Math.max(320, Number(bounds?.width) || 900));
  const height = Math.min(workArea.height, Math.max(120, Number(bounds?.height) || 240));
  const x = Math.min(workArea.x + workArea.width - width, Math.max(workArea.x, Number(bounds?.x) || workArea.x + (workArea.width - width) / 2));
  const y = Math.min(workArea.y + workArea.height - height, Math.max(workArea.y, Number(bounds?.y) || workArea.y + workArea.height - height - 80));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
module.exports = { normalizeDesktopBounds };
```

- [ ] **Step 4: Implement Electron window and IPC**

Create one reusable `BrowserWindow` with:

```js
desktopLyricsWindow = new BrowserWindow({
  ...bounds,
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  focusable: false,
  hasShadow: false,
  backgroundColor: '#00000000',
  webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'desktop-preload.js') },
});
desktopLyricsWindow.setIgnoreMouseEvents(true, { forward: true });
desktopLyricsWindow.loadURL(`http://localhost:${PORT}/desktop-lyrics.html`);
```

Register exact IPC channels:

- `desktop-lyrics:open`
- `desktop-lyrics:close`
- `desktop-lyrics:set-layout-mode`
- `desktop-lyrics:set-bounds`
- `desktop-lyrics:state`

Layout mode sets `focusable` and `ignoreMouseEvents` to the inverse of normal mode. Validate all received bounds through `normalizeDesktopBounds`.

- [ ] **Step 5: Expose narrow preload APIs**

Main preload exposes open/close/layout/state methods. Desktop preload exposes only `onState`, `setBounds`, and `finishLayout`. Each listener returns an unsubscribe function.

- [ ] **Step 6: Implement overlay presentation and layout affordances**

The overlay receives serializable lyric state and CSS variables for personality, intensity, progress, and palette. In layout mode it shows one drag surface and four resize affordances; outside layout mode those elements are hidden and the whole window is pointer-transparent.

- [ ] **Step 7: Verify tests and Electron behavior**

Run: `npm test`

Run: `npm run dev`

Expected: overlay opens without taskbar entry, accepts drag only in layout mode, passes clicks through after layout mode, and preserves placement after reopening.

- [ ] **Step 8: Commit checkpoint if Git exists**

```bash
git add main.js preload.js desktop-preload.js desktop-lyrics-state.js public/desktop-lyrics.html public/styles/desktop-lyrics.css public/src/desktop tests/desktop-lyrics-state.test.js
git commit -m "feat: add click-through immersive desktop lyrics"
```

---

### Task 8: Build the Arc Theatre shell and JARVIS command rail

**Files:**
- Rewrite: `public/index.html`
- Create: `public/styles/arc-theatre.css`
- Create: `public/src/ui/jarvis-console.mjs`
- Modify: `public/src/app.mjs`

- [ ] **Step 1: Replace the monolithic document with semantic Arc Theatre regions**

Required IDs:

```html
<canvas id="visualStage"></canvas>
<video id="mvLayer" muted playsinline crossorigin="anonymous"></video>
<div id="lyricStage" aria-live="polite"></div>
<aside id="libraryRail"></aside>
<section id="commandRail" aria-label="视觉控制台"></section>
<footer id="playbackArc"></footer>
<button id="energyCore" aria-expanded="false" aria-controls="commandRail"></button>
<audio id="audio" crossorigin="anonymous"></audio>
```

Preserve login, liked songs, playlists, search, local audio, transport, seek, and volume behavior through `app.mjs` rather than inline handlers.

- [ ] **Step 2: Implement real control groups**

`JarvisConsole` binds controls to the settings store and emits `settingschange`. Required groups and controls:

- Visual Core: form, personality lock, particle count, depth, bloom, trails, camera.
- Lyrics: style, size, intensity, translation.
- MV: availability, enable/disable, quality, sync status.
- Desktop Lyrics: enable, layout mode, opacity, display, reset.
- Performance: frame-rate buttons, measured FPS, renderer info, warning.
- Input: active mouse/keyboard status and a disabled gesture row labeled `未来可用`.

- [ ] **Step 3: Implement Arc Theatre CSS tokens and states**

Use one full-bleed base surface, one right command rail, one bottom playback arc, cyan-white functional light, and restrained amber for MV/warnings. Define explicit focus-visible, hover, selected, disabled, loading, error, and reduced-motion states. Do not use cards for ordinary rows.

- [ ] **Step 4: Wire the core workflow**

Verify each visible control changes real state:

- Selecting frame rate updates `RenderScheduler` and persistence.
- MV toggle calls `MVController` only when available.
- Desktop lyrics open and enter layout mode.
- Visual and lyric controls update live engines.
- Restore defaults updates the renderer and UI together.

- [ ] **Step 5: Run syntax and functional smoke checks**

Run: `npm test`

Run: `node --check server.js && node --check main.js && node --check preload.js && node --check desktop-preload.js`

Expected: all checks PASS; no inline global error banner appears during the main workflow.

- [ ] **Step 6: Commit checkpoint if Git exists**

```bash
git add public/index.html public/styles/arc-theatre.css public/src/ui/jarvis-console.mjs public/src/app.mjs
git commit -m "feat: build Arc Theatre command interface"
```

---

### Task 9: Integrate failure handling and resource cleanup

**Files:**
- Modify: `public/src/app.mjs`
- Modify: `public/src/visual/scene-engine.mjs`
- Modify: `public/src/media/mv-controller.mjs`
- Modify: `public/src/lyrics/lyric-engine.mjs`
- Modify: `public/src/ui/jarvis-console.mjs`

- [ ] **Step 1: Add explicit application states**

Use these normalized states rather than arbitrary alerts:

```js
const STATUS = Object.freeze({
  READY: 'ready', LOADING: 'loading', DEGRADED: 'degraded', ERROR: 'error',
});
```

Each subsystem reports `{ source, status, message, recoverable }`. The app maps recoverable failures to the relevant command-rail row.

- [ ] **Step 2: Add WebGL and artwork fallbacks**

If WebGL renderer creation fails, hide the canvas, keep playback/library, and render a simple readable lyric stage. If artwork loading fails, call `scene.setProceduralPalette(providerAccent)` instead of rejecting playback.

- [ ] **Step 3: Add lifecycle cleanup**

On every track change, revoke local object URLs, abort stale artwork/lyric/MV requests, dispose superseded textures, clear MV source, and remove old event listeners. On unload, call every module's `destroy` or `dispose` exactly once.

- [ ] **Step 4: Add performance warning policy**

If measured FPS remains below 70% of the selected finite target for five seconds, show an advisory warning with current and target FPS. Do not call `setTarget` automatically.

- [ ] **Step 5: Run repeated-track smoke test**

Manual scenario: play ten tracks, toggle MV where available, open/close desktop lyrics, and change all four frame modes.

Expected: one audio graph, one active MV request, stable renderer object counts after old textures settle, and uninterrupted playback on recoverable failures.

- [ ] **Step 6: Commit checkpoint if Git exists**

```bash
git add public/src
git commit -m "fix: add resilient immersive playback lifecycle"
```

---

### Task 10: Full verification and documentation alignment

**Files:**
- Modify: `README.md`
- Verify: all implementation files and tests

- [ ] **Step 1: Run the automated suite**

Run: `npm test`

Expected: zero failing tests.

- [ ] **Step 2: Run static checks**

Run:

```bash
node --check server.js
node --check main.js
node --check preload.js
node --check desktop-preload.js
```

Expected: all commands exit 0.

- [ ] **Step 3: Verify browser mode**

Run: `npm start`

Verify:

- `/` returns 200.
- Local audio displays point cloud and synchronized fallback lyrics state.
- Browser mode clearly marks Electron-only login and desktop lyrics as unavailable.
- 30/60/120/unlocked controls change measured rendering behavior.

- [ ] **Step 4: Verify Electron mode**

Run: `npm run dev`

Verify:

- Login flow still works.
- Liked songs, playlists, search, online audio, lyrics, and local files work.
- Correct MV badge behavior for songs with and without official MV.
- MV enable, seek synchronization, disable, and error fallback.
- Desktop lyric open, layout, drag, resize, save, close, click-through, and multi-display placement.
- Command rail keyboard focus and visible states.

- [ ] **Step 5: Perform visual QA against the approved Arc Theatre concept**

Capture the default 1280×800 app state and compare it directly with `.superpowers/brainstorm/45852-1782962981/content/visual-directions.html` option A. Inspect layout, center lyric anchor, command-rail obstruction, bottom playback arc, cyan/amber hierarchy, text readability, and control density. Fix every material mismatch that remains feasible in code.

- [ ] **Step 6: Update README**

Document Three.js requirements, official-MV behavior and rights boundary, frame-rate options, desktop lyric layout mode, browser-versus-Electron limitations, and camera gestures as a future—not current—feature.

- [ ] **Step 7: Final commit if Git exists**

```bash
git add README.md package.json package-lock.json main.js preload.js desktop-preload.js desktop-lyrics-state.js server.js public tests
git commit -m "feat: ship Sonic Pulse Immersive V2"
```

---

## Plan Self-Review

- Spec coverage: renderer, point-cloud forms, rhythm personalities, official MV, provider boundary, frame scheduling, immersive lyrics, desktop overlay, Arc Theatre console, persistence, degradation, privacy, migration, and verification are all mapped to tasks.
- Placeholder scan: no empty implementation stubs or deferred code markers remain.
- Type consistency: frame-rate values are `30 | 60 | 120 | 'unlocked'`; visual forms are `artwork | nebula | tunnel | ribbons`; personality values are `auto | ambient | pop | impact | fluid`; lyric styles are `auto | depth | orbit | particles | energy` throughout.
- Known execution constraint: Git commit steps are conditional because the current workspace has no repository metadata.
