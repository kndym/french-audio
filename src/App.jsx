import { useState, useEffect, useCallback, useRef } from 'react';
import { getDueCards, processReview, classifyResult, STATE, DEFAULT_MAX_NEW_PER_DAY, getTodayKey } from './srs';

const STORAGE_KEY = 'french-flashcards-progress';
const DAILY_NEW_KEY = 'french-flashcards-daily-new';
const BACKUP_KEY = 'french-flashcards-last-backup';
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

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SpeechRecognition;

  const start = useCallback(() => {
    if (!supported) {
      setError('Speech recognition is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    setError(null);
    const rec = new SpeechRecognition();
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

/** Grade label + color based on classification */
function gradeDisplay(grade) {
  switch (grade) {
    case 'know_fast':  return { label: 'Knew it!', color: 'var(--success)', icon: '⚡' };
    case 'know_medium': return { label: 'Got it', color: 'var(--accent)', icon: '✓' };
    case 'know_slow':  return { label: 'Slow but right', color: 'var(--warning)', icon: '⏱' };
    case 'miss':       return { label: "Didn't know", color: 'var(--danger)', icon: '✗' };
    default:           return { label: 'Reviewed', color: 'var(--text-muted)', icon: '·' };
  }
}

function SettingsPanel({ progress, dailyNew, onImport, lastBackup }) {
  const [mergeMode, setMergeMode] = useState(true);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

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
    </div>
  );
}

function CardView({ card, onResult }) {
  const [promptIndex] = useState(() => Math.floor(Math.random() * card.prompts.length));
  const [transcript, setTranscript] = useState(null);
  const startTimeRef = useRef(Date.now());
  const responseTimeRef = useRef(null);

  const prompt = card.prompts[promptIndex];
  const isNewFormat = typeof prompt === 'object' && prompt.sentence && prompt.hint;
  const displayPrompt = isNewFormat ? prompt : { sentence: prompt, hint: null, acceptedAnswers: card.acceptedAnswers || [card.french] };
  const acceptedAnswers = isNewFormat ? prompt.acceptedAnswers : (card.acceptedAnswers || [card.french]);

  const handleSpeechResult = useCallback((text) => {
    responseTimeRef.current = Date.now() - startTimeRef.current;
    setTranscript(text);
  }, []);

  const correct = transcript !== null && matchesAnswer(transcript, acceptedAnswers);
  const responseMs = responseTimeRef.current;
  const grade = transcript !== null ? classifyResult(correct, responseMs) : null;
  const display = grade ? gradeDisplay(grade) : null;

  const handleNext = useCallback(() => {
    onResult({ correct, responseMs });
  }, [onResult, correct, responseMs]);

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

      {transcript === null ? (
        <RecordButton onResult={handleSpeechResult} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Grade banner */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              background: display.color,
              color: 'white',
              fontWeight: 600,
              fontSize: '1.1rem',
            }}
          >
            <span style={{ fontSize: '1.3rem' }}>{display.icon}</span>
            <span>{display.label}</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.85rem', opacity: 0.85 }}>
              {(responseMs / 1000).toFixed(1)}s
            </span>
          </div>

          {/* What you said */}
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              You said
            </p>
            <p style={{ fontSize: '1.1rem' }}>"{transcript}"</p>
          </div>

          {/* Accepted answers */}
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              Accepted
            </p>
            <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>
              {acceptedAnswers.length > 2
                ? `${card.french} (inf.) · ${acceptedAnswers.slice(0, 10).join(', ')}${acceptedAnswers.length > 10 ? '...' : ''}`
                : acceptedAnswers.join(', ')}
            </p>
          </div>

          {/* Next button */}
          <button
            onClick={handleNext}
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
        </div>
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
  const [showSettings, setShowSettings] = useState(false);
  const [lastBackup, setLastBackup] = useState(() => {
    try { return localStorage.getItem(BACKUP_KEY) || null; } catch { return null; }
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
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
            French Speech Flashcards
          </h1>
          <button
            onClick={() => setShowSettings((s) => !s)}
            aria-label="Settings"
            style={{
              background: showSettings ? 'var(--surface-hover)' : 'transparent',
              color: 'var(--text-muted)',
              fontSize: '1.25rem',
              padding: '0.25rem 0.5rem',
              borderRadius: 'var(--radius-sm)',
              lineHeight: 1,
              transition: 'background 0.2s',
            }}
          >
            {showSettings ? '✕' : '⚙'}
          </button>
        </div>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          {learnedCount} learned · {knownOnSightCount > 0 ? `${knownOnSightCount} already known · ` : ''}{newCount} new · {newToday}/{DEFAULT_MAX_NEW_PER_DAY} new today · {todayCount} reviews
        </p>
      </header>

      {showSettings && (
        <SettingsPanel
          progress={progress}
          dailyNew={dailyNew}
          onImport={handleImport}
          lastBackup={lastBackup}
        />
      )}

      {current ? (
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
      )}
    </div>
  );
}
