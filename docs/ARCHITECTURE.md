# Architecture Documentation

## 🏗️ System Overview

The French Speech Flashcards app is a **single-page React application** that combines speech recognition with spaced repetition algorithms to create an immersive language learning experience.

## 📊 Architecture Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   User Interface │◄──►│   State Manager  │◄──►│  Local Storage  │
│   (React JSX)    │    │   (App.jsx)      │    │ (Progress Data) │
└─────────┬───────┘    └─────────┬────────┘    └─────────────────┘
          │                      │
          ▼                      ▼
┌─────────────────┐    ┌──────────────────┐
│ Speech Engine   │    │   SRS Engine     │
│ (audio-manager) │    │    (srs.js)      │
└─────────┬───────┘    └─────────┬────────┘
          │                      │
          ▼                      ▼
┌─────────────────┐    ┌──────────────────┐
│ Web Speech API  │    │   Flashcards     │
│   (Browser)     │    │  (cards.json)    │
└─────────────────┘    └──────────────────┘
```

## 🧩 Core Components

### 1. App.jsx - Main Application Controller
**Responsibilities:**
- Global state management (React hooks)
- SRS scheduling and card selection
- Session management and progress tracking
- Component orchestration

**Key State:**
```javascript
const [currentCard, setCurrentCard] = useState(null)
const [session, setSession] = useState({ cardsStudied: 0, startTime: Date.now() })
const [srsData, setSrsData] = useState(loadFromLocalStorage())
```

### 2. ConversationView.jsx - Speech Interface
**Responsibilities:**
- Speech recognition UI and feedback
- Real-time transcription display
- User interaction handling (Again/Hard/Good/Easy)
- Audio visual feedback

**Key Features:**
- Continuous speech recognition
- Confidence threshold handling
- Error recovery and retry logic

### 3. audio-manager.js - Speech Recognition Wrapper
**Responsibilities:**
- Web Speech API abstraction
- Language and dialect configuration
- Error handling and fallbacks
- Recognition state management

**API:**
```javascript
class AudioManager {
  startRecognition(callback)
  stopRecognition()
  isSupported()
  getConfidence()
}
```

### 4. srs.js - Spaced Repetition Algorithm
**Responsibilities:**
- SM-2 algorithm implementation
- Card scheduling calculations
- Ease factor management
- Interval progression

**Core Algorithm:**
```javascript
function calculateNextReview(card, quality) {
  if (quality < 3) {
    card.interval = 1
    card.repetition = 0
  } else {
    card.repetition++
    if (card.repetition === 1) {
      card.interval = 1
    } else if (card.repetition === 2) {
      card.interval = 6
    } else {
      card.interval = Math.round(card.interval * card.easeFactor)
    }
  }
  
  card.easeFactor = Math.max(1.3, 
    card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  )
  
  return card
}
```

### 5. session-analytics.js - Progress Tracking
**Responsibilities:**
- Session statistics calculation
- Performance metrics
- Progress visualization data
- Export/import functionality

## 📁 Data Flow

### 1. Application Initialization
```
1. Load localStorage data → srsData state
2. Select next card using SRS algorithm
3. Initialize speech recognition
4. Render ConversationView with current card
```

### 2. Learning Session Flow
```
User speaks → Speech API → audio-manager → ConversationView
                ↓
            Recognition result
                ↓
            Compare with accepted answers
                ↓
            Show result (correct/incorrect)
                ↓
            User rates difficulty (Again/Hard/Good/Easy)
                ↓
            Update SRS data → localStorage
                ↓
            Select next card → Repeat
```

### 3. Data Persistence
```
SRS Data → localStorage → JSON.stringify()
Progress Data → localStorage → JSON.stringify()
Settings → localStorage → JSON.stringify()
```

## 🗂️ Data Structures

### Flashcard Format
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

### SRS Data Format
```json
{
  "mot": {
    "interval": 3,
    "repetition": 2,
    "easeFactor": 2.5,
    "nextReview": 1640995200000,
    "lastReview": 1640908800000,
    "history": [
      { "date": 1640908800000, "quality": 3 }
    ]
  }
}
```

### Session Data Format
```json
{
  "cardsStudied": 15,
  "startTime": 1640995200000,
  "endTime": 1640998800000,
  "correctAnswers": 12,
  "totalAnswers": 15
}
```

## 🔧 Technical Decisions

### 1. Web Speech API Choice
**Pros:**
- Native browser support
- No external dependencies
- Real-time recognition
- Free to use

**Cons:**
- Limited language support
- Requires HTTPS
- Variable accuracy
- Chrome/Edge best support

### 2. SM-2 Algorithm
**Why SM-2:**
- Proven effectiveness (Anki uses it)
- Simple implementation
- Well-documented
- Good balance of simplicity and power

### 3. Local Storage Strategy
**Benefits:**
- Offline functionality
- Fast access
- No server costs
- Privacy-focused

**Limitations:**
- Storage size limits (~5MB)
- No cross-device sync
- Manual backup required

## 🔒 Security Considerations

### 1. Data Privacy
- All data stored locally
- No external API calls for recognition
- No user tracking or analytics
- Open source and auditable

### 2. Content Security
- HTTPS required for production
- No eval() or dynamic code execution
- Sanitized user inputs
- CSP headers recommended

## 🚀 Performance Optimizations

### 1. Speech Recognition
- Debounced recognition events
- Confidence threshold filtering
- Automatic restart on errors
- Memory leak prevention

### 2. React Rendering
- useMemo for expensive calculations
- useCallback for event handlers
- Minimal re-renders
- Efficient state updates

### 3. Storage Operations
- Debounced localStorage writes
- Batched updates
- Compression for large datasets
- Error handling for quota exceeded

## 🔮 Future Architecture Considerations

### 1. Multi-language Support
- Abstracted language modules
- Configurable speech recognition
- Language-specific SRS settings
- Localized UI components

### 2. Cloud Sync (Optional)
- Encrypted sync service
- Conflict resolution
- Offline-first design
- User-controlled data

### 3. Advanced Recognition
- Custom speech models
- Accent-specific training
- Confidence calibration
- Fallback recognition services

---

This architecture document serves as a guide for understanding the system design and making informed architectural decisions.
