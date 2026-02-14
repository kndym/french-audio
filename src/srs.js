/**
 * Auto-graded Spaced Repetition logic
 * Binary correct/incorrect + response time determines scheduling.
 * No manual self-grading.
 */

// Thresholds (ms) for speed classification
const FAST_MS = 5000;
const MEDIUM_MS = 10000;

// Scheduling intervals (days)
const KNOWN_FAST_INTERVAL = 7;       // correct + fast on first see → skip far ahead
const KNOWN_MEDIUM_INTERVAL = 3;     // correct + slow-ish
const KNOWN_SLOW_INTERVAL = 1;       // correct but very slow
const RELEARN_STEP_MINS = 10;        // incorrect → come back in 10 min
const RELEARN_GRADUATE_INTERVAL = 1; // after relearn step → 1 day

// Ease adjustments
const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;
const EASE_BONUS_FAST = 0.15;
const EASE_PENALTY_SLOW = -0.05;
const EASE_PENALTY_WRONG = -0.2;

export const STATE = { NEW: 'new', LEARNING: 'learning', REVIEW: 'review', RELEARNING: 'relearning' };
export const DEFAULT_MAX_NEW_PER_DAY = 50;

export function getCardState(progress, cardId) {
  return progress[cardId] || {
    state: STATE.NEW,
    ease: INITIAL_EASE,
    interval: 0,
    reps: 0,
    step: 0,
    nextReview: 0,
    attempts: 0,
    correctAttempts: 0,
    avgResponseMs: 0,
    knownOnSight: false,
  };
}

/** Get today's date key (YYYY-MM-DD) for daily tracking. */
export function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Classify a review result based on correctness and response time.
 * Returns 'know_fast', 'know_medium', 'know_slow', or 'miss'.
 */
export function classifyResult(correct, responseMs) {
  if (!correct) return 'miss';
  if (responseMs <= FAST_MS) return 'know_fast';
  if (responseMs <= MEDIUM_MS) return 'know_medium';
  return 'know_slow';
}

/**
 * Get cards that are due for review.
 */
export function getDueCards(cards, progress, dailyNewCount = null, maxNewPerDay = DEFAULT_MAX_NEW_PER_DAY) {
  const now = Date.now();
  const today = getTodayKey();
  const due = [];
  let newCardCount = 0;
  const newAlreadyToday = (dailyNewCount && dailyNewCount.date === today) ? dailyNewCount.count : 0;

  for (const card of cards) {
    const p = getCardState(progress, card.id);
    if (p.state === STATE.NEW) {
      if (newAlreadyToday + newCardCount < maxNewPerDay) {
        due.push({ ...card, progress: p, due: 0 });
        newCardCount++;
      }
    } else if (p.state === STATE.LEARNING || p.state === STATE.RELEARNING) {
      if (p.nextReview <= now) due.push({ ...card, progress: p, due: p.nextReview });
    } else if (p.state === STATE.REVIEW && p.nextReview <= now) {
      due.push({ ...card, progress: p, due: p.nextReview });
    }
  }
  return due.sort((a, b) => a.due - b.due);
}

/**
 * Process a review with auto-grading.
 * @param {Object} progress - All card progress
 * @param {string} cardId - Card being reviewed
 * @param {boolean} correct - Did the answer match?
 * @param {number} responseMs - Time from prompt shown to answer received
 * @returns {{ progress: Object, knownOnSight: boolean }} Updated progress + whether this was a known-on-sight card
 */
export function processReview(progress, cardId, correct, responseMs) {
  const p = { ...getCardState(progress, cardId) };
  const grade = classifyResult(correct, responseMs);
  const wasNew = p.state === STATE.NEW;
  let knownOnSight = false;

  // Update stats
  p.attempts = (p.attempts || 0) + 1;
  if (correct) p.correctAttempts = (p.correctAttempts || 0) + 1;
  // Exponential moving average for response time
  const alpha = 0.3;
  p.avgResponseMs = p.avgResponseMs ? p.avgResponseMs * (1 - alpha) + responseMs * alpha : responseMs;

  if (p.state === STATE.NEW || p.state === STATE.LEARNING || p.state === STATE.RELEARNING) {
    if (grade === 'miss') {
      // Incorrect: enter/stay in learning
      p.state = STATE.LEARNING;
      p.step = 0;
      p.nextReview = Date.now() + RELEARN_STEP_MINS * 60 * 1000;
    } else if (grade === 'know_fast') {
      // Fast correct: graduate immediately with long interval
      if (wasNew) {
        knownOnSight = true;
        p.knownOnSight = true;
      }
      p.state = STATE.REVIEW;
      p.interval = KNOWN_FAST_INTERVAL;
      p.ease = Math.min(3.0, p.ease + EASE_BONUS_FAST);
      p.reps = (p.reps || 0) + 1;
      p.nextReview = Date.now() + KNOWN_FAST_INTERVAL * 24 * 60 * 60 * 1000;
    } else if (grade === 'know_medium') {
      // Medium speed correct: graduate with moderate interval
      p.state = STATE.REVIEW;
      p.interval = KNOWN_MEDIUM_INTERVAL;
      p.reps = (p.reps || 0) + 1;
      p.nextReview = Date.now() + KNOWN_MEDIUM_INTERVAL * 24 * 60 * 60 * 1000;
    } else {
      // Slow correct: graduate with short interval
      p.state = STATE.REVIEW;
      p.interval = KNOWN_SLOW_INTERVAL;
      p.ease = Math.max(MIN_EASE, p.ease + EASE_PENALTY_SLOW);
      p.reps = (p.reps || 0) + 1;
      p.nextReview = Date.now() + KNOWN_SLOW_INTERVAL * 24 * 60 * 60 * 1000;
    }
  } else {
    // REVIEW state (graduated card coming back for review)
    if (grade === 'miss') {
      p.state = STATE.RELEARNING;
      p.step = 0;
      p.ease = Math.max(MIN_EASE, p.ease + EASE_PENALTY_WRONG);
      p.interval = Math.max(1, p.interval * 0.5);
      p.nextReview = Date.now() + RELEARN_STEP_MINS * 60 * 1000;
    } else if (grade === 'know_fast') {
      p.ease = Math.min(3.0, p.ease + EASE_BONUS_FAST);
      p.interval = Math.max(p.interval + 1, p.interval * p.ease);
      p.reps++;
      p.nextReview = Date.now() + p.interval * 24 * 60 * 60 * 1000;
    } else if (grade === 'know_medium') {
      p.interval = Math.max(p.interval + 1, p.interval * p.ease * 0.9);
      p.reps++;
      p.nextReview = Date.now() + p.interval * 24 * 60 * 60 * 1000;
    } else {
      // know_slow: correct but hesitant, schedule sooner
      p.ease = Math.max(MIN_EASE, p.ease + EASE_PENALTY_SLOW);
      p.interval = Math.max(p.interval + 1, p.interval * p.ease * 0.7);
      p.reps++;
      p.nextReview = Date.now() + p.interval * 24 * 60 * 60 * 1000;
    }
  }

  return { progress: { ...progress, [cardId]: p }, knownOnSight };
}
