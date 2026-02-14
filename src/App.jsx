import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getDueCards, processReview, getCardState, STATE, DEFAULT_MAX_NEW_PER_DAY, getTodayKey } from './srs';
import ConversationView from './ConversationView';
import { computeTrends } from './session-analytics';
import { unlockApiKey } from './crypto';

const STORAGE_KEY = 'french-flashcards-progress';
const DAILY_NEW_KEY = 'french-flashcards-daily-new';
const BACKUP_KEY = 'french-flashcards-last-backup';
const API_KEY_STORAGE = 'french-gemini-api-key';
const STRUGGLED_WORDS_KEY = 'french-conversation-struggled';
const BACKUP_VERSION = 1;

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function matchesAnswer(spoken, acceptedAnswers) {
  const n = normalize(spoken);
  if (!n) return false;
  return acceptedAnswers.some((a) => {
    const an = normalize(a);
    return n === an || n.includes(an) || an.includes(n);
  });
}

function RecordButton({ onResult, disabled }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState(null);
  const recRef = useRef(null);

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SpeechRecognition;

  // Abort mic on unmount (e.g. when CardView pauses or advances)
  useEffect(() => {
    return () => {
      try { recRef.current?.abort(); } catch {}
      recRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (!supported) {
      setError('Speech recognition is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    setError(null);
    const rec = new SpeechRecognition();
    recRef.current = rec;
    rec.lang = 'fr-FR';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === 'not-allowed') setError('Microphone access denied.');
      else setError('Speech recognition error. Try again.');
    };
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript || '';
      onResult(transcript);
    };
    rec.start();
  }, [supported, SpeechRecognition, onResult]);

  if (!supported) {
    return (
      <p style={{ color: 'var(--danger)', textAlign: 'center', marginTop: '1rem' }}>
        Speech recognition is not supported. Use Chrome or Edge for best experience.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
      <button
        onClick={start}
        disabled={disabled || listening}
        style={{
          width: '100%',
          maxWidth: '280px',
          padding: '1rem 1.5rem',
          fontSize: '1.25rem',
          fontWeight: 600,
          background: listening ? 'var(--surface-hover)' : 'var(--accent)',
          color: 'white',
          borderRadius: 'var(--radius)',
          transition: 'background 0.2s',
        }}
      >
        {listening ? '🎤 Listening...' : '🎤 Record Answer'}
      </button>
      {error && <p style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{error}</p>}
    </div>
  );
}


function SettingsPanel({ progress, dailyNew, onImport, onReset, lastBackup }) {
  const [mergeMode, setMergeMode] = useState(true);
  const [toast, setToast] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem(API_KEY_STORAGE) || ''; } catch { return ''; }
  });
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [showManualKey, setShowManualKey] = useState(false);
  const fileInputRef = useRef(null);
  const resetTimerRef = useRef(null);

  const trackedCount = Object.keys(progress).length;
  const totalReviews = Object.values(progress).reduce((sum, p) => sum + (p.attempts || p.reps || 0), 0);

  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Export ──
  const handleExport = useCallback(async () => {
    const data = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      progress,
      dailyNew,
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `french-progress-${dateStr}.json`;

    // Try Web Share API (iOS Safari share sheet)
    try {
      const file = new File([jsonStr], fileName, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'French Flashcards Backup' });
        localStorage.setItem(BACKUP_KEY, new Date().toISOString());
        showToast('Backup shared successfully');
        return;
      }
    } catch (err) {
      // User cancelled share sheet or not supported — fall through to download
      if (err.name === 'AbortError') {
        return; // user cancelled, don't fallback
      }
    }

    // Fallback: download file
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    localStorage.setItem(BACKUP_KEY, new Date().toISOString());
    showToast('Backup downloaded');
  }, [progress, dailyNew, showToast]);

  // ── Import ──
  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.progress || typeof data.progress !== 'object') {
          showToast('Invalid backup file: missing progress data', true);
          return;
        }

        if (mergeMode) {
          // Smart merge: for each card, keep the record with more reps or later nextReview
          const merged = { ...progress };
          let mergedCount = 0;
          for (const [id, incoming] of Object.entries(data.progress)) {
            const existing = merged[id];
            if (!existing) {
              merged[id] = incoming;
              mergedCount++;
            } else {
              const incomingScore = (incoming.reps || 0) + (incoming.attempts || 0);
              const existingScore = (existing.reps || 0) + (existing.attempts || 0);
              if (incomingScore > existingScore || (incomingScore === existingScore && (incoming.nextReview || 0) > (existing.nextReview || 0))) {
                merged[id] = incoming;
                mergedCount++;
              }
            }
          }
          onImport(merged, data.dailyNew);
          showToast(`Merged ${mergedCount} card(s) from backup`);
        } else {
          // Full replace
          onImport(data.progress, data.dailyNew);
          showToast(`Restored ${Object.keys(data.progress).length} card(s) from backup`);
        }
      } catch {
        showToast('Could not read file. Make sure it is a valid JSON backup.', true);
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  }, [mergeMode, progress, onImport, showToast]);

  const lastBackupDisplay = lastBackup
    ? new Date(lastBackup).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Never';

  return (
    <div
      style={{
        width: '100%',
        background: 'var(--surface)',
        borderRadius: 'var(--radius)',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      {/* Toast */}
      {toast && (
        <div
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 'var(--radius-sm)',
            background: toast.isError ? 'var(--danger)' : 'var(--success)',
            color: 'white',
            fontSize: '0.9rem',
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* Stats */}
      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        {trackedCount} cards tracked · {totalReviews} total reviews
        <br />
        Last backup: {lastBackupDisplay}
      </div>

      {/* Export */}
      <button
        onClick={handleExport}
        style={{
          width: '100%',
          padding: '0.75rem',
          fontSize: '1rem',
          fontWeight: 600,
          background: 'var(--accent)',
          color: 'white',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        Back Up Progress
      </button>

      {/* Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        style={{
          width: '100%',
          padding: '0.75rem',
          fontSize: '1rem',
          fontWeight: 600,
          background: 'var(--surface-hover)',
          color: 'var(--text)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        Restore Progress
      </button>

      {/* Merge toggle */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.85rem',
          color: 'var(--text-muted)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={mergeMode}
          onChange={(e) => setMergeMode(e.target.checked)}
          style={{ accentColor: 'var(--accent)' }}
        />
        Merge on import (keep best progress per card)
      </label>

      {/* Conversation Mode – API key unlock */}
      <div style={{ borderTop: '1px solid var(--surface-hover)', paddingTop: '1rem', marginTop: '0.25rem' }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Conversation Mode
        </p>

        {apiKey ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--success)' }}>API key active</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {apiKey.slice(0, 8)}...
            </span>
            <button
              onClick={() => {
                localStorage.removeItem(API_KEY_STORAGE);
                setApiKey('');
                showToast('API key cleared');
              }}
              style={{
                marginLeft: 'auto',
                padding: '0.35rem 0.65rem',
                fontSize: '0.75rem',
                fontWeight: 600,
                background: 'var(--surface-hover)',
                color: 'var(--text-muted)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              Clear
            </button>
          </div>
        ) : (
          <>
            {/* Password unlock (primary) */}
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Enter your password to unlock the API key.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && password) {
                    setUnlocking(true);
                    unlockApiKey(password)
                      .then((key) => {
                        setApiKey(key);
                        setPassword('');
                        showToast('API key unlocked');
                      })
                      .catch(() => showToast('Wrong password or no encrypted key found', true))
                      .finally(() => setUnlocking(false));
                  }
                }}
                style={{
                  flex: 1,
                  padding: '0.6rem 0.75rem',
                  fontSize: '0.9rem',
                  background: 'var(--surface-hover)',
                  color: 'var(--text)',
                  border: '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  outline: 'none',
                }}
              />
              <button
                disabled={!password || unlocking}
                onClick={() => {
                  setUnlocking(true);
                  unlockApiKey(password)
                    .then((key) => {
                      setApiKey(key);
                      setPassword('');
                      showToast('API key unlocked');
                    })
                    .catch(() => showToast('Wrong password or no encrypted key found', true))
                    .finally(() => setUnlocking(false));
                }}
                style={{
                  padding: '0.6rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  background: 'var(--accent)',
                  color: 'white',
                  borderRadius: 'var(--radius-sm)',
                  whiteSpace: 'nowrap',
                }}
              >
                {unlocking ? '...' : 'Unlock'}
              </button>
            </div>

            {/* Manual API key (fallback toggle) */}
            <button
              onClick={() => setShowManualKey((s) => !s)}
              style={{
                marginTop: '0.5rem',
                padding: 0,
                background: 'none',
                color: 'var(--text-muted)',
                fontSize: '0.75rem',
                textDecoration: 'underline',
              }}
            >
              {showManualKey ? 'Hide manual entry' : 'Or paste API key manually'}
            </button>
            {showManualKey && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <input
                  type="password"
                  placeholder="AIza..."
                  onChange={(e) => setApiKey(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '0.6rem 0.75rem',
                    fontSize: '0.9rem',
                    background: 'var(--surface-hover)',
                    color: 'var(--text)',
                    border: '1px solid transparent',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => {
                    if (apiKey.trim()) {
                      localStorage.setItem(API_KEY_STORAGE, apiKey.trim());
                      showToast('API key saved');
                    }
                  }}
                  style={{
                    padding: '0.6rem 1rem',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    background: 'var(--accent)',
                    color: 'white',
                    borderRadius: 'var(--radius-sm)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Save
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Advanced */}
      <div style={{ borderTop: '1px solid var(--surface-hover)', paddingTop: '1rem', marginTop: '0.25rem' }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Advanced
        </p>
        <button
          onClick={() => {
            if (confirmReset) {
              // Second tap: actually reset
              clearTimeout(resetTimerRef.current);
              setConfirmReset(false);
              localStorage.removeItem(STORAGE_KEY);
              localStorage.removeItem(DAILY_NEW_KEY);
              localStorage.removeItem(BACKUP_KEY);
              onReset();
              showToast('All progress has been reset');
            } else {
              // First tap: ask for confirmation
              setConfirmReset(true);
              resetTimerRef.current = setTimeout(() => setConfirmReset(false), 3000);
            }
          }}
          style={{
            width: '100%',
            padding: '0.65rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            background: confirmReset ? 'var(--danger)' : 'var(--surface-hover)',
            color: confirmReset ? 'white' : 'var(--danger)',
            borderRadius: 'var(--radius-sm)',
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          {confirmReset ? 'Tap again to confirm' : 'Reset All Progress'}
        </button>
      </div>
    </div>
  );
}

// ── Dashboard ──

function StatTile({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius-sm)',
      padding: '0.75rem',
      textAlign: 'center',
    }}>
      <p style={{ fontSize: '1.5rem', fontWeight: 700, color, margin: 0, lineHeight: 1.2 }}>{value}</p>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>{label}</p>
    </div>
  );
}

function TrendIndicator({ trend }) {
  if (trend === 'improving') return <span style={{ color: 'var(--success)', fontSize: '0.75rem', fontWeight: 600 }}> ↑ improving</span>;
  if (trend === 'declining') return <span style={{ color: 'var(--warning)', fontSize: '0.75rem', fontWeight: 600 }}> ↓ declining</span>;
  if (trend === 'stable') return <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}> → stable</span>;
  return null;
}

function ConversationDashboard() {
  const trends = useMemo(() => computeTrends(), []);
  if (!trends || trends.totalSessions === 0) {
    return (
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '1rem', textAlign: 'center' }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
          Conversation Practice
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No conversation sessions yet. Start one with the 💬 button!
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '1rem' }}>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
        Conversation Practice
      </p>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.4rem', marginBottom: '0.75rem' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--accent)' }}>{trends.streak}</p>
          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0.1rem 0 0' }}>Day streak</p>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{trends.sessionsThisWeek}</p>
          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0.1rem 0 0' }}>This week</p>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{trends.totalSessions}</p>
          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0.1rem 0 0' }}>Total</p>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{trends.avgDurationMin}m</p>
          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0.1rem 0 0' }}>Avg length</p>
        </div>
      </div>

      {/* Trend metrics */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0.5rem', background: 'var(--surface-hover)', borderRadius: 'var(--radius-sm)' }}>
          <span style={{ fontSize: '0.8rem' }}>Help moments / session</span>
          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
            {trends.avgHelpMoments}
            <TrendIndicator trend={trends.helpTrend} />
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0.5rem', background: 'var(--surface-hover)', borderRadius: 'var(--radius-sm)' }}>
          <span style={{ fontSize: '0.8rem' }}>Vocabulary diversity</span>
          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
            {Math.round(trends.avgDiversity * 100)}%
            <TrendIndicator trend={trends.diversityTrend} />
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0.5rem', background: 'var(--surface-hover)', borderRadius: 'var(--radius-sm)' }}>
          <span style={{ fontSize: '0.8rem' }}>Words per minute</span>
          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
            {trends.avgWpm}
            <TrendIndicator trend={trends.wpmTrend} />
          </span>
        </div>
      </div>

      {/* Recent sessions */}
      {trends.recentSessions.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Recent sessions
          </p>
          <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
            {trends.recentSessions.map((s) => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.3rem 0', borderBottom: '1px solid var(--surface-hover)',
                fontSize: '0.8rem',
              }}>
                <span style={{ color: 'var(--text-muted)', width: '5rem', fontSize: '0.7rem' }}>
                  {new Date(s.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                <span style={{ flex: 1 }}>
                  {s.metrics?.durationMin || 0}m · {s.metrics?.totalUserWords || 0} words
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  {s.metrics?.helpMoments || 0} helps
                </span>
                {s.aiAnalysis?.fluencyRating > 0 && (
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 600, padding: '0.1rem 0.3rem',
                    borderRadius: '4px',
                    background: s.aiAnalysis.fluencyRating >= 4 ? 'var(--success)' : s.aiAnalysis.fluencyRating >= 3 ? 'var(--accent)' : 'var(--warning)',
                    color: 'white',
                  }}>
                    {s.aiAnalysis.fluencyRating}/5
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConversationGaps({ cards, progress }) {
  const [struggled, setStruggled] = useState(() => {
    try {
      const raw = localStorage.getItem(STRUGGLED_WORDS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  if (struggled.length === 0) return null;

  // Match struggled words to existing cards
  const enriched = struggled.slice(-30).reverse().map((w) => {
    const word = (w.word || '').toLowerCase().trim();
    const matchCard = cards.find((c) =>
      c.french.toLowerCase() === word ||
      c.prompts?.some((p) => p.acceptedAnswers?.some((a) => a.toLowerCase() === word))
    );
    const cardProgress = matchCard ? getCardState(progress, matchCard.id) : null;
    return { ...w, matchCard, cardProgress };
  });

  const inDeck = enriched.filter((w) => w.matchCard);
  const notInDeck = enriched.filter((w) => !w.matchCard);

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '1rem' }}>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
        Conversation vocabulary gaps ({enriched.length})
      </p>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
        Words you struggled with in recent conversations
      </p>
      <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
        {inDeck.length > 0 && (
          <>
            <p style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 600, margin: '0.25rem 0', textTransform: 'uppercase' }}>
              In your deck ({inDeck.length})
            </p>
            {inDeck.map((w, i) => (
              <div key={`in-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.25rem 0', borderBottom: '1px solid var(--surface-hover)',
                fontSize: '0.8rem',
              }}>
                <span style={{ fontWeight: 600, flex: 1 }}>{w.word}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{w.translation}</span>
                {w.cardProgress && (
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 600, padding: '0.1rem 0.3rem',
                    borderRadius: '4px',
                    background: w.cardProgress.state === STATE.REVIEW ? 'var(--accent)' :
                               w.cardProgress.state === STATE.NEW ? 'var(--text-muted)' : 'var(--warning)',
                    color: 'white',
                  }}>
                    {w.cardProgress.state === STATE.NEW ? 'Not started' :
                     w.cardProgress.state === STATE.REVIEW ? `${Math.round(w.cardProgress.interval || 0)}d` : 'Learning'}
                  </span>
                )}
              </div>
            ))}
          </>
        )}
        {notInDeck.length > 0 && (
          <>
            <p style={{ fontSize: '0.7rem', color: 'var(--warning)', fontWeight: 600, margin: '0.5rem 0 0.25rem', textTransform: 'uppercase' }}>
              Not in deck ({notInDeck.length})
            </p>
            {notInDeck.map((w, i) => (
              <div key={`out-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.25rem 0', borderBottom: '1px solid var(--surface-hover)',
                fontSize: '0.8rem',
              }}>
                <span style={{ fontWeight: 600, flex: 1 }}>{w.word}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{w.translation}</span>
              </div>
            ))}
          </>
        )}
      </div>
      {struggled.length > 0 && (
        <button
          onClick={() => {
            localStorage.removeItem(STRUGGLED_WORDS_KEY);
            setStruggled([]);
          }}
          style={{
            marginTop: '0.5rem',
            padding: '0.35rem 0.7rem',
            fontSize: '0.75rem',
            background: 'var(--surface-hover)',
            color: 'var(--text-muted)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          Clear gaps list
        </button>
      )}
    </div>
  );
}

function Dashboard({ cards, progress }) {
  const [showAllWords, setShowAllWords] = useState(false);

  const stats = useMemo(() => {
    let mastered = 0, learning = 0, knownOnSight = 0, unseen = 0;
    let totalAttempts = 0, totalCorrect = 0, responseMsSum = 0, responseMsCount = 0;
    const cardDetails = [];

    for (const card of cards) {
      const p = getCardState(progress, card.id);
      const attempts = p.attempts || 0;
      const correct = p.correctAttempts || 0;
      const accuracy = attempts > 0 ? correct / attempts : null;
      const avgMs = p.avgResponseMs || 0;

      totalAttempts += attempts;
      totalCorrect += correct;
      if (avgMs > 0 && attempts > 0) { responseMsSum += avgMs; responseMsCount++; }

      if (p.state === STATE.NEW) {
        unseen++;
      } else if (p.knownOnSight) {
        knownOnSight++;
      } else if (p.state === STATE.REVIEW && (p.interval || 0) >= 21) {
        mastered++;
      } else {
        learning++;
      }

      cardDetails.push({ ...card, p, accuracy, avgMs, attempts });
    }

    // Forecast: next 7 days
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const forecast = Array(7).fill(0);
    for (const card of cards) {
      const p = getCardState(progress, card.id);
      if (p.state === STATE.NEW || !p.nextReview) continue;
      const daysOut = Math.max(0, Math.floor((p.nextReview - now) / dayMs));
      if (daysOut < 7) forecast[daysOut]++;
    }
    const forecastMax = Math.max(...forecast, 1);

    // Hardest words: lowest accuracy, with at least 1 attempt
    const hardest = cardDetails
      .filter((c) => c.attempts > 0 && c.accuracy !== null)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 20);

    // All words sorted by rank
    const allWords = [...cardDetails].sort((a, b) => (a.rank || 0) - (b.rank || 0));

    const overallAccuracy = totalAttempts > 0 ? totalCorrect / totalAttempts : 0;
    const avgResponseMs = responseMsCount > 0 ? responseMsSum / responseMsCount : 0;

    return {
      mastered, learning, knownOnSight, unseen,
      total: cards.length,
      totalAttempts, overallAccuracy, avgResponseMs,
      forecast, forecastMax,
      hardest, allWords,
    };
  }, [cards, progress]);

  const stateColor = (p) => {
    if (p.state === STATE.NEW) return 'var(--text-muted)';
    if (p.knownOnSight) return '#9090a0';
    if (p.state === STATE.REVIEW && (p.interval || 0) >= 21) return 'var(--success)';
    if (p.state === STATE.REVIEW) return 'var(--accent)';
    if (p.state === STATE.LEARNING) return 'var(--warning)';
    if (p.state === STATE.RELEARNING) return 'var(--danger)';
    return 'var(--text-muted)';
  };

  const stateLabel = (p) => {
    if (p.state === STATE.NEW) return 'New';
    if (p.knownOnSight) return 'Known';
    if (p.state === STATE.REVIEW && (p.interval || 0) >= 21) return 'Mastered';
    if (p.state === STATE.REVIEW) return 'Review';
    if (p.state === STATE.LEARNING) return 'Learning';
    if (p.state === STATE.RELEARNING) return 'Relearn';
    return 'New';
  };

  const pct = (n) => stats.total > 0 ? (n / stats.total * 100) : 0;

  // Day labels for forecast
  const dayLabels = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
    dayLabels.push(i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' }));
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <StatTile label="Mastered" value={stats.mastered} color="var(--success)" />
        <StatTile label="Learning" value={stats.learning} color="var(--accent)" />
        <StatTile label="Known on sight" value={stats.knownOnSight} color="var(--text-muted)" />
        <StatTile label="Unseen" value={stats.unseen} color="#555" />
      </div>

      {/* Stacked progress bar */}
      <div style={{
        width: '100%', height: '10px', borderRadius: '5px', overflow: 'hidden',
        display: 'flex', background: 'var(--surface)',
      }}>
        {pct(stats.mastered) > 0 && <div style={{ width: `${pct(stats.mastered)}%`, background: 'var(--success)' }} />}
        {pct(stats.learning) > 0 && <div style={{ width: `${pct(stats.learning)}%`, background: 'var(--accent)' }} />}
        {pct(stats.knownOnSight) > 0 && <div style={{ width: `${pct(stats.knownOnSight)}%`, background: '#9090a0' }} />}
        {pct(stats.unseen) > 0 && <div style={{ width: `${pct(stats.unseen)}%`, background: 'var(--surface-hover)' }} />}
      </div>

      {/* Accuracy & speed */}
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '1rem',
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', textAlign: 'center',
      }}>
        <div>
          <p style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: stats.overallAccuracy >= 0.8 ? 'var(--success)' : stats.overallAccuracy >= 0.5 ? 'var(--warning)' : 'var(--danger)' }}>
            {stats.totalAttempts > 0 ? `${Math.round(stats.overallAccuracy * 100)}%` : '--'}
          </p>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>Accuracy</p>
        </div>
        <div>
          <p style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
            {stats.avgResponseMs > 0 ? `${(stats.avgResponseMs / 1000).toFixed(1)}s` : '--'}
          </p>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>Avg speed</p>
        </div>
        <div>
          <p style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{stats.totalAttempts}</p>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>Reviews</p>
        </div>
      </div>

      {/* Forecast */}
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '1rem' }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
          Upcoming reviews
        </p>
        <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: '80px' }}>
          {stats.forecast.map((count, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{count || ''}</span>
              <div style={{
                width: '100%',
                height: `${Math.max(2, (count / stats.forecastMax) * 55)}px`,
                background: i === 0 ? 'var(--accent)' : 'var(--surface-hover)',
                borderRadius: '3px 3px 0 0',
                transition: 'height 0.3s',
              }} />
              <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{dayLabels[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Conversation stats */}
      <ConversationDashboard />
      <ConversationGaps cards={cards} progress={progress} />

      {/* Hardest words */}
      {stats.hardest.length > 0 && (
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '1rem' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            Hardest words
          </p>
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {stats.hardest.map((c) => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.35rem 0', borderBottom: '1px solid var(--surface-hover)',
                fontSize: '0.85rem',
              }}>
                <span style={{ color: 'var(--text-muted)', width: '2rem', textAlign: 'right', fontSize: '0.7rem' }}>#{c.rank}</span>
                <span style={{ flex: 1, fontWeight: 600 }}>{c.french}</span>
                <span style={{ color: c.accuracy < 0.5 ? 'var(--danger)' : c.accuracy < 0.8 ? 'var(--warning)' : 'var(--success)', fontWeight: 600, fontSize: '0.8rem' }}>
                  {Math.round(c.accuracy * 100)}%
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', width: '3rem', textAlign: 'right' }}>
                  {c.avgMs > 0 ? `${(c.avgMs / 1000).toFixed(1)}s` : '--'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All words (collapsible) */}
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '1rem' }}>
        <button
          onClick={() => setShowAllWords((s) => !s)}
          style={{
            width: '100%', background: 'none', color: 'var(--text-muted)',
            fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '0.05em', textAlign: 'left', padding: 0,
          }}
        >
          All words ({stats.total}) {showAllWords ? '▾' : '▸'}
        </button>
        {showAllWords && (
          <div style={{ maxHeight: '400px', overflowY: 'auto', marginTop: '0.5rem' }}>
            {stats.allWords.map((c) => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.3rem 0', borderBottom: '1px solid var(--surface-hover)',
                fontSize: '0.8rem',
              }}>
                <span style={{ color: 'var(--text-muted)', width: '2.2rem', textAlign: 'right', fontSize: '0.65rem' }}>#{c.rank}</span>
                <span style={{ flex: 1, fontWeight: 500 }}>{c.french}</span>
                <span style={{
                  fontSize: '0.65rem', fontWeight: 600, padding: '0.1rem 0.35rem',
                  borderRadius: '4px', background: stateColor(c.p), color: 'white',
                  minWidth: '3.5rem', textAlign: 'center',
                }}>
                  {stateLabel(c.p)}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', width: '2.5rem', textAlign: 'right' }}>
                  {c.p.interval ? `${Math.round(c.p.interval)}d` : '--'}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', width: '2.5rem', textAlign: 'right' }}>
                  {c.accuracy !== null ? `${Math.round(c.accuracy * 100)}%` : '--'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const IDLE_TIMEOUT_MS = 30000;

function CardView({ card, onResult }) {
  const [promptIndex] = useState(() => Math.floor(Math.random() * card.prompts.length));
  // phase: 'attempt' | 'paused' | 'reveal'
  const [phase, setPhase] = useState('attempt');
  const [transcript, setTranscript] = useState(null); // null = not recorded, string = recorded
  const [gaveUp, setGaveUp] = useState(false);
  const startTimeRef = useRef(Date.now());
  const responseTimeRef = useRef(null);

  const prompt = card.prompts[promptIndex];
  const isNewFormat = typeof prompt === 'object' && prompt.sentence && prompt.hint;
  const displayPrompt = isNewFormat ? prompt : { sentence: prompt, hint: null, acceptedAnswers: card.acceptedAnswers || [card.french] };
  const acceptedAnswers = isNewFormat ? prompt.acceptedAnswers : (card.acceptedAnswers || [card.french]);

  // Idle timeout: pause after 30s of inactivity or when tab is hidden
  useEffect(() => {
    if (phase !== 'attempt') return;

    const timer = setTimeout(() => setPhase('paused'), IDLE_TIMEOUT_MS);

    const handleVisibility = () => {
      if (document.hidden) setPhase('paused');
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [phase]);

  const handleResume = useCallback(() => {
    startTimeRef.current = Date.now();
    setPhase('attempt');
  }, []);

  const handleSpeechResult = useCallback((text) => {
    responseTimeRef.current = Date.now() - startTimeRef.current;
    setTranscript(text);
    setPhase('reveal');
  }, []);

  const handleDontKnow = useCallback(() => {
    responseTimeRef.current = Date.now() - startTimeRef.current;
    setGaveUp(true);
    setPhase('reveal');
  }, []);

  const responseMs = responseTimeRef.current;

  // Prompt display (shared between attempt and reveal phases)
  const promptBlock = (
    <>
      <p
        style={{
          fontSize: '0.85rem',
          color: 'var(--text-muted)',
          marginBottom: '0.5rem',
        }}
      >
        {isNewFormat ? 'Fill in the blank' : 'English prompt'}
      </p>
      <p
        style={{
          fontSize: '1.5rem',
          fontWeight: 600,
          marginBottom: displayPrompt.hint ? '0.25rem' : '1.5rem',
          lineHeight: 1.4,
        }}
      >
        {displayPrompt.sentence.includes('___') ? (
          <>
            {displayPrompt.sentence.split('___').map((part, i, arr) => (
              <span key={i}>
                {part}
                {i < arr.length - 1 && (
                  <span style={{ textDecoration: 'underline', textDecorationStyle: 'dashed', opacity: 0.9 }}>___</span>
                )}
              </span>
            ))}
          </>
        ) : (
          `"${displayPrompt.sentence}"`
        )}
      </p>
      {displayPrompt.hint && (
        <p
          style={{
            fontSize: '1rem',
            color: 'var(--text-muted)',
            marginBottom: '1.5rem',
            fontStyle: 'italic',
          }}
        >
          [{displayPrompt.hint}]
        </p>
      )}
    </>
  );

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '420px',
        background: 'var(--surface)',
        borderRadius: 'var(--radius)',
        padding: '1.5rem',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      {phase === 'paused' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '1rem 0' }}>
          <p style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>Session paused</p>
          <button
            onClick={handleResume}
            style={{
              width: '100%',
              maxWidth: '280px',
              padding: '1rem 1.5rem',
              fontSize: '1.15rem',
              fontWeight: 600,
              background: 'var(--accent)',
              color: 'white',
              borderRadius: 'var(--radius)',
            }}
          >
            Resume
          </button>
        </div>
      ) : (
        <>
          {promptBlock}
          {phase === 'attempt' && (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleDontKnow}
            style={{
              flex: 1,
              padding: '0.85rem',
              fontSize: '1rem',
              fontWeight: 600,
              background: 'var(--danger)',
              color: 'white',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            I don't know
          </button>
          <div style={{ flex: 1 }}>
            <RecordButton onResult={handleSpeechResult} />
          </div>
        </div>
      )}

      {phase === 'reveal' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* What you said (only if they recorded) */}
          {transcript !== null && (
            <div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                You said
              </p>
              <p style={{ fontSize: '1.1rem' }}>"{transcript}"</p>
            </div>
          )}

          {/* Accepted answers */}
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              Answer
            </p>
            <p style={{ fontSize: '1.15rem', fontWeight: 600 }}>
              {acceptedAnswers.length > 2
                ? `${card.french} (inf.) · ${acceptedAnswers.slice(0, 10).join(', ')}${acceptedAnswers.length > 10 ? '...' : ''}`
                : acceptedAnswers.join(', ')}
            </p>
          </div>

          {/* Self-grade or Next (if gave up) */}
          {gaveUp ? (
            <button
              onClick={() => onResult({ correct: false, responseMs })}
              style={{
                width: '100%',
                padding: '0.85rem',
                fontSize: '1.1rem',
                fontWeight: 600,
                background: 'var(--accent)',
                color: 'white',
                borderRadius: 'var(--radius-sm)',
                marginTop: '0.25rem',
              }}
            >
              Next →
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
              <button
                onClick={() => onResult({ correct: false, responseMs })}
                style={{
                  flex: 1,
                  padding: '0.85rem',
                  fontSize: '1.05rem',
                  fontWeight: 600,
                  background: 'var(--danger)',
                  color: 'white',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Missed it
              </button>
              <button
                onClick={() => onResult({ correct: true, responseMs })}
                style={{
                  flex: 1,
                  padding: '0.85rem',
                  fontSize: '1.05rem',
                  fontWeight: 600,
                  background: 'var(--success)',
                  color: 'white',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Got it
              </button>
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}

export default function App() {
  const [cards, setCards] = useState([]);
  const [progress, setProgress] = useState({});
  const [loading, setLoading] = useState(true);
  const [todayCount, setTodayCount] = useState(0);
  const [dailyNew, setDailyNew] = useState({ date: getTodayKey(), count: 0 });
  const [view, setView] = useState('study'); // 'study' | 'settings' | 'dashboard' | 'conversation'
  const [lastBackup, setLastBackup] = useState(() => {
    try { return localStorage.getItem(BACKUP_KEY) || null; } catch { return null; }
  });
  const [struggledWords, setStruggledWords] = useState(() => {
    try {
      const raw = localStorage.getItem(STRUGGLED_WORDS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  useEffect(() => {
    fetch('/cards.json')
      .then((r) => r.json())
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setProgress(JSON.parse(raw));
    } catch {}
    try {
      const raw = localStorage.getItem(DAILY_NEW_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const today = getTodayKey();
        if (parsed.date === today) {
          setDailyNew(parsed);
        } else {
          setDailyNew({ date: today, count: 0 });
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (Object.keys(progress).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    }
  }, [progress]);

  useEffect(() => {
    localStorage.setItem(DAILY_NEW_KEY, JSON.stringify(dailyNew));
  }, [dailyNew]);

  const due = getDueCards(cards, progress, dailyNew, DEFAULT_MAX_NEW_PER_DAY);
  const current = due[0];

  const handleResult = useCallback(
    ({ correct, responseMs }) => {
      if (!current) return;
      const wasNew = current.progress && current.progress.state === STATE.NEW;
      const result = processReview(progress, current.id, correct, responseMs);

      setProgress(result.progress);
      setTodayCount((c) => c + 1);

      // Only increment daily new counter if it was a NEW card AND not known-on-sight
      if (wasNew && !result.knownOnSight) {
        setDailyNew((prev) => {
          const today = getTodayKey();
          if (prev.date === today) {
            return { date: today, count: prev.count + 1 };
          }
          return { date: today, count: 1 };
        });
      }
    },
    [current, progress]
  );

  const handleImport = useCallback((importedProgress, importedDailyNew) => {
    setProgress(importedProgress);
    if (importedDailyNew) {
      const today = getTodayKey();
      if (importedDailyNew.date === today) {
        setDailyNew(importedDailyNew);
      }
    }
  }, []);

  const handleReset = useCallback(() => {
    setProgress({});
    setDailyNew({ date: getTodayKey(), count: 0 });
    setTodayCount(0);
    setLastBackup(null);
  }, []);

  // Handle struggled words from conversation sessions (SRS bridge)
  const handleStruggledWords = useCallback((words) => {
    setStruggledWords((prev) => {
      const existing = new Set(prev.map((w) => w.word));
      const newWords = words.filter((w) => !existing.has(w.word));
      const updated = [...prev, ...newWords.map((w) => ({ ...w, addedAt: Date.now() }))];
      // Keep last 200 struggled words
      const trimmed = updated.slice(-200);
      localStorage.setItem(STRUGGLED_WORDS_KEY, JSON.stringify(trimmed));
      return trimmed;
    });
  }, []);

  // Keep lastBackup in sync when localStorage changes (after export)
  useEffect(() => {
    const check = () => {
      const v = localStorage.getItem(BACKUP_KEY);
      if (v !== lastBackup) setLastBackup(v);
    };
    window.addEventListener('storage', check);
    // Also poll briefly after export (same-tab writes don't fire storage event)
    const id = setInterval(check, 1000);
    return () => { window.removeEventListener('storage', check); clearInterval(id); };
  }, [lastBackup]);

  if (loading) {
    return <p style={{ color: 'var(--text-muted)' }}>Loading cards...</p>;
  }

  if (cards.length === 0) {
    return (
      <p style={{ color: 'var(--danger)', textAlign: 'center' }}>
        Could not load cards. Make sure cards.json exists in the public folder.
      </p>
    );
  }

  const newCount = cards.filter((c) => !progress[c.id] || progress[c.id].state === STATE.NEW).length;
  const learnedCount = cards.filter(
    (c) => progress[c.id] && (progress[c.id].state === STATE.REVIEW || progress[c.id].state === STATE.LEARNING)
  ).length;
  const knownOnSightCount = cards.filter((c) => progress[c.id] && progress[c.id].knownOnSight).length;
  const newToday = dailyNew.date === getTodayKey() ? dailyNew.count : 0;
  const newRemaining = Math.max(0, DEFAULT_MAX_NEW_PER_DAY - newToday);

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '480px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.5rem',
      }}
    >
      <header style={{ textAlign: 'center', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.25rem', marginBottom: '0.25rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
            French Speech Flashcards
          </h1>
          <button
            onClick={() => setView((v) => v === 'conversation' ? 'study' : 'conversation')}
            aria-label="Conversation"
            style={{
              background: view === 'conversation' ? 'var(--surface-hover)' : 'transparent',
              color: 'var(--text-muted)',
              fontSize: '1.15rem',
              padding: '0.25rem 0.45rem',
              borderRadius: 'var(--radius-sm)',
              lineHeight: 1,
              transition: 'background 0.2s',
            }}
          >
            {view === 'conversation' ? '✕' : '💬'}
          </button>
          <button
            onClick={() => setView((v) => v === 'dashboard' ? 'study' : 'dashboard')}
            aria-label="Dashboard"
            style={{
              background: view === 'dashboard' ? 'var(--surface-hover)' : 'transparent',
              color: 'var(--text-muted)',
              fontSize: '1.15rem',
              padding: '0.25rem 0.45rem',
              borderRadius: 'var(--radius-sm)',
              lineHeight: 1,
              transition: 'background 0.2s',
            }}
          >
            {view === 'dashboard' ? '✕' : '📊'}
          </button>
          <button
            onClick={() => setView((v) => v === 'settings' ? 'study' : 'settings')}
            aria-label="Settings"
            style={{
              background: view === 'settings' ? 'var(--surface-hover)' : 'transparent',
              color: 'var(--text-muted)',
              fontSize: '1.15rem',
              padding: '0.25rem 0.45rem',
              borderRadius: 'var(--radius-sm)',
              lineHeight: 1,
              transition: 'background 0.2s',
            }}
          >
            {view === 'settings' ? '✕' : '⚙'}
          </button>
        </div>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          {learnedCount} learned · {knownOnSightCount > 0 ? `${knownOnSightCount} already known · ` : ''}{newCount} new · {newToday}/{DEFAULT_MAX_NEW_PER_DAY} new today · {todayCount} reviews
        </p>
      </header>

      {view === 'settings' && (
        <SettingsPanel
          progress={progress}
          dailyNew={dailyNew}
          onImport={handleImport}
          onReset={handleReset}
          lastBackup={lastBackup}
        />
      )}

      {view === 'conversation' && (
        <ConversationView
          cards={cards}
          progress={progress}
          onStruggledWords={handleStruggledWords}
        />
      )}

      {view === 'dashboard' && (
        <Dashboard cards={cards} progress={progress} />
      )}

      {view === 'study' && (
        current ? (
          <CardView key={current.id} card={current} onResult={handleResult} />
        ) : (
          <div
            style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius)',
              padding: '2rem',
              textAlign: 'center',
              width: '100%',
            }}
          >
            <p style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>All done for now!</p>
            <p style={{ color: 'var(--text-muted)' }}>
              {newRemaining > 0 && newCount > 0
                ? `${newRemaining} new cards remaining today. No reviews due right now.`
                : 'No cards due today. Come back tomorrow for more reviews.'}
            </p>
          </div>
        )
      )}
    </div>
  );
}
