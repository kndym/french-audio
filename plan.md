```markdown
# Synonym Pipeline Plan

## Overview
Find synonym pairs for French lemmas using real dictionary data, then classify
them as strong or near synonyms using Gemma.

## Pipeline

### 1. Fetch synonym candidates — `scripts/fetch-synonyms.py`
- Extract and normalize lemmas from `words.csv` (lowercase, deduplicate, skip < 3 chars)
- For each lemma, query **fr.Wiktionary** API (wikitext parse → `{{S|synonymes}}` block)
- Fallback: scrape **CRISCO DES** (`crisco.unicaen.fr/des/synonymes/{word}`)
- Cross-filter candidates: keep only words that exist in our `words.csv` lemma set
- Output: `synonym-candidates.json` — `[{ word, candidates: [...] }, ...]`
- Flags: `--limit N`, `--min-len N`, `--resume`

### 2. Classify with Gemma — `scripts/classify-synonyms.py`
- Load `synonym-candidates.json`, build unique word pairs
- Batch 20 pairs per call to `gemma-3-27b-it` via Google genai
- Prompt asks for classification: `"strong"` | `"near"` | `"none"`
  - **strong**: nearly interchangeable in everyday French
  - **near**: related but with register/connotation/usage differences
  - **none**: reject (false cognate, antonym, distantly related)
- Write both directions symmetrically (a→b and b→a)
- Output: `synonyms.json` — `{ word: { strong: [...], near: [...] } }`
- Flags: `--batch-size N`, `--resume`

### 3. Rebuild deck — `node scripts/build-deck.js`
- Already loads `synonyms.json` via `loadSynonyms()` and merges into each card
- Cards get `synonyms: { strong: [...], near: [...] }` field populated

## Run order
```bash
python scripts/fetch-synonyms.py --resume
python scripts/classify-synonyms.py --resume
node scripts/build-deck.js
```
```
