# French Speech Flashcards

A mobile-friendly web app for learning French vocabulary through forced speech recognition. Uses the top 100 French words from Lexique.org with Anki-style SM-2 spaced repetition.

## Features

- **Speech-to-text required** – Must speak French to advance (no skip)
- **100 frequency-ranked words** – From Lexique.org top 10,000
- **Anki-style SRS** – Again / Hard / Good / Easy with proper spacing
- **Mobile-first** – Works on iOS and Android browsers
- **Offline-ready** – Progress stored in localStorage

## Local Development

```bash
npm install
npm run build-deck   # Generate cards.json from words.csv
npm run dev          # Start dev server at http://localhost:5173
```

## Deploy to Vercel

### Option 1: Deploy from GitHub (recommended)

1. Push this repo to GitHub.

2. Go to [vercel.com](https://vercel.com) and sign in with GitHub.

3. Click **Add New** → **Project**.

4. Import your `french-audio` repository.

5. Vercel will auto-detect the config. The `vercel.json` runs:
   - `npm run build-deck` (generates `cards.json` from `words.csv`)
   - `npm run build` (builds the React app)
   
   Output directory is `dist`.

6. Click **Deploy**. Your app will be live at `https://your-project.vercel.app`.

### Option 2: Deploy with Vercel CLI

1. Install the Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. From the project root:
   ```bash
   vercel
   ```

3. Follow the prompts (link to existing project or create new).

4. For production:
   ```bash
   vercel --prod
   ```

### Build behavior

- **Build command**: `npm run build-deck && npm run build`
- **Output directory**: `dist`
- `build-deck` reads `words.csv` and writes `public/cards.json`
- Vite copies `public/` into `dist/` during build

## Regenerating the card deck

To change the word list, edit `words.csv` and run:

```bash
npm run build-deck
```

This overwrites `public/cards.json` with the top 100 lemmas plus prompts and accepted answers.
