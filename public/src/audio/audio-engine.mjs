export const SILENT_FEATURES = Object.freeze({
  bass: 0,
  mid: 0,
  treble: 0,
  onset: 0,
  dynamicRange: 0,
});

const clampUnit = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const averageRange = (data, start, end) => {
  const from = Math.min(data.length, Math.max(0, start));
  const to = Math.min(data.length, Math.max(from + 1, end));
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += data[index];
  return sum / Math.max(1, to - from) / 255;
};

export function extractFrequencyFeatures(data, {
  sampleRate = 48000,
  fftSize = Math.max(2, data?.length * 2),
  previousBass = 0,
} = {}) {
  if (!data?.length) return { ...SILENT_FEATURES };
  const binHz = sampleRate / fftSize;
  const binAt = (hz) => Math.max(1, Math.round(hz / binHz));
  const bass = clampUnit(averageRange(data, 0, binAt(250)));
  const mid = clampUnit(averageRange(data, binAt(250), binAt(4000)));
  const treble = clampUnit(averageRange(data, binAt(4000), binAt(16000)));
  const onset = clampUnit(Math.max(0, bass - clampUnit(previousBass)) * 4);
  const dynamicRange = Math.max(bass, mid, treble) - Math.min(bass, mid, treble);
  return { bass, mid, treble, onset, dynamicRange };
}

const mediaGraphs = new WeakMap();

const defaultContextFactory = () => {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error('Web Audio API is unavailable');
  return new Context();
};

export class AudioEngine extends EventTarget {
  constructor(audio, { contextFactory = defaultContextFactory, initialGraph = null } = {}) {
    super();
    if (!audio || (typeof audio !== 'object' && typeof audio !== 'function')) {
      throw new TypeError('AudioEngine requires a media element');
    }
    this.audio = audio;
    this.contextFactory = contextFactory;
    this.context = null;
    this.analyser = null;
    this.source = null;
    this.data = null;
    this.lastBass = 0;
    if (initialGraph) this.adoptGraph(initialGraph);
  }

  adoptGraph(graph) {
    if (!graph || graph.audio !== this.audio) {
      throw new TypeError('Adopted audio graph must belong to this media element');
    }
    if (!graph.context || !graph.analyser || !graph.source || !graph.data) {
      throw new TypeError('Adopted audio graph is incomplete');
    }

    const existing = mediaGraphs.get(this.audio);
    const adopted = existing ?? {
      context: graph.context,
      analyser: graph.analyser,
      source: graph.source,
      data: graph.data,
    };
    if (!existing) mediaGraphs.set(this.audio, adopted);
    Object.assign(this, adopted);
    return adopted;
  }

  ensureGraph() {
    const existing = mediaGraphs.get(this.audio);
    if (existing) {
      Object.assign(this, existing);
      return existing;
    }

    const context = this.contextFactory();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const source = context.createMediaElementSource(this.audio);
    source.connect(analyser);
    analyser.connect(context.destination);
    const graph = {
      context,
      analyser,
      source,
      data: new Uint8Array(analyser.frequencyBinCount),
    };
    mediaGraphs.set(this.audio, graph);
    Object.assign(this, graph);
    return graph;
  }

  async ensureStarted() {
    this.ensureGraph();
    if (this.context.state === 'suspended') await this.context.resume();
    return this;
  }

  readFeatures() {
    if (!this.analyser || !this.data) return { ...SILENT_FEATURES };
    this.analyser.getByteFrequencyData(this.data);
    const features = extractFrequencyFeatures(this.data, {
      sampleRate: this.context?.sampleRate,
      fftSize: this.analyser.fftSize,
      previousBass: this.lastBass,
    });
    this.lastBass = features.bass;
    return features;
  }
}
