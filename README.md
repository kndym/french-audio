# French Speech Flashcards

> A mobile-first web app for learning French vocabulary through forced speech recognition. Speak French to advance - no skipping allowed!

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/React-18.2.0-blue.svg)
![Vite](https://img.shields.io/badge/Vite-5.0.0-orange.svg)

## 🎯 What This Is

A **speech-powered French learning app** that uses spaced repetition (SRS) to teach the top 100 most frequent French words. Unlike traditional flashcard apps, this one **forces you to speak** - you can only advance by correctly pronouncing French words and phrases.

### Key Features

- **🗣️ Speech-to-text required** – Must speak French to advance (no skip button)
- **📊 Frequency-ranked vocabulary** – Top 100 words from Lexique.org's 10,000-word corpus
- **🔄 Anki-style SRS** – Again/Hard/Good/Easy with proper SM-2 spacing algorithm
- **📱 Mobile-first design** – Works perfectly on iOS and Android browsers
- **💾 Offline-ready** – Progress stored in localStorage, works without internet
- **🎯 Fill-in-the-blank prompts** – Contextual sentences with natural French usage

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- npm or yarn

### Local Development
```bash
# Clone and setup
git clone https://github.com/your-username/french-audio.git
cd french-audio
npm install

# Generate flashcard deck (required first time)
npm run build-deck   # Converts words.csv → public/cards.json

# Start development server
npm run dev          # Opens http://localhost:5173
```

### One-Click Deploy
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/french-audio)

## 🏗️ Project Structure

```
french-audio/
├── src/
│   ├── App.jsx              # Main app component and SRS logic
│   ├── ConversationView.jsx # Speech recognition & UI
│   ├── audio-manager.js     # Web Speech API wrapper
│   ├── srs.js              # Spaced repetition algorithm
│   └── session-analytics.js # Progress tracking
├── scripts/
│   └── build-deck.js       # CSV → JSON flashcard generator
├── public/
│   └── cards.json          # Generated flashcard data
├── words.csv               # Raw Lexique.org data (10k+ words)
└── vercel.json            # Deployment configuration
```

## 📚 How It Works

### 1. **Speech Recognition**
- Uses Web Speech API for real-time French speech recognition
- Requires user to speak the correct French word/phrase
- No typing or multiple choice - speaking is mandatory

### 2. **Spaced Repetition**
- Implements SM-2 algorithm (same as Anki)
- Cards scheduled based on difficulty ratings
- Progress saved automatically in localStorage

### 3. **Content Generation**
- Source: Lexique.org French frequency corpus
- Top 100 lemmas with contextual fill-in-the-blank sentences
- Each word has 2-4 natural French prompts with hints
- Automatically generated accepted answers for variations

## 🛠️ For Forkers & Contributors

### Customizing the Word List

1. **Edit the source data:**
   ```bash
   # words.csv contains Lexique.org frequency data
   # Modify or replace with your own word list
   ```

2. **Regenerate flashcards:**
   ```bash
   npm run build-deck
   # This reads words.csv and creates public/cards.json
   ```

3. **Card format:**
   ```json
   {
     "mot": [
       {
         "sentence": "Je ___ parler français.",
         "hint": "to want",
         "acceptedAnswers": ["veux", "veut", "voulons", "voulez", "veulent"]
       }
     ]
   }
   ```

### Key Files to Modify

| File | Purpose | What to Change |
|------|---------|----------------|
| `words.csv` | Word source data | Add/remove words, change frequency |
| `scripts/build-deck.js` | Card generation logic | Modify prompt generation rules |
| `src/srs.js` | Spaced repetition | Adjust algorithm parameters |
| `src/audio-manager.js` | Speech recognition | Add languages, modify confidence thresholds |

### Deployment Options

#### Vercel (Recommended)
```bash
# Connect to GitHub repo
# Auto-detects build settings from vercel.json
# Build: npm run build-deck && npm run build
# Output: dist/
```

#### Other Platforms
- **Netlify**: Set build command to `npm run build-deck && npm run build`
- **GitHub Pages**: Use `gh-pages` branch with `dist` as root
- **Self-hosted**: Build and serve `dist/` directory

## 🎨 Customization Guide

### Adding New Languages
1. Update `src/audio-manager.js` with new language codes
2. Replace `words.csv` with target language frequency data
3. Modify `scripts/build-deck.js` for new language grammar rules
4. Update UI text in `src/App.jsx`

### Changing SRS Settings
Edit `src/srs.js`:
```javascript
// Modify these values for different spacing
const EASE_BONUS = 1.3;     // Ease increase for "Good"
const HARD_INTERVAL = 1.2;   // Interval multiplier for "Hard"
const MIN_INTERVAL = 1;      // Minimum wait time (days)
```

### Styling & Theme
- Main styles in `src/index.css`
- Component-specific styles inline in JSX files
- Uses CSS custom properties for easy theming

## 🐛 Troubleshooting

### Common Issues

**Speech recognition not working:**
- Requires HTTPS in production
- Chrome/Edge work best
- Mobile browsers may need permission prompts

**Build fails:**
- Run `npm run build-deck` first to generate `cards.json`
- Ensure `words.csv` exists in project root

**Deployment issues:**
- Check `vercel.json` build settings
- Verify `public/cards.json` is generated before build

## 📄 License

MIT License - feel free to fork, modify, and redistribute!

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly (especially speech recognition)
5. Submit a pull request

### Areas for Improvement
- [ ] Add more languages beyond French
- [ ] Implement image-based prompts
- [ ] Add progress analytics dashboard
- [ ] Support custom word lists
- [ ] Add audio pronunciation examples

## 📞 Support

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- For quick questions, use GitHub Discussions

---

**Built with ❤️ for French learners everywhere**
