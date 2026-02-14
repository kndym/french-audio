import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GeminiLiveClient } from './gemini-live';
import { AudioManager } from './audio-manager';
import { computeMetrics, saveSession, updateSession } from './session-analytics';
import { analyzeSession } from './gemini-text';
import { unlockApiKey, hasEncryptedKey } from './crypto';

// ── System prompt ──────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `You are a natural French conversation partner for a B2-level learner who understands well but struggles with vocabulary recall (active production).

CORE RULES:
1. Speak ONLY in French. Never switch to English unless the user is completely lost and explicitly asks.
2. When the user hesitates or searches for a word:
   - First, wait a beat — give them time to find it themselves
   - If they're stuck, encourage circumlocution: "Tu peux décrire ce que tu veux dire ?"
   - If still stuck, offer a hint: first letter, a synonym, or a short definition in French
   - Give the full word ONLY as a last resort, and then ask them to repeat it in a sentence
3. When the user makes a grammar error, recast it naturally in your response (don't explicitly say "you made an error")
4. Ask open-ended follow-up questions to keep the user producing speech
5. Use common idiomatic expressions and collocations — expose the user to natural French
6. Speak at a normal pace with clear articulation
7. Keep your responses concise (2-4 sentences) to maximize the user's speaking time — this is THEIR practice, not a lecture

CONVERSATION STYLE:
- Warm, patient, genuinely curious — like a friend at a café
- Vary topics naturally: daily life, opinions, culture, hypotheticals
- Occasionally introduce a slightly challenging word and check comprehension
- If the user says a word in English, say "Ah, tu cherches le mot pour [english word] ? En français on dit..." and help them find it

Start by greeting the user warmly in French and asking a simple open-ended question to kick off the conversation.`;

const MAX_SESSION_MS = 15 * 60 * 1000; // 15 min max
const API_KEY_STORAGE = 'french-gemini-api-key';

// ── Topic suggestions ──────────────────────────────────────────
const TOPICS = [
  'La vie quotidienne',
  'Les voyages et la culture',
  'La nourriture et la cuisine',
  'Le travail et les ambitions',
  'Les loisirs et les passions',
  'L\'actualité et les opinions',
  'Les souvenirs d\'enfance',
  'La technologie et l\'avenir',
];

// ── Conversation phases ────────────────────────────────────────
// idle -> connecting -> active -> ended

export default function ConversationView({ cards, progress, onStruggledWords }) {
  const [phase, setPhase] = useState('idle');       // idle | connecting | active | ended
  const [transcript, setTranscript] = useState([]);  // [{role, text, timestamp}]
  const [elapsedMs, setElapsedMs] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [modelSpeaking, setModelSpeaking] = useState(false);
  const [error, setError] = useState(null);
  const [sessionMetrics, setSessionMetrics] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [muted, setMuted] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState(null);

  const clientRef = useRef(null);
  const audioRef = useRef(null);
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const levelRef = useRef(null);
  const sessionIdRef = useRef(null);
  const transcriptRef = useRef(transcript);
  const scrollRef = useRef(null);

  // Keep ref in sync
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  // Auto-scroll transcript
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript]);

  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem(API_KEY_STORAGE) || ''; } catch { return ''; }
  });
  const [passwordInput, setPasswordInput] = useState('');
  const [unlockingKey, setUnlockingKey] = useState(false);
  const [hasEncKey, setHasEncKey] = useState(false);

  // Check if encrypted key file exists
  useEffect(() => {
    hasEncryptedKey().then(setHasEncKey);
  }, []);

  // ── Cleanup on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      audioRef.current?.destroy();
      clearInterval(timerRef.current);
      clearInterval(levelRef.current);
    };
  }, []);

  // ── Build system instruction with optional topic ─────────────
  const getSystemInstruction = useCallback(() => {
    if (!selectedTopic) return SYSTEM_INSTRUCTION;
    return SYSTEM_INSTRUCTION + `\n\nThe user has chosen to talk about: "${selectedTopic}". Start the conversation on this topic, but let it evolve naturally.`;
  }, [selectedTopic]);

  // ── Start conversation ───────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!apiKey) {
      setError('Please set your Gemini API key in Settings first.');
      return;
    }

    setPhase('connecting');
    setError(null);
    setTranscript([]);
    setSessionMetrics(null);
    setAiAnalysis(null);
    sessionIdRef.current = `conv-${Date.now()}`;

    try {
      // Set up audio
      const audio = new AudioManager({
        onAudioChunk: (pcm16) => {
          clientRef.current?.sendAudio(pcm16);
        },
      });
      audioRef.current = audio;

      await audio.startCapture();
      await audio.startPlayback();

      // Current accumulated model transcript for the current turn
      let currentModelText = '';

      // Set up Gemini Live client
      const client = new GeminiLiveClient({
        apiKey,
        systemInstruction: getSystemInstruction(),
        onAudio: (pcm16) => {
          audio.playAudio(pcm16);
        },
        onText: () => {
          // Text parts from model turn (if any) — usually audio is primary
        },
        onTranscript: (role, text) => {
          if (!text || !text.trim()) return;

          if (role === 'model') {
            // Accumulate model text within a turn
            currentModelText += text;
            // Update or create the latest model entry
            setTranscript((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === 'model' && last._accumulating) {
                return [
                  ...prev.slice(0, -1),
                  { ...last, text: currentModelText },
                ];
              }
              return [
                ...prev,
                { role: 'model', text: currentModelText, timestamp: Date.now(), _accumulating: true },
              ];
            });
          } else {
            // User transcripts come as complete turns
            setTranscript((prev) => [
              ...prev,
              { role: 'user', text: text.trim(), timestamp: Date.now() },
            ]);
          }
        },
        onTurnStart: () => {
          setModelSpeaking(true);
          currentModelText = '';
        },
        onTurnEnd: () => {
          setModelSpeaking(false);
          // Finalize the accumulating model entry
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'model' && last._accumulating) {
              const { _accumulating, ...rest } = last;
              return [...prev.slice(0, -1), rest];
            }
            return prev;
          });
          currentModelText = '';
        },
        onConnected: () => {
          setPhase('active');
          startTimeRef.current = Date.now();

          // Start elapsed timer
          timerRef.current = setInterval(() => {
            const elapsed = Date.now() - startTimeRef.current;
            setElapsedMs(elapsed);
            if (elapsed >= MAX_SESSION_MS) {
              handleEnd();
            }
          }, 1000);

          // Start input level polling
          levelRef.current = setInterval(() => {
            if (audioRef.current) {
              setInputLevel(audioRef.current.getInputLevel());
            }
          }, 100);
        },
        onError: (msg) => {
          setError(msg);
          if (phase === 'connecting') setPhase('idle');
        },
        onClose: () => {
          if (phase === 'active' || phase === 'connecting') {
            // Unexpected close - trigger end
            handleEnd();
          }
        },
        onInterrupted: () => {
          audio.clearPlayback();
          setModelSpeaking(false);
        },
      });
      clientRef.current = client;
      client.connect();
    } catch (err) {
      setError(err.message || 'Failed to start conversation');
      setPhase('idle');
    }
  }, [apiKey, getSystemInstruction]);

  // ── End conversation ─────────────────────────────────────────
  const handleEnd = useCallback(() => {
    clearInterval(timerRef.current);
    clearInterval(levelRef.current);
    timerRef.current = null;
    levelRef.current = null;

    clientRef.current?.disconnect();
    audioRef.current?.destroy();
    clientRef.current = null;
    audioRef.current = null;

    const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;

    // Clean transcript (remove _accumulating flags)
    const cleanTranscript = transcriptRef.current.map(({ _accumulating, ...rest }) => rest);

    // Compute metrics
    const metrics = computeMetrics(cleanTranscript, elapsed);
    setSessionMetrics(metrics);

    // Save session
    const session = {
      id: sessionIdRef.current,
      timestamp: Date.now(),
      metrics,
      transcript: cleanTranscript,
    };
    saveSession(session);

    setPhase('ended');
    setModelSpeaking(false);

    // Run AI analysis in background
    if (apiKey && cleanTranscript.length > 2) {
      setAnalyzing(true);
      analyzeSession(apiKey, cleanTranscript)
        .then((analysis) => {
          setAiAnalysis(analysis);
          updateSession(sessionIdRef.current, { aiAnalysis: analysis });

          // Extract struggled words for SRS bridge
          if (analysis.struggledVocabulary?.length > 0) {
            onStruggledWords?.(analysis.struggledVocabulary);
          }
        })
        .catch(() => {
          // Non-critical — metrics are still available
        })
        .finally(() => setAnalyzing(false));
    }
  }, [apiKey, onStruggledWords]);

  // ── Toggle mute ──────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    setMuted((m) => {
      audioRef.current?.setMuted(!m);
      return !m;
    });
  }, []);

  // ── Format time ──────────────────────────────────────────────
  const formatTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const remaining = MAX_SESSION_MS - elapsedMs;
  const remainingPct = Math.max(0, remaining / MAX_SESSION_MS) * 100;

  // ── Render ───────────────────────────────────────────────────

  // Password unlock handler
  const handleUnlock = useCallback(() => {
    if (!passwordInput) return;
    setUnlockingKey(true);
    setError(null);
    unlockApiKey(passwordInput)
      .then((key) => {
        setApiKey(key);
        setPasswordInput('');
      })
      .catch(() => setError('Wrong password. Try again.'))
      .finally(() => setUnlockingKey(false));
  }, [passwordInput]);

  // No API key set
  if (!apiKey && phase === 'idle') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Conversation Practice</h2>

          {hasEncKey ? (
            <>
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '0.9rem', marginBottom: '1rem' }}>
                Enter your password to unlock the API key.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Password..."
                  onKeyDown={(e) => { if (e.key === 'Enter') handleUnlock(); }}
                  style={{
                    flex: 1,
                    padding: '0.7rem 0.75rem',
                    fontSize: '1rem',
                    background: 'var(--surface-hover)',
                    color: 'var(--text)',
                    border: '1px solid transparent',
                    borderRadius: 'var(--radius-sm)',
                    outline: 'none',
                  }}
                />
                <button
                  disabled={!passwordInput || unlockingKey}
                  onClick={handleUnlock}
                  style={{
                    ...styles.startBtn,
                    width: 'auto',
                    padding: '0.7rem 1.25rem',
                  }}
                >
                  {unlockingKey ? '...' : 'Unlock'}
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '0.9rem' }}>
              Go to Settings and enter your Gemini API key to use conversation mode.
              Get a free key at{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                aistudio.google.com
              </a>
            </p>
          )}

          {error && (
            <p style={{ color: 'var(--danger)', fontSize: '0.85rem', textAlign: 'center' }}>
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── IDLE phase ───────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Conversation Practice</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem', textAlign: 'center' }}>
            Have a natural French conversation. The AI will help you find words when you're stuck.
          </p>

          {/* Topic chips */}
          <div style={{ marginBottom: '1.25rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Choose a topic (optional):
            </p>
            <div style={styles.topicGrid}>
              {TOPICS.map((topic) => (
                <button
                  key={topic}
                  onClick={() => setSelectedTopic(selectedTopic === topic ? null : topic)}
                  style={{
                    ...styles.topicChip,
                    background: selectedTopic === topic ? 'var(--accent)' : 'var(--surface-hover)',
                    color: selectedTopic === topic ? 'white' : 'var(--text)',
                  }}
                >
                  {topic}
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleStart} style={styles.startBtn}>
            Start Conversation
          </button>

          {error && (
            <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.75rem', textAlign: 'center' }}>
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── CONNECTING phase ─────────────────────────────────────────
  if (phase === 'connecting') {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.card, textAlign: 'center' }}>
          <div style={styles.spinner} />
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>
            Connecting...
          </p>
        </div>
      </div>
    );
  }

  // ── ACTIVE phase ─────────────────────────────────────────────
  if (phase === 'active') {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.card, padding: '1rem' }}>
          {/* Header bar: timer + controls */}
          <div style={styles.activeHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: modelSpeaking ? 'var(--accent)' : 'var(--success)',
                animation: modelSpeaking ? 'pulse 1s infinite' : 'none',
              }} />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {modelSpeaking ? 'AI speaking...' : 'Listening...'}
              </span>
            </div>
            <span style={{
              fontSize: '0.85rem',
              fontWeight: 600,
              color: remaining < 60000 ? 'var(--danger)' : 'var(--text-muted)',
            }}>
              {formatTime(elapsedMs)} / 15:00
            </span>
          </div>

          {/* Time remaining bar */}
          <div style={styles.progressBarBg}>
            <div style={{ ...styles.progressBarFill, width: `${remainingPct}%` }} />
          </div>

          {/* Audio level indicator */}
          <div style={styles.levelBarBg}>
            <div style={{
              ...styles.levelBarFill,
              width: `${Math.min(inputLevel * 100 * 3, 100)}%`,
              background: muted ? 'var(--danger)' : 'var(--success)',
            }} />
          </div>

          {/* Transcript area */}
          <div ref={scrollRef} style={styles.transcriptArea}>
            {transcript.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', marginTop: '2rem' }}>
                Waiting for the conversation to begin...
              </p>
            )}
            {transcript.map((entry, i) => (
              <div
                key={i}
                style={{
                  ...styles.transcriptEntry,
                  alignSelf: entry.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div style={{
                  ...styles.transcriptBubble,
                  background: entry.role === 'user' ? 'var(--accent)' : 'var(--surface-hover)',
                  color: entry.role === 'user' ? 'white' : 'var(--text)',
                  borderBottomRightRadius: entry.role === 'user' ? '4px' : 'var(--radius-sm)',
                  borderBottomLeftRadius: entry.role === 'model' ? '4px' : 'var(--radius-sm)',
                }}>
                  {entry.text}
                </div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div style={styles.activeControls}>
            <button onClick={toggleMute} style={{
              ...styles.controlBtn,
              background: muted ? 'var(--danger)' : 'var(--surface-hover)',
            }}>
              {muted ? '🔇 Muted' : '🎤 Mic On'}
            </button>
            <button onClick={handleEnd} style={styles.endBtn}>
              End Session
            </button>
          </div>

          {error && (
            <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.5rem', textAlign: 'center' }}>
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── ENDED phase ──────────────────────────────────────────────
  if (phase === 'ended') {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.card, maxHeight: '80vh', overflowY: 'auto' }}>
          <h2 style={{ ...styles.cardTitle, marginBottom: '1rem' }}>Session Complete</h2>

          {/* Quick metrics */}
          {sessionMetrics && (
            <div style={styles.metricsGrid}>
              <MetricCard label="Duration" value={`${sessionMetrics.durationMin} min`} />
              <MetricCard label="Words Spoken" value={sessionMetrics.totalUserWords} />
              <MetricCard label="Words/Min" value={sessionMetrics.wordsPerMinute} />
              <MetricCard label="Unique Vocab" value={sessionMetrics.uniqueContentWords} />
              <MetricCard label="Vocab Diversity" value={`${Math.round(sessionMetrics.typeTokenRatio * 100)}%`} />
              <MetricCard label="Help Moments" value={sessionMetrics.helpMoments} />
              <MetricCard label="Avg Turn Length" value={`${sessionMetrics.avgTurnLength} words`} />
              <MetricCard label="English Words" value={sessionMetrics.englishFallbacks} />
            </div>
          )}

          {/* AI Analysis */}
          {analyzing && (
            <div style={{ textAlign: 'center', margin: '1rem 0' }}>
              <div style={styles.spinner} />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                Analyzing your conversation...
              </p>
            </div>
          )}

          {aiAnalysis && (
            <div style={{ marginTop: '1rem' }}>
              {/* Fluency */}
              <div style={styles.analysisSection}>
                <h3 style={styles.analysisSectionTitle}>
                  Fluency: {aiAnalysis.fluencyRating}/5
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {aiAnalysis.fluencyJustification}
                </p>
              </div>

              {/* Encouragement */}
              {aiAnalysis.encouragement && (
                <div style={{ ...styles.analysisSection, background: 'rgba(34,197,94,0.1)', borderLeft: '3px solid var(--success)' }}>
                  <p style={{ fontSize: '0.9rem' }}>{aiAnalysis.encouragement}</p>
                </div>
              )}

              {/* Struggled vocabulary */}
              {aiAnalysis.struggledVocabulary?.length > 0 && (
                <div style={styles.analysisSection}>
                  <h3 style={styles.analysisSectionTitle}>Vocabulary Gaps</h3>
                  {aiAnalysis.struggledVocabulary.map((v, i) => (
                    <div key={i} style={styles.vocabItem}>
                      <span style={{ fontWeight: 600 }}>{v.word}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}> — {v.translation}</span>
                      {v.context && (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic', marginTop: '0.15rem' }}>
                          "{v.context}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Grammar patterns */}
              {aiAnalysis.grammarPatterns?.length > 0 && (
                <div style={styles.analysisSection}>
                  <h3 style={styles.analysisSectionTitle}>Grammar Patterns</h3>
                  {aiAnalysis.grammarPatterns.map((g, i) => (
                    <div key={i} style={{ marginBottom: '0.5rem' }}>
                      <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{g.pattern}</p>
                      {g.example && (
                        <p style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>
                          {g.example}
                        </p>
                      )}
                      {g.correction && (
                        <p style={{ color: 'var(--success)', fontSize: '0.8rem' }}>
                          → {g.correction}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Vocab used well */}
              {aiAnalysis.vocabularyUsedWell?.length > 0 && (
                <div style={styles.analysisSection}>
                  <h3 style={styles.analysisSectionTitle}>Vocabulary Used Well</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {aiAnalysis.vocabularyUsedWell.map((w, i) => (
                      <span key={i} style={styles.goodWordChip}>{w}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested focus areas */}
              {aiAnalysis.suggestedFocusAreas?.length > 0 && (
                <div style={styles.analysisSection}>
                  <h3 style={styles.analysisSectionTitle}>Focus Areas for Next Time</h3>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                    {aiAnalysis.suggestedFocusAreas.map((area, i) => (
                      <li key={i} style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                        {area}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
            <button
              onClick={() => {
                setPhase('idle');
                setSelectedTopic(null);
              }}
              style={styles.startBtn}
            >
              New Conversation
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── Small metric card ──────────────────────────────────────────
function MetricCard({ label, value }) {
  return (
    <div style={styles.metricCard}>
      <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{value}</span>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </span>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────
const styles = {
  container: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    background: 'var(--surface)',
    borderRadius: 'var(--radius)',
    padding: '1.5rem',
    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
  },
  cardTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
    textAlign: 'center',
    margin: 0,
    marginBottom: '0.5rem',
  },
  topicGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.4rem',
  },
  topicChip: {
    padding: '0.35rem 0.7rem',
    fontSize: '0.8rem',
    borderRadius: '999px',
    transition: 'all 0.2s',
  },
  startBtn: {
    width: '100%',
    padding: '0.9rem',
    fontSize: '1.1rem',
    fontWeight: 600,
    background: 'var(--accent)',
    color: 'white',
    borderRadius: 'var(--radius-sm)',
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid var(--surface-hover)',
    borderTopColor: 'var(--accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    margin: '0 auto',
  },
  activeHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
  },
  progressBarBg: {
    width: '100%',
    height: 3,
    background: 'var(--surface-hover)',
    borderRadius: 2,
    marginBottom: '0.35rem',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    background: 'var(--accent)',
    borderRadius: 2,
    transition: 'width 1s linear',
  },
  levelBarBg: {
    width: '100%',
    height: 3,
    background: 'var(--surface-hover)',
    borderRadius: 2,
    marginBottom: '0.75rem',
    overflow: 'hidden',
  },
  levelBarFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.1s',
  },
  transcriptArea: {
    minHeight: 200,
    maxHeight: 350,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    marginBottom: '0.75rem',
    padding: '0.5rem 0',
  },
  transcriptEntry: {
    display: 'flex',
    maxWidth: '85%',
  },
  transcriptBubble: {
    padding: '0.5rem 0.75rem',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.9rem',
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  activeControls: {
    display: 'flex',
    gap: '0.5rem',
  },
  controlBtn: {
    flex: 1,
    padding: '0.75rem',
    fontSize: '0.95rem',
    fontWeight: 600,
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text)',
  },
  endBtn: {
    flex: 1,
    padding: '0.75rem',
    fontSize: '0.95rem',
    fontWeight: 600,
    background: 'var(--danger)',
    color: 'white',
    borderRadius: 'var(--radius-sm)',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '0.5rem',
  },
  metricCard: {
    background: 'var(--surface-hover)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.6rem 0.4rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.15rem',
    textAlign: 'center',
  },
  analysisSection: {
    background: 'var(--surface-hover)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.75rem',
    marginBottom: '0.5rem',
  },
  analysisSectionTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    margin: 0,
    marginBottom: '0.35rem',
  },
  vocabItem: {
    marginBottom: '0.35rem',
    paddingBottom: '0.35rem',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  goodWordChip: {
    background: 'rgba(34,197,94,0.15)',
    color: 'var(--success)',
    padding: '0.2rem 0.5rem',
    borderRadius: '999px',
    fontSize: '0.8rem',
    fontWeight: 600,
  },
};
