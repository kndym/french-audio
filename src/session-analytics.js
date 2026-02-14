/**
 * Session analytics – compute metrics from conversation transcripts
 * and persist session history to localStorage.
 */

const SESSIONS_KEY = 'french-conversation-sessions';
const MAX_SESSIONS = 200; // keep last N sessions

// Patterns that indicate the AI helped with a word
const HELP_PATTERNS = [
  /en français on dit/i,
  /tu cherches le mot/i,
  /ça commence par/i,
  /c'est le mot/i,
  /on peut dire/i,
  /le mot que tu cherches/i,
  /tu veux dire/i,
  /un synonyme serait/i,
  /la première lettre est/i,
  /tu peux décrire/i,
];

// Common French stop words (excluded from vocab diversity calculation)
const STOP_WORDS = new Set([
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'au', 'aux',
  'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'que', 'qui',
  'ne', 'pas', 'plus', 'ce', 'ça', 'se', 'sa', 'son', 'ses',
  'est', 'a', 'ai', 'as', 'suis', 'es', 'sont', 'ont', 'avons', 'avez',
  'dans', 'sur', 'avec', 'pour', 'par', 'en', 'y',
  'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'notre', 'votre', 'leur', 'leurs',
  'à', 'très', 'bien', 'aussi', 'oui', 'non', 'si',
  'c', 'd', 'j', 'l', 'm', 'n', 's', 'qu',  // elision fragments
]);

/**
 * Tokenize French text into lowercase word tokens.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/['']/g, ' ')
    .replace(/[^\p{L}\s]/gu, '')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Detect English words in a French transcript.
 * Simple heuristic: common English words that are not French.
 */
const ENGLISH_MARKERS = new Set([
  'the', 'is', 'are', 'was', 'were', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'might', 'must',
  'shall', 'can', 'need', 'dare', 'ought', 'used',
  'what', 'which', 'who', 'whom', 'whose', 'where', 'when',
  'how', 'why', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  'because', 'like', 'just', 'really', 'actually', 'basically',
  'something', 'anything', 'nothing', 'everything',
  'about', 'after', 'before', 'between', 'through', 'during',
  'think', 'know', 'want', 'get', 'make', 'go', 'come', 'take', 'give',
  'thing', 'stuff', 'way', 'kind', 'sort',
]);

/**
 * Compute session metrics from transcript entries.
 *
 * @param {Array<{role: 'user'|'model', text: string, timestamp: number}>} transcript
 * @param {number} durationMs
 * @returns {Object} metrics
 */
export function computeMetrics(transcript, durationMs) {
  const userTurns = transcript.filter((t) => t.role === 'user');
  const modelTurns = transcript.filter((t) => t.role === 'model');

  // User text stats
  const allUserText = userTurns.map((t) => t.text).join(' ');
  const userWords = tokenize(allUserText);
  const contentWords = userWords.filter((w) => !STOP_WORDS.has(w));
  const uniqueContentWords = new Set(contentWords);

  // Count English fallbacks in user speech
  const englishFallbacks = userWords.filter((w) => ENGLISH_MARKERS.has(w));

  // Count help moments in model speech
  const allModelText = modelTurns.map((t) => t.text).join(' ');
  let helpMoments = 0;
  for (const pattern of HELP_PATTERNS) {
    const matches = allModelText.match(new RegExp(pattern.source, 'gi'));
    if (matches) helpMoments += matches.length;
  }

  // Average turn length
  const turnLengths = userTurns.map((t) => tokenize(t.text).length);
  const avgTurnLength = turnLengths.length > 0
    ? turnLengths.reduce((a, b) => a + b, 0) / turnLengths.length
    : 0;

  // Type-token ratio (vocabulary diversity)
  const typeTokenRatio = contentWords.length > 0
    ? uniqueContentWords.size / contentWords.length
    : 0;

  // Words per minute
  const minutes = durationMs / 60000;
  const wordsPerMinute = minutes > 0 ? userWords.length / minutes : 0;

  return {
    durationMs,
    durationMin: Math.round(minutes * 10) / 10,
    totalUserWords: userWords.length,
    uniqueContentWords: uniqueContentWords.size,
    typeTokenRatio: Math.round(typeTokenRatio * 100) / 100,
    helpMoments,
    englishFallbacks: englishFallbacks.length,
    avgTurnLength: Math.round(avgTurnLength * 10) / 10,
    wordsPerMinute: Math.round(wordsPerMinute * 10) / 10,
    userTurnCount: userTurns.length,
    modelTurnCount: modelTurns.length,
    uniqueWords: [...uniqueContentWords],
  };
}

/**
 * Save a session summary to localStorage.
 *
 * @param {Object} session
 * @param {string} session.id
 * @param {number} session.timestamp
 * @param {Object} session.metrics - from computeMetrics
 * @param {Object} [session.aiAnalysis] - from gemini-text.js
 * @param {Array}  session.transcript
 */
export function saveSession(session) {
  const sessions = getSessions();
  sessions.push(session);
  // Keep only the last N sessions
  if (sessions.length > MAX_SESSIONS) {
    sessions.splice(0, sessions.length - MAX_SESSIONS);
  }
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

/**
 * Update an existing session (e.g. to add AI analysis after the fact).
 * @param {string} sessionId
 * @param {Object} updates - fields to merge
 */
export function updateSession(sessionId, updates) {
  const sessions = getSessions();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], ...updates };
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }
}

/**
 * Get all saved sessions.
 * @returns {Array<Object>}
 */
export function getSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Compute aggregate trends across sessions.
 * @returns {Object} trend data
 */
export function computeTrends() {
  const sessions = getSessions();
  if (sessions.length === 0) return null;

  // Sessions in last 7 / 30 days
  const now = Date.now();
  const week = sessions.filter((s) => now - s.timestamp < 7 * 24 * 60 * 60 * 1000);
  const month = sessions.filter((s) => now - s.timestamp < 30 * 24 * 60 * 60 * 1000);

  // Helper to average a metric
  const avg = (arr, key) => {
    if (arr.length === 0) return 0;
    return arr.reduce((sum, s) => sum + (s.metrics?.[key] || 0), 0) / arr.length;
  };

  // Streak: consecutive days with at least one session
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let d = 0; d < 365; d++) {
    const dayStart = today.getTime() - d * 24 * 60 * 60 * 1000;
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const hasSession = sessions.some((s) => s.timestamp >= dayStart && s.timestamp < dayEnd);
    if (hasSession) streak++;
    else break;
  }

  // Compare last 5 sessions to the 5 before that for trend direction
  const recent5 = sessions.slice(-5);
  const prev5 = sessions.slice(-10, -5);

  const recentAvgHelp = avg(recent5, 'helpMoments');
  const prevAvgHelp = avg(prev5, 'helpMoments');
  const recentAvgDiversity = avg(recent5, 'typeTokenRatio');
  const prevAvgDiversity = avg(prev5, 'typeTokenRatio');
  const recentAvgWpm = avg(recent5, 'wordsPerMinute');
  const prevAvgWpm = avg(prev5, 'wordsPerMinute');

  return {
    totalSessions: sessions.length,
    sessionsThisWeek: week.length,
    sessionsThisMonth: month.length,
    streak,
    avgDurationMin: Math.round(avg(month, 'durationMin') * 10) / 10,
    avgHelpMoments: Math.round(recentAvgHelp * 10) / 10,
    helpTrend: prev5.length > 0 ? (recentAvgHelp < prevAvgHelp ? 'improving' : recentAvgHelp > prevAvgHelp ? 'declining' : 'stable') : 'new',
    avgDiversity: Math.round(recentAvgDiversity * 100) / 100,
    diversityTrend: prev5.length > 0 ? (recentAvgDiversity > prevAvgDiversity ? 'improving' : recentAvgDiversity < prevAvgDiversity ? 'declining' : 'stable') : 'new',
    avgWpm: Math.round(recentAvgWpm * 10) / 10,
    wpmTrend: prev5.length > 0 ? (recentAvgWpm > prevAvgWpm ? 'improving' : recentAvgWpm < prevAvgWpm ? 'declining' : 'stable') : 'new',
    recentSessions: sessions.slice(-10).reverse(),
  };
}
