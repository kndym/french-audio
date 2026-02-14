/**
 * AudioManager – microphone capture and audio playback for the Gemini Live API.
 *
 * Input:  captures mic audio, resamples to 16kHz mono PCM16, sends chunks via callback.
 * Output: receives PCM16 24kHz audio chunks from the API and plays them through speakers.
 */

// ── Constants ──────────────────────────────────────────────────
const INPUT_SAMPLE_RATE = 16000;   // what Gemini expects
const OUTPUT_SAMPLE_RATE = 24000;  // what Gemini sends back
const CHUNK_SIZE = 4096;           // samples per outgoing chunk

// ── AudioWorklet processor code (inline) ───────────────────────
const CAPTURE_PROCESSOR = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    // Accumulate float samples
    for (let i = 0; i < input.length; i++) {
      this.buffer.push(input[i]);
    }
    // Flush chunks
    while (this.buffer.length >= ${CHUNK_SIZE}) {
      const chunk = this.buffer.splice(0, ${CHUNK_SIZE});
      this.port.postMessage(new Float32Array(chunk));
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

// ── Playback processor (plays queued PCM through output) ───────
const PLAYBACK_PROCESSOR = `
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.port.onmessage = (e) => {
      this.queue.push(e.data);
    };
  }
  process(inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    for (let i = 0; i < out.length; i++) {
      if (this.queue.length === 0) {
        out[i] = 0;
        continue;
      }
      out[i] = this.queue[0][this.offset++];
      if (this.offset >= this.queue[0].length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('playback-processor', PlaybackProcessor);
`;

/**
 * Resample audio from one sample rate to another using linear interpolation.
 * @param {Float32Array} input
 * @param {number} fromRate
 * @param {number} toRate
 * @returns {Float32Array}
 */
function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outputLen = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLen);
  for (let i = 0; i < outputLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = srcIdx - lo;
    output[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return output;
}

/**
 * Convert Float32Array [-1, 1] to Int16Array.
 */
function floatToInt16(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}

/**
 * Convert Int16Array to Float32Array [-1, 1].
 */
function int16ToFloat(int16) {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7FFF);
  }
  return float32;
}

/**
 * Create a Blob URL from inline processor code.
 */
function createWorkletUrl(code) {
  const blob = new Blob([code], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

// ── AudioManager class ─────────────────────────────────────────

export class AudioManager {
  /**
   * @param {Object} opts
   * @param {function(Int16Array): void} opts.onAudioChunk – called with PCM16 16kHz chunks from mic
   * @param {function(number): void}     [opts.onInputLevel] – mic input level 0-1
   */
  constructor(opts) {
    this.opts = opts;
    /** @type {AudioContext|null} */
    this.inputCtx = null;
    /** @type {AudioContext|null} */
    this.outputCtx = null;
    this._stream = null;
    this._captureNode = null;
    this._playbackNode = null;
    this._analyser = null;
    this._analyserData = null;
    this._muted = false;
  }

  /** Start mic capture. Returns once audio is flowing. */
  async startCapture() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: INPUT_SAMPLE_RATE },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this._stream = stream;

    // Use AudioContext at whatever rate the system provides; we'll resample manually
    this.inputCtx = new AudioContext();
    const nativeRate = this.inputCtx.sampleRate;

    // Create analyser for volume metering
    this._analyser = this.inputCtx.createAnalyser();
    this._analyser.fftSize = 256;
    this._analyserData = new Uint8Array(this._analyser.frequencyBinCount);

    const source = this.inputCtx.createMediaStreamSource(stream);
    source.connect(this._analyser);

    // AudioWorklet for capture
    const captureUrl = createWorkletUrl(CAPTURE_PROCESSOR);
    await this.inputCtx.audioWorklet.addModule(captureUrl);
    URL.revokeObjectURL(captureUrl);

    this._captureNode = new AudioWorkletNode(this.inputCtx, 'capture-processor');
    this._captureNode.port.onmessage = (e) => {
      if (this._muted) return;
      const floatChunk = /** @type {Float32Array} */ (e.data);
      // Resample from native rate to 16kHz
      const resampled = resample(floatChunk, nativeRate, INPUT_SAMPLE_RATE);
      const pcm16 = floatToInt16(resampled);
      this.opts.onAudioChunk(pcm16);
    };

    this._analyser.connect(this._captureNode);
    this._captureNode.connect(this.inputCtx.destination); // needed for worklet to run

    // Mute the loopback so user doesn't hear themselves
    const gain = this.inputCtx.createGain();
    gain.gain.value = 0;
    this._captureNode.connect(gain);
    gain.connect(this.inputCtx.destination);
  }

  /** Set up output playback context. */
  async startPlayback() {
    this.outputCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });

    const playbackUrl = createWorkletUrl(PLAYBACK_PROCESSOR);
    await this.outputCtx.audioWorklet.addModule(playbackUrl);
    URL.revokeObjectURL(playbackUrl);

    this._playbackNode = new AudioWorkletNode(this.outputCtx, 'playback-processor');
    this._playbackNode.connect(this.outputCtx.destination);
  }

  /**
   * Queue received PCM16 audio for playback.
   * @param {Int16Array} pcm16
   */
  playAudio(pcm16) {
    if (!this._playbackNode) return;
    const float32 = int16ToFloat(pcm16);
    this._playbackNode.port.postMessage(float32);
  }

  /** Stop playing any queued audio immediately. */
  clearPlayback() {
    // Tear down and recreate the playback node to flush the queue
    if (this._playbackNode && this.outputCtx) {
      this._playbackNode.disconnect();
      this._playbackNode = new AudioWorkletNode(this.outputCtx, 'playback-processor');
      this._playbackNode.connect(this.outputCtx.destination);
    }
  }

  /**
   * Get current mic input level (0–1).
   * @returns {number}
   */
  getInputLevel() {
    if (!this._analyser || !this._analyserData) return 0;
    this._analyser.getByteFrequencyData(this._analyserData);
    let sum = 0;
    for (let i = 0; i < this._analyserData.length; i++) {
      sum += this._analyserData[i];
    }
    return sum / (this._analyserData.length * 255);
  }

  /** Mute/unmute mic. */
  setMuted(muted) {
    this._muted = muted;
  }

  /** Stop everything and release resources. */
  destroy() {
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    if (this._captureNode) {
      this._captureNode.disconnect();
      this._captureNode = null;
    }
    if (this.inputCtx) {
      this.inputCtx.close().catch(() => {});
      this.inputCtx = null;
    }
    if (this._playbackNode) {
      this._playbackNode.disconnect();
      this._playbackNode = null;
    }
    if (this.outputCtx) {
      this.outputCtx.close().catch(() => {});
      this.outputCtx = null;
    }
    this._analyser = null;
    this._analyserData = null;
  }
}
