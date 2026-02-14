```markdown
# Plan for French Fill-in-the-Blank Prompts (Comprehensive Generation)

## 1. Extract Lemmas from `words.csv`
- Read `words.csv` in chunks to handle large file size.
- Parse each line to extract the "lemme" (second column).
- Store all unique lemmas in a list.

## 2. Implement Comprehensive Sentence and Accepted Answer Generation in `process_words.py`
- **Objective**: The `generate_prompts(lemme)` function will be significantly expanded to create 2–4 natural French sentences with blanks and accurate `acceptedAnswers` for EACH lemma, following the detailed rules in `prompt.md` for various word types.

### 2.1. Verb Generation
- Implement logic to generate 2–4 sentences covering different tenses/forms (infinitive, present, passé composé, imparfait, futur, imperative, subjunctive), using varying subjects.
- Accurately determine and list all valid conjugations in `acceptedAnswers` for each specific blank.

### 2.2. Noun Generation
- Implement logic to generate 2–3 sentences using the noun in different contexts (subject, object, after a preposition).
- `hint` will be the English meaning.
- `acceptedAnswers` will include the word as-is, plus plural or alternate spellings if applicable to the sentence.

### 2.3. Adjective Generation
- Implement logic to generate 2–3 sentences, varying gender/number agreement where possible.
- `hint` will be the English meaning.
- `acceptedAnswers` will include all agreement forms that fit the blank.

### 2.4. Other Word Types (Adverbs, Prepositions, Conjunctions, Pronouns, Determiners)
- Implement logic to generate 2 sentences showing the word in different natural contexts.
- `hint` will be the English meaning or function.
- `acceptedAnswers` will typically be the word itself, with variants if applicable.

### 2.5. Quality Guidelines Adherence
- Ensure sentences are short (6–12 words), conversational, and use common vocabulary.
- Avoid repeating sentence structures for the same lemma.
- Ensure the lemma (or its inflected form) appears *only* in the blank.
- Provide sufficient context for learners to deduce the answer.

## 3. Structure Output into `public/cards.json`
- Iterate through the list of extracted lemmas.
- For each lemma, call `generate_prompts` to get the sentences and accepted answers.
- Format the output into a JSON object as specified:
  ```json
  {
    "lemme": [
      { "sentence": "...", "hint": "...", "acceptedAnswers": ["..."] },
      { "sentence": "...", "hint": "...", "acceptedAnswers": ["..."] }
    ]
  }
  ```
- Write the complete JSON object to `public/cards.json`.

## 4. Refinement and Review
- Thoroughly review generated prompts for correctness, naturalness, and adherence to all rules, especially for high-frequency words.
- Address any grammatical errors, inconsistencies, or unnatural phrasing.

```