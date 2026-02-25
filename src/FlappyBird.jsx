import { useEffect, useRef, useState, useCallback } from 'react';
import { getDueCards, DEFAULT_MAX_NEW_PER_DAY, getTodayKey } from './srs';
import { getSessions } from './session-analytics';

const STORAGE_KEY = 'french-flashcards-progress';
const DAILY_NEW_KEY = 'french-flashcards-daily-new';

// ── Unlock guard ───────────────────────────────────────────────

function isWeekend() {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

function hasCompletedTodayConversation() {
  const sessions = getSessions();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return sessions.some(
    (s) => s.timestamp >= todayStart.getTime() && (s.metrics?.durationMin || 0) >= 5
  );
}

function checkUnlocked(cards, progress, dailyNew) {
  const due = getDueCards(cards, progress, dailyNew, DEFAULT_MAX_NEW_PER_DAY);
  if (due.length > 0) return { ok: false, reason: 'cards' };
  if (isWeekend() && !hasCompletedTodayConversation()) return { ok: false, reason: 'convo' };
  return { ok: true };
}

// ── Game constants ─────────────────────────────────────────────

const GRAVITY = 0.42;
const FLAP_FORCE = -8.5;
const PIPE_WIDTH = 54;
const PIPE_GAP = 158;
const PIPE_SPEED = 2.4;
const PIPE_INTERVAL = 95; // frames
const BIRD_X = 80;
const BIRD_R = 13;

// ── Guard wrapper ──────────────────────────────────────────────

export default function FlappyPage() {
  const [status, setStatus] = useState('loading'); // loading | locked-cards | locked-convo | unlocked

  useEffect(() => {
    fetch('/cards.json')
      .then((r) => r.json())
      .then((cards) => {
        let progress = {};
        let dailyNew = { date: getTodayKey(), count: 0 };
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) progress = JSON.parse(raw);
        } catch {}
        try {
          const raw = localStorage.getItem(DAILY_NEW_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.date === getTodayKey()) dailyNew = parsed;
          }
        } catch {}

        const result = checkUnlocked(cards, progress, dailyNew);
        if (!result.ok) {
          // Brief pause so the redirect feels intentional, not like a flash
          setTimeout(() => {
            if (result.reason === 'convo') {
              setStatus('locked-convo');
              setTimeout(() => { window.location.replace('/'); }, 2500);
            } else {
              setStatus('locked-cards');
              setTimeout(() => { window.location.replace('/'); }, 2500);
            }
          }, 300);
        } else {
          setStatus('unlocked');
        }
      })
      .catch(() => {
        window.location.replace('/');
      });
  }, []);

  if (status === 'loading') {
    return (
      <div style={lockStyles.wrapper}>
        <p style={{ color: '#666' }}>Checking...</p>
      </div>
    );
  }

  if (status === 'locked-cards') {
    return (
      <div style={lockStyles.wrapper}>
        <p style={lockStyles.icon}>📚</p>
        <p style={lockStyles.msg}>Finish today's cards first.</p>
        <p style={lockStyles.sub}>Redirecting...</p>
      </div>
    );
  }

  if (status === 'locked-convo') {
    return (
      <div style={lockStyles.wrapper}>
        <p style={lockStyles.icon}>💬</p>
        <p style={lockStyles.msg}>Complete a 5-minute conversation first.</p>
        <p style={lockStyles.sub}>It's the weekend — earn it. Redirecting...</p>
      </div>
    );
  }

  return <FlappyGame />;
}

const lockStyles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#0f0f13',
    gap: '0.5rem',
  },
  icon: { fontSize: '2.5rem', margin: 0 },
  msg: { color: '#fff', fontSize: '1.1rem', fontWeight: 600, margin: 0 },
  sub: { color: '#555', fontSize: '0.85rem', margin: 0 },
};

// ── Flappy Bird game ───────────────────────────────────────────

function FlappyGame() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [uiState, setUiState] = useState('idle'); // idle | playing | dead
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => {
    try { return parseInt(localStorage.getItem('flappy-best') || '0', 10); } catch { return 0; }
  });

  // ── Flap / reset actions ─────────────────────────────────────

  const flap = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    if (g.state === 'idle') {
      g.state = 'playing';
      setUiState('playing');
    }
    if (g.state === 'playing') {
      g.birdVy = FLAP_FORCE;
    }
  }, []);

  const reset = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    g.birdY = g.H / 2;
    g.birdVy = 0;
    g.pipes = [];
    g.frame = 0;
    g.score = 0;
    g.state = 'idle';
    g.deathHandled = false;
    setScore(0);
    setUiState('idle');
  }, []);

  // ── Canvas game loop ─────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const W = (canvas.width = Math.min(390, window.innerWidth - 32));
    const H = (canvas.height = 520);
    const GROUND_Y = H - 36;

    const g = {
      canvas, ctx, W, H,
      state: 'idle',
      birdY: H / 2,
      birdVy: 0,
      pipes: [],
      frame: 0,
      score: 0,
      deathHandled: false,
    };
    gameRef.current = g;

    // ── Draw helpers ─────────────────────────────────────────
    function drawBg() {
      // Sky gradient
      const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
      sky.addColorStop(0, '#0a0a12');
      sky.addColorStop(1, '#0f1a2e');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, GROUND_Y);

      // Ground
      ctx.fillStyle = '#1a1a24';
      ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(0, GROUND_Y, W, 3);
    }

    function drawBird(y, vy) {
      const tilt = Math.max(-0.4, Math.min(0.8, vy * 0.055));
      ctx.save();
      ctx.translate(BIRD_X, y);
      ctx.rotate(tilt);

      // Body
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
      ctx.fill();

      // Wing (lower half)
      ctx.fillStyle = '#e6b800';
      ctx.beginPath();
      ctx.ellipse(0, BIRD_R * 0.3, BIRD_R * 0.7, BIRD_R * 0.45, 0.2, 0, Math.PI);
      ctx.fill();

      // Eye white
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(BIRD_R * 0.4, -BIRD_R * 0.25, BIRD_R * 0.38, 0, Math.PI * 2);
      ctx.fill();

      // Pupil
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(BIRD_R * 0.52, -BIRD_R * 0.22, BIRD_R * 0.18, 0, Math.PI * 2);
      ctx.fill();

      // Beak
      ctx.fillStyle = '#FF8C00';
      ctx.beginPath();
      ctx.moveTo(BIRD_R * 0.7, -BIRD_R * 0.1);
      ctx.lineTo(BIRD_R * 1.5, BIRD_R * 0.05);
      ctx.lineTo(BIRD_R * 0.7, BIRD_R * 0.25);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    function drawPipe(pipe) {
      const capH = 22;
      const capOver = PIPE_CAP_OVER;

      // ── Top pipe ──
      // Shaft
      const topGrad = ctx.createLinearGradient(pipe.x, 0, pipe.x + PIPE_WIDTH, 0);
      topGrad.addColorStop(0, '#16a34a');
      topGrad.addColorStop(0.4, '#22c55e');
      topGrad.addColorStop(1, '#15803d');
      ctx.fillStyle = topGrad;
      ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.topH - capH);

      // Cap
      ctx.fillStyle = '#16a34a';
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(pipe.x - capOver, pipe.topH - capH, PIPE_WIDTH + capOver * 2, capH, 5);
        ctx.fill();
      } else {
        ctx.fillRect(pipe.x - capOver, pipe.topH - capH, PIPE_WIDTH + capOver * 2, capH);
      }

      // ── Bottom pipe ──
      const botY = pipe.topH + PIPE_GAP;
      const botGrad = ctx.createLinearGradient(pipe.x, 0, pipe.x + PIPE_WIDTH, 0);
      botGrad.addColorStop(0, '#16a34a');
      botGrad.addColorStop(0.4, '#22c55e');
      botGrad.addColorStop(1, '#15803d');
      ctx.fillStyle = botGrad;
      ctx.fillRect(pipe.x, botY + capH, PIPE_WIDTH, GROUND_Y - botY - capH);

      // Cap
      ctx.fillStyle = '#16a34a';
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(pipe.x - capOver, botY, PIPE_WIDTH + capOver * 2, capH, 5);
        ctx.fill();
      } else {
        ctx.fillRect(pipe.x - capOver, botY, PIPE_WIDTH + capOver * 2, capH);
      }
    }

    const PIPE_CAP_OVER = 5;

    function hitsPipe(pipe) {
      const bx = BIRD_X, by = g.birdY, br = BIRD_R - 2;
      const left = pipe.x - PIPE_CAP_OVER;
      const right = pipe.x + PIPE_WIDTH + PIPE_CAP_OVER;
      if (bx + br < left || bx - br > right) return false;
      return by - br < pipe.topH || by + br > pipe.topH + PIPE_GAP;
    }

    function handleDeath() {
      if (g.deathHandled) return;
      g.deathHandled = true;
      g.state = 'dead';
      const newBest = Math.max(g.score, parseInt(localStorage.getItem('flappy-best') || '0', 10));
      try { localStorage.setItem('flappy-best', String(newBest)); } catch {}
      setUiState('dead');
      setScore(g.score);
      setBest(newBest);
    }

    // ── Main loop ────────────────────────────────────────────
    let animId;

    function loop() {
      drawBg();

      if (g.state === 'idle') {
        drawBird(g.birdY, 0);

        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(W / 2 - 120, g.birdY + 40, 240, 36, 8);
          ctx.fill();
        }
        ctx.fillStyle = '#aaa';
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Tap or press Space to start', W / 2, g.birdY + 63);
      }

      if (g.state === 'playing') {
        g.frame++;

        // Physics
        g.birdVy += GRAVITY;
        g.birdY += g.birdVy;

        // Spawn pipes
        if (g.frame % PIPE_INTERVAL === 0) {
          const minTop = 55;
          const maxTop = GROUND_Y - PIPE_GAP - 55;
          const topH = Math.floor(Math.random() * (maxTop - minTop + 1)) + minTop;
          g.pipes.push({ x: W + 10, topH, scored: false });
        }

        // Draw & move pipes, check collisions, score
        for (const pipe of g.pipes) {
          pipe.x -= PIPE_SPEED;
          drawPipe(pipe);

          // Score point
          if (!pipe.scored && pipe.x + PIPE_WIDTH < BIRD_X - BIRD_R) {
            pipe.scored = true;
            g.score++;
            setScore(g.score);
          }

          // Collision
          if (hitsPipe(pipe)) { handleDeath(); break; }
        }

        // Remove off-screen pipes
        g.pipes = g.pipes.filter((p) => p.x + PIPE_WIDTH + 10 > 0);

        // Ground / ceiling
        if (g.birdY + BIRD_R >= GROUND_Y || g.birdY - BIRD_R <= 0) {
          handleDeath();
        }

        if (g.state === 'playing') {
          drawBird(g.birdY, g.birdVy);
          // Score
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          ctx.beginPath();
          ctx.arc(W / 2, 42, 26, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 22px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(g.score, W / 2, 50);
        }
      }

      if (g.state === 'dead') {
        // Draw frozen pipes
        for (const pipe of g.pipes) drawPipe(pipe);
        drawBird(g.birdY, g.birdVy);

        // Dim overlay
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(0, 0, W, H);

        // Panel
        const panelW = 240, panelH = 160;
        const px = (W - panelW) / 2, py = (H - panelH) / 2 - 20;
        ctx.fillStyle = '#1a1a24';
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(px, py, panelW, panelH, 14);
          ctx.fill();
        } else {
          ctx.fillRect(px, py, panelW, panelH);
        }

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 26px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Game Over', W / 2, py + 42);

        ctx.font = '16px system-ui, sans-serif';
        ctx.fillStyle = '#aaa';
        ctx.fillText(`Score: ${g.score}`, W / 2, py + 76);

        const savedBest = parseInt(localStorage.getItem('flappy-best') || '0', 10);
        ctx.fillStyle = '#FFD700';
        ctx.fillText(`Best: ${savedBest}`, W / 2, py + 102);

        ctx.fillStyle = '#666';
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillText('Tap or Space to play again', W / 2, py + 138);
      }

      animId = requestAnimationFrame(loop);
    }

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // ── Input handling ───────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e) => {
      if (e.code !== 'Space' && e.code !== 'ArrowUp') return;
      e.preventDefault();
      const g = gameRef.current;
      if (!g) return;
      g.state === 'dead' ? reset() : flap();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [flap, reset]);

  const handleTap = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    g.state === 'dead' ? reset() : flap();
  }, [flap, reset]);

  // ── Render ───────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#0f0f13',
      padding: '1rem',
      gap: '0.75rem',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        maxWidth: 390,
        gap: '0.5rem',
      }}>
        <a href="/" style={{ color: '#555', fontSize: '0.85rem', textDecoration: 'none', flexShrink: 0 }}>
          ← Back
        </a>
        <span style={{ flex: 1, textAlign: 'center', fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
          You earned this 🐦
        </span>
        <span style={{ color: '#FFD700', fontSize: '0.85rem', fontWeight: 600, flexShrink: 0, minWidth: '4rem', textAlign: 'right' }}>
          Best: {best}
        </span>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        onClick={handleTap}
        onTouchStart={(e) => { e.preventDefault(); handleTap(); }}
        style={{
          borderRadius: 14,
          touchAction: 'none',
          cursor: 'pointer',
          display: 'block',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      />

      {/* Hint */}
      <p style={{ color: '#333', fontSize: '0.72rem', textAlign: 'center', margin: 0 }}>
        {uiState === 'playing' ? `Score: ${score}` : 'tap · space · arrow up to flap'}
      </p>
    </div>
  );
}
