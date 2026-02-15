# Contributing to French Speech Flashcards

Thank you for your interest in contributing! This guide will help you get started with contributing to this French learning application.

## 🎯 Project Overview

This is a **speech-first French learning app** that forces users to speak French words and phrases. The core principle is "no skipping" - users must correctly pronounce the French to advance through flashcards.

### Key Technologies
- **React 18** - Frontend framework
- **Vite** - Build tool and dev server
- **Web Speech API** - Browser-based speech recognition
- **SM-2 Algorithm** - Spaced repetition scheduling
- **Lexique.org** - French frequency corpus data

## 🚀 Getting Started

### Prerequisites
- Node.js 16+
- Modern browser (Chrome/Edge recommended for speech recognition)
- Git

### Setup Steps
```bash
# 1. Fork and clone your fork
git clone https://github.com/YOUR-USERNAME/french-audio.git
cd french-audio

# 2. Install dependencies
npm install

# 3. Generate the flashcard deck (crucial first step)
npm run build-deck

# 4. Start development
npm run dev
```

### Understanding the Build Process
The app has a **two-step build process**:
1. `npm run build-deck` - Converts `words.csv` → `public/cards.json`
2. `npm run build` - Builds the React app

**Always run `build-deck` after modifying `words.csv`!**

## 📁 Project Structure Deep Dive

### Core Application Files
```
src/
├── App.jsx                  # Main app, SRS logic, state management
├── ConversationView.jsx     # Speech recognition UI and handling
├── audio-manager.js         # Web Speech API wrapper
├── srs.js                  # SM-2 spaced repetition algorithm
├── session-analytics.js     # Progress tracking and analytics
└── crypto.js               # Encryption utilities (if needed)
```

### Data & Build Files
```
scripts/
└── build-deck.js           # CSV → JSON conversion logic

public/
└── cards.json              # Generated flashcard data (don't edit manually)

words.csv                   # Raw Lexique.org frequency data
```

## 🛠️ Common Contribution Areas

### 1. Adding New Words/Phrases

**File to modify:** `words.csv`

The CSV format from Lexique.org:
```csv
frequency,lemme,grammatical_category,phonetic,...
1000,être,verb,etR,...
```

**After editing:**
```bash
npm run build-deck  # Regenerate cards.json
```

### 2. Improving Speech Recognition

**File to modify:** `src/audio-manager.js`

Key areas:
- Language settings (`lang: 'fr-FR'`)
- Confidence thresholds
- Error handling
- Alternative recognition engines

### 3. Tweaking SRS Algorithm

**File to modify:** `src/srs.js`

Key parameters:
```javascript
const EASE_BONUS = 1.3;      // "Good" rating ease increase
const HARD_INTERVAL = 1.2;    // "Hard" rating interval multiplier
const MIN_INTERVAL = 1;       // Minimum wait time (days)
const EASE_THRESHOLD = 2.5;   // Minimum ease factor
```

### 4. UI/UX Improvements

**Files to modify:** `src/App.jsx`, `src/ConversationView.jsx`

Key components:
- Flashcard display
- Speech recognition interface
- Progress indicators
- Mobile responsiveness

### 5. Content Generation Logic

**File to modify:** `scripts/build-deck.js`

This handles:
- Converting CSV data to flashcard format
- Generating contextual sentences
- Creating accepted answer variations
- Grammar-specific prompts (verbs, nouns, adjectives)

## 🧪 Testing Your Changes

### Local Testing
1. **Speech Recognition Testing:**
   - Test in Chrome/Edge (best Web Speech API support)
   - Test on mobile devices
   - Test with different accents

2. **SRS Testing:**
   - Test all difficulty ratings (Again/Hard/Good/Easy)
   - Verify card scheduling works correctly
   - Check localStorage persistence

3. **Build Testing:**
   ```bash
   npm run build-deck && npm run build
   # Verify the build works and cards.json is included
   ```

### Before Submitting
- [ ] Test speech recognition on multiple devices
- [ ] Verify build process works end-to-end
- [ ] Check mobile responsiveness
- [ ] Test localStorage persistence
- [ ] Run `npm run build-deck` after any CSV changes

## 📝 Development Guidelines

### Code Style
- Use modern JavaScript (ES6+)
- Follow React hooks best practices
- Keep components focused and single-purpose
- Use descriptive variable names

### Speech Recognition Specifics
- Always handle speech recognition errors gracefully
- Provide clear feedback for recognition status
- Consider network connectivity issues
- Test with various microphone qualities

### SRS Best Practices
- Preserve user progress (don't break localStorage format)
- Test edge cases (very high/low ease factors)
- Consider timezone handling for scheduling

## 🐛 Bug Reports

When reporting bugs, please include:
1. **Browser and version**
2. **Device type** (desktop/mobile)
3. **Steps to reproduce**
4. **Expected vs actual behavior**
5. **Console errors** (if any)
6. **Speech recognition results** (what was said vs what was recognized)

## 💡 Feature Ideas

### High Priority
- [ ] Add more languages (Spanish, German, etc.)
- [ ] Implement custom word lists
- [ ] Add progress analytics dashboard
- [ ] Support for image-based prompts

### Medium Priority
- [ ] Audio pronunciation examples
- [ ] Offline speech recognition
- [ ] Voice gender selection
- [ ] Accent-specific recognition models

### Low Priority
- [ ] Gamification elements
- [ ] Social features
- [ ] Teacher dashboard
- [ ] API for external integrations

## 🔄 Pull Request Process

1. **Fork** the repository
2. **Create a feature branch:** `git checkout -b feature/amazing-feature`
3. **Make your changes** and test thoroughly
4. **Commit** with descriptive messages
5. **Push** to your fork
6. **Create a Pull Request** with:
   - Clear description of changes
   - Testing instructions
   - Any breaking changes noted

### PR Template
```markdown
## Description
Brief description of what this PR does.

## Testing
How to test these changes.

## Breaking Changes
Any breaking changes? (if yes, describe)

## Screenshots
If applicable, include screenshots.
```

## 🤝 Getting Help

- **GitHub Issues:** For bugs and feature requests
- **GitHub Discussions:** For questions and ideas
- **Code Review:** Request reviews from maintainers

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to French language education! 🇫🇷**
