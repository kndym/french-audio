/**
 * Gemini 2.5 Flash text REST client for post-session conversation analysis.
 *
 * Makes a single API call after each conversation session to get
 * structured feedback on vocabulary gaps, grammar, and fluency.
 */

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const ANALYSIS_PROMPT = `You are a French language learning analyst. You will receive a transcript of a spoken French conversation between a B2-level learner (role: "user") and an AI conversation partner (role: "model").

Analyze the learner's performance and return a JSON object with EXACTLY this structure (no markdown, no code fences, just raw JSON):

{
  "fluencyRating": <1-5 integer>,
  "fluencyJustification": "<1-2 sentence explanation>",
  "struggledVocabulary": [
    { "word": "<French word>", "context": "<the sentence where they struggled>", "translation": "<English translation>" }
  ],
  "grammarPatterns": [
    { "pattern": "<error type, e.g. 'gender agreement'>", "example": "<example from transcript>", "correction": "<corrected version>" }
  ],
  "topicComplexity": "<basic|intermediate|advanced>",
  "suggestedFocusAreas": ["<area 1>", "<area 2>"],
  "vocabularyUsedWell": ["<word 1>", "<word 2>"],
  "encouragement": "<1 sentence of specific encouragement based on what went well>"
}

Rules:
- "struggledVocabulary" should include words the learner couldn't recall, used English for, or needed help with
- "grammarPatterns" should only include RECURRING patterns, not one-off slips
- "vocabularyUsedWell" should highlight B2+ vocabulary the learner used naturally
- Be encouraging but honest
- If the transcript is very short or unclear, still provide what analysis you can
- Return ONLY the JSON object, nothing else`;

/**
 * Analyze a conversation transcript using Gemini 2.5 Flash.
 *
 * @param {string} apiKey
 * @param {Array<{role: 'user'|'model', text: string}>} transcript
 * @returns {Promise<Object>} structured analysis
 */
export async function analyzeSession(apiKey, transcript) {
  // Format transcript for the prompt
  const formatted = transcript
    .map((t) => `[${t.role.toUpperCase()}]: ${t.text}`)
    .join('\n');

  const body = {
    contents: [
      {
        parts: [
          { text: ANALYSIS_PROMPT },
          { text: `\n\nHere is the conversation transcript:\n\n${formatted}` },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
    },
  };

  const res = await fetch(`${API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Parse JSON from response (strip code fences if model includes them)
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // If parsing fails, return a minimal structure with the raw text
    return {
      fluencyRating: 0,
      fluencyJustification: 'Analysis could not be parsed.',
      struggledVocabulary: [],
      grammarPatterns: [],
      topicComplexity: 'unknown',
      suggestedFocusAreas: [],
      vocabularyUsedWell: [],
      encouragement: '',
      _raw: text,
    };
  }
}
