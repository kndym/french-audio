import { useState, useEffect, useCallback } from 'react';
import { getDueCards, processReview, STATE } from './srs';

const STORAGE_KEY = 'french-flashcards-progress';

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

function CardView({ card, progress, onRating }) {
  const [promptIndex] = useState(() => Math.floor(Math.random() * card.prompts.length));
  const [transcript, setTranscript] = useState(null);
  const prompt = card.prompts[promptIndex];

  const handleResult = useCallback((text) => setTranscript(text), []);

  const isCorrect = transcript !== null && matchesAnswer(transcript, card.acceptedAnswers);

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
        English prompt
      </p>
      <p
        style={{
          fontSize: '1.5rem',
          fontWeight: 600,
          marginBottom: '1.5rem',
          lineHeight: 1.4,
        }}
      >
        "{prompt}"
      </p>

      {transcript === null ? (
        <RecordButton onResult={handleResult} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              You said
            </p>
            <p style={{ fontSize: '1.1rem' }}>"{transcript}"</p>
          </div>
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              Accepted
            </p>
            <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>
              {card.acceptedAnswers.slice(0, 8).join(', ')}
              {card.acceptedAnswers.length > 8 ? '...' : ''}
            </p>
          </div>
          <p
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              color: 'var(--success)',
              marginTop: '0.5rem',
            }}
          >
            {card.french}
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.5rem',
              marginTop: '0.5rem',
            }}
          >
            <button
              onClick={() => onRating('again')}
              style={{
                padding: '0.75rem',
                fontSize: '0.95rem',
                background: 'var(--danger)',
                color: 'white',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              Again
            </button>
            <button
              onClick={() => onRating('hard')}
              style={{
                padding: '0.75rem',
                fontSize: '0.95rem',
                background: 'var(--warning)',
                color: 'white',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              Hard
            </button>
            <button
              onClick={() => onRating('good')}
              style={{
                padding: '0.75rem',
                fontSize: '0.95rem',
                background: 'var(--success)',
                color: 'white',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              Good
            </button>
            <button
              onClick={() => onRating('easy')}
              style={{
                padding: '0.75rem',
                fontSize: '0.95rem',
                background: 'var(--accent)',
                color: 'white',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              Easy
            </button>
          </div>
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
  }, []);

  useEffect(() => {
    if (Object.keys(progress).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    }
  }, [progress]);

  const due = getDueCards(cards, progress);
  const current = due[0];

  const handleRating = useCallback(
    (rating) => {
      if (!current) return;
      setProgress((p) => processReview(p, current.id, rating));
      setTodayCount((c) => c + 1);
    },
    [current]
  );

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
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>
          French Speech Flashcards
        </h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          Progress: {learnedCount} learned · {newCount} new · Today: {todayCount}
        </p>
      </header>

      {current ? (
        <CardView key={current.id} card={current} progress={progress} onRating={handleRating} />
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
            No cards due today. Come back tomorrow for more reviews.
          </p>
        </div>
      )}
    </div>
  );
}
