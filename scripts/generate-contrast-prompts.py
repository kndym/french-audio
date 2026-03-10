"""
Generate context-differentiating fill-in-the-blank prompts for lemmas that have near synonyms.

For each lemma with near synonyms, generates additional prompts (up to TARGET_TOTAL = 6)
whose sentences clearly show WHY this word is correct instead of its near synonym.

Usage:
    python scripts/generate-contrast-prompts.py           # all near-synonym lemmas
    python scripts/generate-contrast-prompts.py --dry-run # show queue without calling API

Input:
    synonyms.json            (word → {strong, near})
    generated-cards.json     (existing prompts per lemma)
    contrast-prompt.md       (LLM instruction template)

Output:
    generated-cards.json     (appended — existing prompts are never removed)

Next step:
    node scripts/build-deck.js
"""

import argparse
import json
import os
import re
import sys
import time

from google import genai

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
TARGET_TOTAL = 6        # max prompts per lemma after enrichment
BATCH_SIZE = 15         # lemmas per API call
MODEL_NAME = "gemma-3-27b-it"
MAX_RPM = 10
SLEEP_BETWEEN = 60 / MAX_RPM + 2.0  # ~8s between requests
MAX_RETRIES = 5

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
SYNONYMS_PATH = os.path.join(ROOT_DIR, "synonyms.json")
GENERATED_PATH = os.path.join(ROOT_DIR, "generated-cards.json")
PROMPT_PATH = os.path.join(ROOT_DIR, "contrast-prompt.md")
OUTPUT_PATH = GENERATED_PATH  # append to same file


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_dotenv(env_path: str):
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


def load_json(path: str, default):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return default


def save_json(path: str, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_prompt_template(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    content = re.sub(r"```json\s*\n?", "", content)
    content = re.sub(r"```\s*\n?", "", content)
    return content


def extract_json_from_response(text: str) -> dict:
    text = text.strip()
    match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


def validate_cards(lemma: str, cards: list) -> list:
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
        valid.append({"sentence": sentence, "hint": hint, "acceptedAnswers": answers})
    return valid


def build_word_list(queue: list) -> str:
    """Build the {WORD_LIST} section: one line per lemma with near synonyms and count."""
    lines = []
    for lemma, near_syns, needed in queue:
        syn_str = ", ".join(near_syns)
        lines.append(f"{lemma} [near synonyms: {syn_str}] → generate {needed} sentences")
    return "\n".join(lines)


def generate_batch(client, template: str, queue: list) -> dict:
    """Send one batch to Gemini. queue = [(lemma, near_syns, needed), ...]"""
    word_list = build_word_list(queue)
    prompt = template.replace("{WORD_LIST}", word_list)
    lemmas = [item[0] for item in queue]

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=MODEL_NAME,
                contents=prompt,
            )
            data = extract_json_from_response(response.text)

            if not isinstance(data, dict):
                raise ValueError("Response is not a JSON object")

            result = {}
            for lemma, _, needed in queue:
                if lemma in data:
                    validated = validate_cards(lemma, data[lemma])
                    if validated:
                        # Cap at the number requested
                        result[lemma] = validated[:needed]
                    else:
                        print(f"  Warning: no valid cards for '{lemma}'")
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
                wait = 30 * attempt
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
    parser = argparse.ArgumentParser(description="Generate contrast prompts for near-synonym lemmas")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show queue without calling the API")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    args = parser.parse_args()

    load_dotenv(os.path.join(ROOT_DIR, ".env"))

    # --- Load data ---
    print(f"Loading synonyms from {SYNONYMS_PATH}...")
    synonyms = load_json(SYNONYMS_PATH, {})
    print(f"  {len(synonyms)} words with synonym data.")

    print(f"Loading existing prompts from {GENERATED_PATH}...")
    generated = load_json(GENERATED_PATH, {})
    print(f"  {len(generated)} lemmas already have prompts.")

    print(f"Loading contrast prompt template from {PROMPT_PATH}...")
    if not os.path.exists(PROMPT_PATH):
        print(f"Error: {PROMPT_PATH} not found.")
        sys.exit(1)
    template = load_prompt_template(PROMPT_PATH)

    # --- Build queue ---
    # Only lemmas with near synonyms that have fewer than TARGET_TOTAL prompts
    queue = []
    for lemma, syn_data in synonyms.items():
        near = syn_data.get("near", [])
        if not near:
            continue
        existing = generated.get(lemma, [])
        needed = max(0, TARGET_TOTAL - len(existing))
        if needed == 0:
            continue
        queue.append((lemma, near, needed))

    print(f"\n{len(queue)} lemmas need contrast prompts (have fewer than {TARGET_TOTAL} total).")

    if not queue:
        print("Nothing to do!")
        return

    if args.dry_run:
        print("\nDry run — first 20 items in queue:")
        for lemma, near, needed in queue[:20]:
            print(f"  {lemma} [near: {', '.join(near)}] -> +{needed} prompts")
        return

    # --- API key ---
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: Set GEMINI_API_KEY in .env or as an environment variable.")
        sys.exit(1)
    client = genai.Client(api_key=api_key)

    # --- Batch generation ---
    batches = [queue[i:i + args.batch_size]
               for i in range(0, len(queue), args.batch_size)]
    total_batches = len(batches)
    print(f"Starting generation: {len(queue)} lemmas in {total_batches} batches of up to {args.batch_size}")
    print(f"Estimated time: ~{int(total_batches * SLEEP_BETWEEN / 60) + 1} minutes\n")

    enriched_count = 0
    failed_lemmas = []

    for i, batch in enumerate(batches):
        first, last = batch[0][0], batch[-1][0]
        print(f"Batch {i + 1}/{total_batches}: {first} ... {last}")

        result = generate_batch(client, template, batch)

        if result:
            for lemma, new_prompts in result.items():
                existing = generated.get(lemma, [])
                generated[lemma] = existing + new_prompts
                enriched_count += 1
            for lemma, _, _ in batch:
                if lemma not in result:
                    failed_lemmas.append(lemma)
            save_json(OUTPUT_PATH, generated)
            print(f"  Enriched {len(result)}/{len(batch)} lemmas. Total enriched so far: {enriched_count}")
        else:
            failed_lemmas.extend([item[0] for item in batch])
            print(f"  Batch failed entirely.")

        if i < total_batches - 1:
            time.sleep(SLEEP_BETWEEN)

    # --- Summary ---
    print(f"\n{'=' * 50}")
    print(f"Done! Enriched {enriched_count} lemmas with contrast prompts.")
    print(f"Total lemmas in {OUTPUT_PATH}: {len(generated)}")
    if failed_lemmas:
        print(f"\n{len(failed_lemmas)} lemmas failed (re-run to retry):")
        print(f"  {', '.join(failed_lemmas[:20])}{'...' if len(failed_lemmas) > 20 else ''}")
    print(f"\nNext step: node scripts/build-deck.js")


if __name__ == "__main__":
    main()
