/**
 * Gemini Live API WebSocket client.
 *
 * Connects directly from the browser to the Gemini Live API for
 * real-time bidirectional audio conversation.
 *
 * Protocol reference: https://ai.google.dev/api/live
 */

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const MODEL = 'gemini-2.5-flash-native-audio-latest';

/**
 * @typedef {Object} GeminiLiveOptions
 * @property {string} apiKey
 * @property {string} systemInstruction
 * @property {string} [voiceName]       - prebuilt voice name (default: 'Aoede')
 * @property {function(Int16Array): void} onAudio       - received audio chunk (PCM16 24kHz)
 * @property {function(string): void}     onText        - model text / transcript
 * @property {function(string, string): void} onTranscript - (role, text) for input/output transcripts
 * @property {function(): void}           onTurnStart   - model started speaking
 * @property {function(): void}           onTurnEnd     - model finished speaking
 * @property {function(): void}           onConnected   - session established
 * @property {function(string): void}     onError       - error message
 * @property {function(): void}           onClose       - connection closed
 * @property {function(): void}           [onInterrupted] - model was interrupted by user
 */

export class GeminiLiveClient {
  /** @param {GeminiLiveOptions} opts */
  constructor(opts) {
    this.opts = opts;
    /** @type {WebSocket|null} */
    this.ws = null;
    this._setupDone = false;
    this._audioBuffer = [];   // queue audio before setup completes
  }

  /** Open WebSocket and send setup message. */
  connect() {
    const url = `${WS_URL}?key=${this.opts.apiKey}`;
    this.ws = new WebSocket(url);
    this._setupDone = false;

    this.ws.onopen = () => {
      // Send setup message immediately after connection
      const setup = {
        setup: {
          model: `models/${MODEL}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: this.opts.voiceName || 'Aoede',
                },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: this.opts.systemInstruction }],
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
      };
      this.ws.send(JSON.stringify(setup));
    };

    this.ws.onmessage = (event) => {
      this._handleMessage(event);
    };

    this.ws.onerror = () => {
      this.opts.onError?.('WebSocket connection error');
    };

    this.ws.onclose = (event) => {
      this._setupDone = false;
      if (event.code !== 1000) {
        const reason = event.reason || `code ${event.code}`;
        this.opts.onError?.(`Connection closed: ${reason}`);
      }
      this.opts.onClose?.();
    };
  }

  /** Handle an incoming WebSocket message. */
  async _handleMessage(event) {
    let msg;
    if (event.data instanceof Blob) {
      const text = await event.data.text();
      msg = JSON.parse(text);
    } else {
      msg = JSON.parse(event.data);
    }

    // Setup complete acknowledgment
    if (msg.setupComplete) {
      this._setupDone = true;
      this.opts.onConnected?.();
      // Flush any buffered audio
      for (const chunk of this._audioBuffer) {
        this._sendAudioRaw(chunk);
      }
      this._audioBuffer = [];
      return;
    }

    // Server content (model turn)
    if (msg.serverContent) {
      const sc = msg.serverContent;

      if (sc.turnComplete) {
        this.opts.onTurnEnd?.();
      }

      if (sc.interrupted) {
        this.opts.onInterrupted?.();
      }

      // Output transcription (model speech -> text)
      if (sc.outputTranscription?.text) {
        this.opts.onTranscript?.('model', sc.outputTranscription.text);
      }

      // Input transcription (user speech -> text)
      if (sc.inputTranscription?.text) {
        this.opts.onTranscript?.('user', sc.inputTranscription.text);
      }

      // Model content parts
      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          // Audio data
          if (part.inlineData?.mimeType?.startsWith('audio/')) {
            const raw = atob(part.inlineData.data);
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            const pcm = new Int16Array(bytes.buffer);
            this.opts.onAudio?.(pcm);
          }
          // Text part
          if (part.text) {
            this.opts.onText?.(part.text);
          }
        }
      }
    }
  }

  /**
   * Send a PCM16 audio chunk to the API.
   * @param {Int16Array} pcm16
   */
  sendAudio(pcm16) {
    if (!this._setupDone) {
      this._audioBuffer.push(pcm16);
      return;
    }
    this._sendAudioRaw(pcm16);
  }

  /** @private */
  _sendAudioRaw(pcm16) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);

    const msg = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: b64,
          },
        ],
      },
    };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Send a text message (e.g. if user types instead of speaks).
   * @param {string} text
   */
  sendText(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = {
      clientContent: {
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true,
      },
    };
    this.ws.send(JSON.stringify(msg));
  }

  /** Cleanly close the session. */
  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'User ended session');
      this.ws = null;
    }
    this._setupDone = false;
    this._audioBuffer = [];
  }

  /** Whether the WebSocket is open and set up. */
  get connected() {
    return this._setupDone && this.ws?.readyState === WebSocket.OPEN;
  }
}
