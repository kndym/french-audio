/**
 * Anki-style SM-2 Spaced Repetition logic
 * Based on SuperMemo 2 and Anki's implementation
 */

const LEARNING_STEPS = [1, 10]; // minutes
const RELEARNING_STEPS = [10]; // minutes
const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;
const EASE_BONUS = 1.3;
const HARD_INTERVAL = 1.2;
const NEW_INTERVAL = 0.2;
const GRADUATING_INTERVAL = 1;
const EASY_GRADUATING_INTERVAL = 4;

export const STATE = { NEW: 'new', LEARNING: 'learning', REVIEW: 'review', RELEARNING: 'relearning' };

export function getCardState(progress, cardId) {
  return progress[cardId] || { state: STATE.NEW, ease: INITIAL_EASE, interval: 0, reps: 0, step: 0, nextReview: 0 };
}

export function getDueCards(cards, progress) {
  const now = Date.now();
  const due = [];
  for (const card of cards) {
    const p = getCardState(progress, card.id);
    if (p.state === STATE.NEW) {
      due.push({ ...card, progress: p, due: 0 });
    } else if (p.state === STATE.LEARNING || p.state === STATE.RELEARNING) {
      if (p.nextReview <= now) due.push({ ...card, progress: p, due: p.nextReview });
    } else if (p.state === STATE.REVIEW && p.nextReview <= now) {
      due.push({ ...card, progress: p, due: p.nextReview });
    }
  }
  return due.sort((a, b) => a.due - b.due);
}

export function processReview(progress, cardId, rating, learningSteps = LEARNING_STEPS, relearningSteps = RELEARNING_STEPS) {
  const p = { ...getCardState(progress, cardId) };
  const steps = p.state === STATE.RELEARNING ? relearningSteps : learningSteps;

  if (p.state === STATE.NEW || p.state === STATE.LEARNING || p.state === STATE.RELEARNING) {
    if (rating === 'again') {
      p.state = STATE.LEARNING;
      p.step = 0;
      p.nextReview = Date.now() + steps[0] * 60 * 1000;
    } else if (rating === 'hard') {
      p.state = STATE.LEARNING;
      const idx = Math.min(p.step, steps.length - 1);
      const mins = steps[idx] > 0 ? steps[idx] : 1;
      p.nextReview = Date.now() + mins * 60 * 1000;
    } else if (rating === 'good') {
      p.step++;
      if (p.step >= steps.length) {
        p.state = STATE.REVIEW;
        p.interval = GRADUATING_INTERVAL;
        p.reps = 1;
        p.nextReview = Date.now() + GRADUATING_INTERVAL * 24 * 60 * 60 * 1000;
      } else {
        p.state = STATE.LEARNING;
        p.nextReview = Date.now() + steps[p.step] * 60 * 1000;
      }
    } else if (rating === 'easy') {
      p.state = STATE.REVIEW;
      p.interval = EASY_GRADUATING_INTERVAL;
      p.reps = 1;
      p.nextReview = Date.now() + EASY_GRADUATING_INTERVAL * 24 * 60 * 60 * 1000;
    }
  } else {
    // REVIEW state
    if (rating === 'again') {
      p.state = STATE.RELEARNING;
      p.step = 0;
      p.ease = Math.max(MIN_EASE, p.ease - 0.2);
      p.interval = Math.max(0.2, p.interval * NEW_INTERVAL);
      p.nextReview = Date.now() + relearningSteps[0] * 60 * 1000;
    } else if (rating === 'hard') {
      p.ease = Math.max(MIN_EASE, p.ease - 0.15);
      p.interval = Math.max(1, p.interval * HARD_INTERVAL);
      p.nextReview = Date.now() + p.interval * 24 * 60 * 60 * 1000;
    } else if (rating === 'good') {
      p.interval = Math.max(p.interval + 1, p.interval * p.ease);
      p.reps++;
      p.nextReview = Date.now() + p.interval * 24 * 60 * 60 * 1000;
    } else if (rating === 'easy') {
      p.ease = p.ease + 0.15;
      p.interval = Math.max(p.interval + 1, p.interval * p.ease * EASE_BONUS);
      p.reps++;
      p.nextReview = Date.now() + p.interval * 24 * 60 * 60 * 1000;
    }
  }

  return { ...progress, [cardId]: p };
}
