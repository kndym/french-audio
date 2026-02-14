"""
Batch-generate French fill-in-the-blank cards using Gemini free tier.

Usage:
    pip install -r requirements.txt
    cp .env.example .env                      # then add your Gemini API key
    python scripts/generate-cards.py                     # default 500 words
    python scripts/generate-cards.py --count 1000        # first 1000 words
    python scripts/generate-cards.py --count 0           # all words
"""

import argparse
import csv
import json
import os
import re
import sys
import time

from google import genai

# Load .env file if present (no extra dependency needed)
def load_dotenv(env_path: str):
    """Load key=value pairs from a .env file into os.environ."""
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BATCH_SIZE = 20          # words per API call
MODEL_NAME = "gemini-2.5-flash-lite"
MAX_RPM = 10             # Gemini 2.5 Flash Lite free tier rate limit
SLEEP_BETWEEN = 60 / MAX_RPM + 2.0  # ~8s between requests (stay safe)
MAX_RETRIES = 5

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
CSV_PATH = os.path.join(ROOT_DIR, "words.csv")
PROMPT_PATH = os.path.join(ROOT_DIR, "prompt.md")
OUTPUT_PATH = os.path.join(ROOT_DIR, "generated-cards.json")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def extract_lemmas(csv_path: str) -> list[str]:
    """Read unique lemmas from words.csv, preserving frequency order."""
    lemmas = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        next(reader)  # skip description row
        next(reader)  # skip header row (freq, lemme, ...)
        for row in reader:
            if len(row) > 1:
                lemme = row[1].strip()
                if lemme and lemme not in lemmas:
                    lemmas.append(lemme)
    return lemmas


def load_prompt_template(prompt_path: str) -> str:
    """Load prompt.md and extract everything up to and including {LEMMA_LIST}."""
    with open(prompt_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Extract the system prompt section + everything after it
    # The full file IS the prompt, with {LEMMA_LIST} placeholder at the end
    # Strip markdown code fences from the examples (Gemini gets confused by them)
    content = re.sub(r"```json\s*\n?", "", content)
    content = re.sub(r"```\s*\n?", "", content)
    return content


def build_prompt(template: str, lemmas: list[str]) -> str:
    """Replace {LEMMA_LIST} placeholder with actual comma-separated lemmas."""
    lemma_list = ", ".join(lemmas)
    return template.replace("{LEMMA_LIST}", lemma_list)


def load_existing(output_path: str) -> dict:
    """Load previously generated cards for resume support."""
    if os.path.exists(output_path):
        try:
            with open(output_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def save_output(output_path: str, data: dict):
    """Write generated cards to disk."""
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def extract_json_from_response(text: str) -> dict:
    """Parse JSON from Gemini response, handling markdown fences."""
    text = text.strip()
    # Strip markdown code fences if present
    match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


def validate_card(lemma: str, cards: list) -> list:
    """Validate and clean a list of card objects for a given lemma."""
    valid = []
    for card in cards:
        if not isinstance(card, dict):
            continue
        sentence = card.get("sentence", "")
        hint = card.get("hint", "")
        answers = card.get("acceptedAnswers", [])
        if not sentence or not hint or not answers:
            continue
        if "___" not in sentence:
            continue
        if not isinstance(answers, list) or len(answers) == 0:
            continue
        valid.append({
            "sentence": sentence,
            "hint": hint,
            "acceptedAnswers": answers,
        })
    return valid


def generate_batch(client, template: str, lemmas: list[str]) -> dict:
    """Send a batch of lemmas to Gemini and return parsed card data."""
    prompt = build_prompt(template, lemmas)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=MODEL_NAME,
                contents=prompt,
            )
            data = extract_json_from_response(response.text)

            if not isinstance(data, dict):
                raise ValueError("Response is not a JSON object")

            # Validate each lemma's cards
            result = {}
            for lemma in lemmas:
                if lemma in data:
                    validated = validate_card(lemma, data[lemma])
                    if validated:
                        result[lemma] = validated
                    else:
                        print(f"  Warning: no valid cards for '{lemma}' in response")
                else:
                    print(f"  Warning: '{lemma}' missing from response")

            return result

        except json.JSONDecodeError as e:
            print(f"  JSON parse error (attempt {attempt}/{MAX_RETRIES}): {e}")
            if attempt < MAX_RETRIES:
                time.sleep(2 ** attempt)
        except Exception as e:
            error_msg = str(e)
            if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
                # Try to extract retry delay from error message
                wait = 30 * attempt  # default
                retry_match = re.search(r"retry in ([\d.]+)s", error_msg, re.IGNORECASE)
                if retry_match:
                    wait = max(int(float(retry_match.group(1))) + 5, wait)
                print(f"  Rate limited. Waiting {wait}s (attempt {attempt}/{MAX_RETRIES})...")
                time.sleep(wait)
            else:
                print(f"  API error (attempt {attempt}/{MAX_RETRIES}): {e}")
                if attempt < MAX_RETRIES:
                    time.sleep(2 ** attempt)

    return {}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate French flashcards via Gemini")
    parser.add_argument("--count", type=int, default=500,
                        help="Number of words to generate (0 = all). Default: 500")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE,
                        help=f"Words per API request. Default: {BATCH_SIZE}")
    args = parser.parse_args()

    # --- Load .env ---
    load_dotenv(os.path.join(ROOT_DIR, ".env"))

    # --- API key ---
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: Set GEMINI_API_KEY in .env or as an environment variable.")
        print("  1. Copy .env.example to .env")
        print("  2. Add your key from https://aistudio.google.com/apikey")
        sys.exit(1)

    client = genai.Client(api_key=api_key)

    # --- Load data ---
    print(f"Reading lemmas from {CSV_PATH}...")
    all_lemmas = extract_lemmas(CSV_PATH)
    print(f"  Found {len(all_lemmas)} unique lemmas.")

    count = args.count if args.count > 0 else len(all_lemmas)
    target_lemmas = all_lemmas[:count]
    print(f"  Targeting first {len(target_lemmas)} lemmas.")

    print(f"Loading prompt template from {PROMPT_PATH}...")
    template = load_prompt_template(PROMPT_PATH)

    print(f"Loading existing output from {OUTPUT_PATH}...")
    existing = load_existing(OUTPUT_PATH)
    print(f"  {len(existing)} lemmas already generated.")

    # --- Filter out already-generated lemmas ---
    remaining = [l for l in target_lemmas if l not in existing]
    print(f"  {len(remaining)} lemmas remaining to generate.")

    if not remaining:
        print("Nothing to do! All target lemmas already have cards.")
        return

    # --- Batch generation ---
    batches = [remaining[i:i + args.batch_size]
               for i in range(0, len(remaining), args.batch_size)]
    total_batches = len(batches)
    print(f"\nStarting generation: {len(remaining)} words in {total_batches} batches of up to {args.batch_size}")
    print(f"Estimated time: ~{int(total_batches * SLEEP_BETWEEN / 60) + 1} minutes\n")

    generated_count = 0
    failed_lemmas = []

    for i, batch in enumerate(batches):
        print(f"Batch {i + 1}/{total_batches}: {batch[0]} ... {batch[-1]}")

        result = generate_batch(client, template, batch)

        if result:
            existing.update(result)
            generated_count += len(result)
            # Track any lemmas that didn't come back
            for lemma in batch:
                if lemma not in result:
                    failed_lemmas.append(lemma)
            # Save after each batch for resume support
            save_output(OUTPUT_PATH, existing)
            print(f"  Generated {len(result)}/{len(batch)} cards. Total: {len(existing)}")
        else:
            failed_lemmas.extend(batch)
            print(f"  Batch failed entirely.")

        # Rate limit pause (skip after last batch)
        if i < total_batches - 1:
            time.sleep(SLEEP_BETWEEN)

    # --- Summary ---
    print(f"\n{'=' * 50}")
    print(f"Done! Generated cards for {generated_count} new lemmas.")
    print(f"Total in {OUTPUT_PATH}: {len(existing)} lemmas.")
    if failed_lemmas:
        print(f"\n{len(failed_lemmas)} lemmas failed (re-run to retry):")
        print(f"  {', '.join(failed_lemmas[:20])}{'...' if len(failed_lemmas) > 20 else ''}")
    print(f"\nNext step: node scripts/build-deck.js")


if __name__ == "__main__":
    main()
