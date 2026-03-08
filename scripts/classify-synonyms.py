"""
Classify synonym pairs as strong/near/none using Gemma via Google genai.

Usage:
    python scripts/classify-synonyms.py
    python scripts/classify-synonyms.py --batch-size 15
    python scripts/classify-synonyms.py --resume          # skip already classified words

Input:
    synonym-candidates.json   (from fetch-synonyms.py)

Output:
    synonyms.json   { word: { strong: [...], near: [...] } }
    Relationships are written symmetrically (a→b and b→a).

Next step:
    node scripts/build-deck.js
"""

import argparse
import json
import os
import re
import time

from google import genai

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
CANDIDATES_PATH = os.path.join(ROOT_DIR, "synonym-candidates.json")
OUTPUT_PATH = os.path.join(ROOT_DIR, "synonyms.json")

MODEL_NAME = "gemma-3-27b-it"
MAX_RPM = 10
SLEEP_BETWEEN = 60 / MAX_RPM + 2.0   # ~8s
MAX_RETRIES = 5
DEFAULT_BATCH = 20   # pairs per API call

CLASSIFY_PROMPT = """\
You are a French linguist. For each word pair below, classify the synonym relationship:

- "strong" : the words are nearly interchangeable in most everyday French contexts
- "near"   : related in meaning but with a notable register, connotation, or usage difference
- "none"   : not actually synonyms (false cognates, antonyms, or only distantly related)

Respond with a JSON array only, no explanation, no markdown fences.
Format: [{{"a": "word1", "b": "word2", "type": "strong"|"near"|"none"}}, ...]

Pairs to classify:
{PAIRS}
"""


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


def extract_json_from_response(text: str) -> list:
    text = text.strip()
    match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


def classify_batch(client, pairs: list[tuple[str, str]]) -> list[dict]:
    """Send a batch of (a, b) pairs to Gemma and return classification results."""
    pairs_text = "\n".join(f"{a} / {b}" for a, b in pairs)
    prompt = CLASSIFY_PROMPT.replace("{PAIRS}", pairs_text)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=MODEL_NAME,
                contents=prompt,
            )
            data = extract_json_from_response(response.text)
            if not isinstance(data, list):
                raise ValueError("Response is not a JSON array")
            # Validate entries
            results = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                a = item.get("a", "").strip().lower()
                b = item.get("b", "").strip().lower()
                t = item.get("type", "none").strip().lower()
                if a and b and t in ("strong", "near", "none"):
                    results.append({"a": a, "b": b, "type": t})
            return results

        except json.JSONDecodeError as e:
            print(f"    JSON error (attempt {attempt}/{MAX_RETRIES}): {e}")
            if attempt < MAX_RETRIES:
                time.sleep(2 ** attempt)
        except Exception as e:
            err = str(e)
            if "429" in err or "RESOURCE_EXHAUSTED" in err:
                wait = 30 * attempt
                m = re.search(r"retry in ([\d.]+)s", err, re.IGNORECASE)
                if m:
                    wait = max(int(float(m.group(1))) + 5, wait)
                print(f"    Rate limited. Waiting {wait}s (attempt {attempt}/{MAX_RETRIES})...")
                time.sleep(wait)
            else:
                print(f"    API error (attempt {attempt}/{MAX_RETRIES}): {e}")
                if attempt < MAX_RETRIES:
                    time.sleep(2 ** attempt)

    return []


def merge_result(synonyms: dict, a: str, b: str, rel_type: str):
    """Add a classified pair to the synonyms dict (symmetrically)."""
    if rel_type == "none":
        return
    for word, other in [(a, b), (b, a)]:
        if word not in synonyms:
            synonyms[word] = {"strong": [], "near": []}
        bucket = synonyms[word][rel_type]
        if other not in bucket:
            bucket.append(other)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Classify synonym pairs with Gemma")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH,
                        help=f"Pairs per API request (default: {DEFAULT_BATCH})")
    parser.add_argument("--resume", action="store_true",
                        help="Skip words already present in synonyms.json")
    args = parser.parse_args()

    # Load .env
    load_dotenv(os.path.join(ROOT_DIR, ".env"))
    import os as _os
    api_key = _os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY not set. Add it to .env")
        import sys; sys.exit(1)

    client = genai.Client(api_key=api_key)

    # Load candidates
    if not os.path.exists(CANDIDATES_PATH):
        print(f"Error: {CANDIDATES_PATH} not found.")
        print("Run: python scripts/fetch-synonyms.py")
        import sys; sys.exit(1)

    with open(CANDIDATES_PATH, "r", encoding="utf-8") as f:
        candidates_list = json.load(f)

    # Load existing output for resume
    synonyms: dict = {}
    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
            synonyms = json.load(f)

    # Build all pairs to classify
    # Skip pairs where the word is already classified (resume mode)
    all_pairs: list[tuple[str, str]] = []
    classified_words = set(synonyms.keys()) if args.resume else set()

    for entry in candidates_list:
        word = entry["word"]
        candidates = entry["candidates"]
        if not candidates:
            continue
        if args.resume and word in classified_words:
            continue
        for c in candidates:
            all_pairs.append((word, c))

    # Deduplicate pairs (unordered)
    seen_pairs: set[frozenset] = set()
    unique_pairs: list[tuple[str, str]] = []
    for a, b in all_pairs:
        key = frozenset([a, b])
        if key not in seen_pairs:
            seen_pairs.add(key)
            unique_pairs.append((a, b))

    print(f"Loaded {len(candidates_list)} lemmas with candidates.")
    print(f"Unique pairs to classify: {len(unique_pairs)}")
    if args.resume:
        print(f"Resume mode: {len(classified_words)} words already classified.")

    if not unique_pairs:
        print("Nothing to classify.")
        return

    # Batch classification
    batches = [unique_pairs[i:i + args.batch_size]
               for i in range(0, len(unique_pairs), args.batch_size)]
    total_batches = len(batches)
    classified_count = 0

    print(f"\nClassifying {len(unique_pairs)} pairs in {total_batches} batches...\n")

    for i, batch in enumerate(batches):
        print(f"Batch {i + 1}/{total_batches} ({len(batch)} pairs: {batch[0][0]}/{batch[0][1]} ...)")

        results = classify_batch(client, batch)

        for r in results:
            merge_result(synonyms, r["a"], r["b"], r["type"])
            if r["type"] != "none":
                classified_count += 1

        # Save after each batch
        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(synonyms, f, ensure_ascii=False, indent=2)

        matched = sum(1 for r in results if r["type"] != "none")
        print(f"  {matched}/{len(batch)} pairs accepted (strong or near). Total synonyms: {classified_count}")

        if i < total_batches - 1:
            time.sleep(SLEEP_BETWEEN)

    # Summary
    strong_total = sum(len(v["strong"]) for v in synonyms.values())
    near_total = sum(len(v["near"]) for v in synonyms.values())
    print(f"\n{'=' * 50}")
    print(f"Done. {len(synonyms)} words have synonyms.")
    print(f"  Strong pairs: {strong_total // 2}  |  Near pairs: {near_total // 2}")
    print(f"Saved to {OUTPUT_PATH}")
    print(f"\nNext step: node scripts/build-deck.js")


if __name__ == "__main__":
    main()
