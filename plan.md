# French Speech-to-Text Flashcard App - Cursor Prompt

Build a mobile-friendly web app for learning French vocabulary through forced speech recognition.

## Core Concept
- Anki-like flashcard system that REQUIRES speech-to-text to answer
- Focus on lemmas/infinitives with multiple contextual English prompts per word
- No way to advance without speaking - forces production over recognition

## Technical Stack
- Single-file React artifact (.jsx)
- Web Speech API for browser speech recognition
- Local storage for card data and progress
- Mobile-first responsive design
- Works on iOS/Android browsers

## Data Structure

### Word Card Format
```javascript
{
  french: "manger",
  rank: 15, // frequency rank
  prompts: [
    "I want to eat",
    "We need to eat something", 
    "Do you want to eat?",
    "They're going to eat",
    "I like to eat"
  ],
  acceptedAnswers: ["manger", "mange", "mangé", "mangeons", "mangent", "manges"] // any conjugation OK
}
```

### Dataset
- Use top 1000 French lemmas by spoken frequency
- 3-5 natural English situational prompts per lemma
- Prompts should be complete phrases/sentences that would naturally contain that word
- Accept any conjugation of the correct verb stem (we're learning vocabulary, not grammar)

## UI/UX Requirements

### Card Display
- Clean, minimal design
- Large, readable text (mobile-friendly)
- Shows: English prompt prominently
- Buttons: "Record Answer" (big, primary) 

### Recording Flow
1. User taps "Record Answer"
2. Button changes to "Recording..." (maybe with visual feedback)
3. User speaks French translation
4. App shows: "You said: [transcribed text]"
5. App shows: "Correct answer: [accepted French answers]"
6. User marks: "Got it ✓" or "Missed ✗" (swipe or buttons)
7. Next card appears

### Progress Tracking
- Simple stats: cards reviewed today, accuracy %
- Mark cards as "learning" vs "known"
- Basic spaced repetition: wrong answers come back sooner
- Store progress in localStorage

## Speech Recognition

### Implementation
- Use Web Speech API (`webkitSpeechRecognition` or `SpeechRecognition`)
- Set language to 'fr-FR'
- Show clear error message if speech API unavailable
- Handle permissions gracefully

### Answer Matching
- Normalize both spoken and correct answers (lowercase, remove accents for comparison)
- Accept any form that contains the correct lemma/stem
- Show what user said vs what was expected
- Don't auto-judge - let user decide if close enough (they're learning)

## Features to Include

### Must Have
- Card deck with ~100 starter words from top French lemmas
- Speech-to-text recording
- Manual right/wrong marking
- Progress persistence (localStorage)
- Mobile responsive layout
- "Add custom card" functionality (text input for advanced users)

### Nice to Have
- Settings: toggle between strict matching vs. lenient
- Filter by: "new cards", "review cards", "known cards"
- Daily goal tracking
- Export/import card deck (JSON)
- Dark mode

## UI Layout Suggestions
```
┌─────────────────────────┐
│  Progress: 23/100       │
│  Streak: 5 days        │
├─────────────────────────┤
│                         │
│   English Prompt:       │
│                         │
│   "I want to eat"       │
│                         │
│   [🎤 Record Answer]    │
│                         │
├─────────────────────────┤
│  After recording:       │
│                         │
│  You said: "je mange"   │
│  Accepted: manger,      │
│            mange, ...   │
│                         │
│  [✓ Got it] [✗ Missed] │
└─────────────────────────┘
```

## Starter Dataset
Include 100-200 most common French verbs/words with prompts like:
- être → "I am tired", "You are French", "We are here"
- avoir → "I have a dog", "She has time", "Do you have a pen?"
- aller → "I'm going home", "We're going to leave", "Where are you going?"
- faire → "I'm doing homework", "What are you doing?", "We're making dinner"
- vouloir → "I want coffee", "Do you want to come?", "They want to leave"

Focus on high-frequency verbs first, then common nouns/adjectives.

## Code Organization
- Keep it in a single .jsx file for easy deployment
- Use React hooks (useState, useEffect) for state management
- Clear component structure: App → Card → RecordButton → Results
- Comment the speech recognition setup clearly

## Deployment Notes
- Should work when saved as single HTML file with inline React
- No build step required
- Can be hosted on GitHub Pages, Netlify Drop, or Vercel
- Include service worker for offline capability (optional but nice)

## Key Behaviors
- NEVER let user advance without speaking (no "skip" button)
- Don't auto-judge answers - user decides if close enough
- Prioritize speed and simplicity over fancy features
- Make recording button VERY obvious and easy to tap on mobile

## Acceptance Criteria
- User can load page on phone browser
- User can record French speech and see transcription
- User can mark answers and progress through deck
- Progress persists across sessions
- Works without internet after first load (for speech processing, internet needed)

Build this as a single, polished React component that solves the specific problem: forcing speech production to build French vocabulary recall.