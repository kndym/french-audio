"""
Fetch French synonym candidates from Wiktionary (with CRISCO fallback).

Usage:
    python scripts/fetch-synonyms.py                   # all lemmas, min 3 chars
    python scripts/fetch-synonyms.py --limit 100       # first 100 lemmas only
    python scripts/fetch-synonyms.py --min-len 4       # skip very short words
    python scripts/fetch-synonyms.py --resume          # skip already-fetched lemmas

Input:
    words.csv  (col 2 = lemme)

Output:
    synonym-candidates.json   [{word, candidates: [...]}, ...]
    Only includes entries where at least 1 candidate was found.

Next step:
    python scripts/classify-synonyms.py
"""

import argparse
import csv
import json
import os
import re
import time

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
CSV_PATH = os.path.join(ROOT_DIR, "words.csv")
OUTPUT_PATH = os.path.join(ROOT_DIR, "synonym-candidates.json")

WIKT_API = "https://fr.wiktionary.org/w/api.php"
CRISCO_URL = "https://www.crisco.unicaen.fr/des/synonymes/{word}"

SLEEP_BETWEEN = 1.1   # seconds between requests (Wiktionary guideline: ≤1 req/s)
REQUEST_TIMEOUT = 10  # seconds


# ---------------------------------------------------------------------------
# Lemma loading
# ---------------------------------------------------------------------------

def extract_lemmas(csv_path: str) -> list[str]:
    """Read unique lemmas from words.csv in frequency order."""
    lemmas = []
    seen = set()
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        next(reader)  # skip description row
        next(reader)  # skip header row
        for row in reader:
            if len(row) > 1:
                lemme = row[1].strip().lower()
                if lemme and lemme not in seen:
                    lemmas.append(lemme)
                    seen.add(lemme)
    return lemmas


# ---------------------------------------------------------------------------
# Wiktionary parsing
# ---------------------------------------------------------------------------

def fetch_wikitext(lemma: str) -> str | None:
    """Fetch raw wikitext for a French lemma from fr.wiktionary.org."""
    params = {
        "action": "parse",
        "page": lemma,
        "prop": "wikitext",
        "format": "json",
        "redirects": 1,
    }
    try:
        r = requests.get(WIKT_API, params=params, timeout=REQUEST_TIMEOUT,
                         headers={"User-Agent": "french-audio-synonyms/1.0 (educational)"})
        r.raise_for_status()
        data = r.json()
        if "parse" not in data:
            return None
        return data["parse"]["wikitext"]["*"]
    except Exception:
        return None


def extract_french_section(wikitext: str) -> str:
    """Extract the French (== {{langue|fr}} ==) section from wikitext."""
    # Match start of French language block
    fr_start = re.search(
        r"==\s*\{\{langue\|fr\}\}\s*==|==\s*Français\s*==",
        wikitext
    )
    if not fr_start:
        return ""
    section = wikitext[fr_start.start():]
    # Trim at next top-level language section (another == X == that isn't ===)
    end = re.search(r"\n==\s*(?!\=)", section[4:])
    if end:
        section = section[:end.start() + 4]
    return section


def parse_synonyms_from_wikitext(wikitext: str) -> list[str]:
    """Extract synonyms from the French section of Wiktionary wikitext."""
    section = extract_french_section(wikitext)
    if not section:
        return []

    # Find synonymes subsection
    syn_match = re.search(
        r"\{\{S\|synonymes[^}]*\}\}|====\s*Synonymes\s*====",
        section
    )
    if not syn_match:
        return []

    # Grab lines after the header until next subsection
    after = section[syn_match.end():]
    subsection_end = re.search(r"\n===|^\{\{S\|", after, re.MULTILINE)
    if subsection_end:
        after = after[:subsection_end.start()]

    synonyms = []
    # Match [[word]], [[word|display]], {{lien|word|fr}}, {{lien|word|lang=fr}}
    for line in after.splitlines():
        line = line.strip()
        if not line.startswith("*"):
            continue
        # [[target]] or [[target|label]]
        for m in re.finditer(r"\[\[([^\|\]]+)(?:\|[^\]]*)?\]\]", line):
            word = m.group(1).strip().lower()
            if word and not word.startswith("catégorie:") and not word.startswith("fichier:"):
                synonyms.append(word)
        # {{lien|word|fr}} or {{lien|word|lang=fr}}
        for m in re.finditer(r"\{\{lien\|([^|}]+)\|fr", line):
            word = m.group(1).strip().lower()
            if word:
                synonyms.append(word)

    return list(dict.fromkeys(synonyms))  # deduplicate preserving order


# ---------------------------------------------------------------------------
# CRISCO fallback
# ---------------------------------------------------------------------------

def fetch_crisco_synonyms(lemma: str) -> list[str]:
    """Scrape synonym list from CRISCO DES (fallback)."""
    url = CRISCO_URL.format(word=lemma)
    try:
        r = requests.get(url, timeout=REQUEST_TIMEOUT,
                         headers={"User-Agent": "french-audio-synonyms/1.0 (educational)"})
        if r.status_code != 200:
            return []
        # Synonyms appear as links inside result list items
        # Pattern: <a href="/des/synonymes/WORD">WORD</a>
        words = re.findall(r'href="/des/synonymes/([^"]+)"', r.text)
        return [w.lower() for w in words if w and w != lemma]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Fetch French synonym candidates")
    parser.add_argument("--limit", type=int, default=1000,
                        help="Max lemmas to process (0 = all, default: 1000)")
    parser.add_argument("--min-len", type=int, default=3,
                        help="Skip lemmas shorter than this (default: 3)")
    parser.add_argument("--resume", action="store_true",
                        help="Skip lemmas already present in output file")
    args = parser.parse_args()

    # Load lemmas
    print(f"Reading lemmas from {CSV_PATH}...")
    all_lemmas = extract_lemmas(CSV_PATH)
    print(f"  {len(all_lemmas)} unique lemmas found.")

    # Apply min-len filter
    lemmas = [l for l in all_lemmas if len(l) >= args.min_len]
    print(f"  {len(lemmas)} lemmas with len >= {args.min_len}.")

    lemma_set = set(all_lemmas)  # for cross-filtering candidates

    # Apply limit
    if args.limit > 0:
        lemmas = lemmas[:args.limit]
        print(f"  Limited to first {len(lemmas)} lemmas (--limit {args.limit}).")

    # Load existing output for resume
    existing: dict[str, list[str]] = {}
    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
            for entry in json.load(f):
                existing[entry["word"]] = entry["candidates"]
        print(f"  {len(existing)} lemmas already fetched.")

    if args.resume:
        lemmas = [l for l in lemmas if l not in existing]
        print(f"  {len(lemmas)} lemmas remaining after resume filter.")

    if not lemmas:
        print("Nothing to do.")
    else:
        print(f"\nFetching synonyms for {len(lemmas)} lemmas...\n")

        for i, lemma in enumerate(lemmas):
            wikitext = fetch_wikitext(lemma)
            candidates = []

            if wikitext:
                candidates = parse_synonyms_from_wikitext(wikitext)

            if not candidates:
                # CRISCO fallback
                candidates = fetch_crisco_synonyms(lemma)
                source = "CRISCO" if candidates else "none"
            else:
                source = "Wiktionary"

            # Cross-filter: only keep candidates that exist in our lemma set
            candidates = [c for c in candidates if c in lemma_set and c != lemma]
            candidates = list(dict.fromkeys(candidates))  # deduplicate

            status = f"{len(candidates)} candidates [{source}]"
            print(f"  [{i + 1}/{len(lemmas)}] {lemma:<20} {status}")

            if candidates:
                existing[lemma] = candidates
            elif lemma not in existing:
                existing[lemma] = []  # record that we checked, found nothing

            # Save after every lemma (safe resume)
            output = [{"word": w, "candidates": c} for w, c in existing.items()]
            with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
                json.dump(output, f, ensure_ascii=False, indent=2)

            if i < len(lemmas) - 1:
                time.sleep(SLEEP_BETWEEN)

    # Summary
    output = [{"word": w, "candidates": c} for w, c in existing.items()]
    with_candidates = sum(1 for e in output if e["candidates"])
    print(f"\n{'=' * 50}")
    print(f"Done. {with_candidates} lemmas have synonym candidates.")
    print(f"Saved to {OUTPUT_PATH}")
    print(f"\nNext step: python scripts/classify-synonyms.py")


if __name__ == "__main__":
    main()
