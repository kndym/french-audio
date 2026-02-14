import csv
import json

def generate_placeholder_prompts(lemme, num_prompts=3):
    prompts = []
    for i in range(num_prompts):
        prompts.append({
            "sentence": f"PLACEHOLDER: Sentence for '{lemme}' (context {i+1}).",
            "hint": f"PLACEHOLDER: Hint for '{lemme}' (concept {i+1}).",
            "acceptedAnswers": [lemme] # Start with the lemma as a default accepted answer
        })
    return prompts

def extract_lemmas(file_path):
    lemmas = []
    with open(file_path, 'r', encoding='utf-8-sig') as csvfile:
        reader = csv.reader(csvfile)
        next(reader)  # Skip first header row
        next(reader)  # Skip second header row (freq,lemme,...)
        for row in reader:
            if len(row) > 1:
                lemme = row[1].strip()
                if lemme and lemme not in lemmas:
                    lemmas.append(lemme)
    return lemmas

def main():
    csv_file = "words.csv"
    output_json_file = "public/cards.json"

    print(f"Extracting lemmas from {csv_file}...")
    lemmas = extract_lemmas(csv_file)
    print(f"Found {len(lemmas)} unique lemmas.")

    cards_data = {}
    for i, lemme in enumerate(lemmas):
        # print(f"Generating placeholders for lemma {i+1}/{len(lemmas)}: {lemme}")
        prompts = generate_placeholder_prompts(lemme)
        if prompts:
            cards_data[lemme] = prompts

    print(f"Writing generated cards to {output_json_file}...")
    with open(output_json_file, 'w', encoding='utf-8') as jsonfile:
        json.dump(cards_data, jsonfile, ensure_ascii=False, indent=2)
    print("Process completed.")

if __name__ == "__main__":
    main()
