/**
 * Build cards.json from words.csv - top 100 French lemmas with prompts and accepted answers.
 * Run: node scripts/build-deck.js
 */

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '..', 'words.csv');
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'cards.json');

// Hand-curated prompts and accepted forms for high-frequency words
const PROMPTS_MAP = {
  être: ["I am tired", "You are French", "We are here", "They are happy", "He is at home"],
  je: ["I am ready", "I want to go", "I don't know"],
  de: ["a piece of cake", "from Paris", "the house of my friend"],
  ne: ["I don't understand", "She doesn't want to"],
  avoir: ["I have a dog", "She has time", "Do you have a pen?"],
  pas: ["Not yet", "No problem", "I don't know"],
  la: ["the woman", "the house", "the door"],
  tu: ["You are nice", "Do you want some coffee?"],
  le: ["the man", "the book", "the car"],
  vous: ["You are welcome", "Do you speak French?"],
  il: ["He is here", "It is raining"],
  et: ["bread and butter", "you and me"],
  à: ["at home", "to Paris", "at 5 o'clock"],
  un: ["a book", "one day", "an apple"],
  aller: ["I'm going home", "We're going to leave", "Where are you going?"],
  ça: ["That's good", "How's it going?", "That's it"],
  faire: ["I'm doing homework", "What are you doing?", "We're making dinner"],
  les: ["the children", "the books", "the apples"],
  on: ["We are going", "One must try", "We'll see"],
  "l'": ["the airplane", "the hour", "the friend"],
  une: ["a house", "an idea", "one day"],
  "d'": ["a lot of", "from here", "some water"],
  pour: ["for you", "in order to", "for dessert"],
  des: ["some books", "of the", "some friends"],
  dire: ["to say", "What did you say?", "They say that"],
  en: ["in French", "in 2024", "by train"],
  pouvoir: ["I can help", "Can you come?", "We couldn't"],
  qui: ["who is that?", "the man who", "which one?"],
  vouloir: ["I want coffee", "Do you want to come?", "They want to leave"],
  ce: ["this book", "that man", "what's this?"],
  mais: ["but I don't know", "yes but", "however"],
  me: ["Give me", "Tell me", "He told me"],
  nous: ["We are leaving", "Give us", "between us"],
  dans: ["in the house", "in 5 minutes", "in Paris"],
  elle: ["She is beautiful", "It is ready"],
  savoir: ["I know", "Do you know?", "We need to know"],
  du: ["some bread", "of the", "from the"],
  y: ["I'm going there", "there is", "are you there?"],
  "t'": ["I love you", "I told you"],
  bien: ["very well", "that's good", "well done"],
  voir: ["I want to see", "Let me see", "We'll see"],
  que: ["that", "what", "than"],
  plus: ["more", "no more", "anymore"],
  non: ["no", "not at all"],
  te: ["I love you", "I told you"],
  mon: ["my house", "my friend", "my book"],
  au: ["at the", "to the", "at home"],
  avec: ["with me", "with sugar", "together"],
  moi: ["me", "for me", "with me"],
  devoir: ["I have to go", "We must try", "You should rest"],
  oui: ["yes", "yeah"],
  ils: ["They are here", "They want to leave"],
  tout: ["everything", "all", "very"],
  se: ["each other", "himself", "herself"],
  venir: ["to come", "Come here!", "He is coming"],
  sur: ["on the table", "about", "over"],
  toi: ["you", "for you"],
  "s'": ["himself", "herself", "each other"],
  ici: ["here", "over here", "right here"],
  rien: ["nothing", "not anything", "nothing at all"],
  ma: ["my house", "my friend"],
  comme: ["like", "as", "such as"],
  lui: ["him", "to him", "for him"],
  où: ["where", "when", "wherein"],
  si: ["if", "yes", "so"],
  là: ["there", "here", "over there"],
  suivre: ["to follow", "Follow me", "I'm following"],
  parler: ["to speak", "I speak French", "We need to talk"],
  prendre: ["to take", "Take it", "I'll take it"],
  cette: ["this woman", "this time", "this one"],
  votre: ["your house", "your book", "your friend"],
  quand: ["when", "whenever"],
  alors: ["so", "then", "well then"],
  chose: ["a thing", "something", "nothing"],
  par: ["by", "through", "per"],
  son: ["his/her book", "his/her house", "its"],
  ton: ["your book", "your house"],
  croire: ["to believe", "I believe you", "We believe"],
  aimer: ["to like", "I like it", "I love you"],
  falloir: ["it is necessary", "we must", "one must"],
  très: ["very", "really", "extremely"],
  ou: ["or", "either or"],
  quoi: ["what", "what's that?"],
  bon: ["good", "okay", "well"],
  passer: ["to pass", "to spend time", "Come in"],
  penser: ["to think", "I think so", "What do you think?"],
  aussi: ["also", "too", "as well"],
  jamais: ["never", "ever"],
  attendre: ["to wait", "Wait for me", "I'm waiting"],
  pourquoi: ["why", "why not?"],
  trouver: ["to find", "I found it", "We need to find"],
  laisser: ["to leave", "Let me", "Leave it"],
  sa: ["his/her", "its"],
  ta: ["your"],
  arriver: ["to arrive", "We arrived", "It happened"],
  ces: ["these", "those"],
  donner: ["to give", "Give me", "I'll give you"],
  regarder: ["to look", "Look at that", "I'm watching"],
  encore: ["again", "still", "yet"],
  appeler: ["to call", "Call me", "What's your name?"],
};

// Extended accepted forms for verbs (lemma + common conjugations)
const VERB_FORMS = {
  être: ["être", "suis", "es", "est", "sommes", "êtes", "sont", "été", "étais", "était", "étaient", "serai", "sera", "soit", "sois", "soyons", "soyez"],
  avoir: ["avoir", "ai", "as", "a", "avons", "avez", "ont", "eu", "avais", "avait", "avions", "aviez", "avaient", "aurai", "aura", "ait", "aie", "ayons", "ayez"],
  aller: ["aller", "vais", "vas", "va", "allons", "allez", "vont", "allé", "allait", "irai", "ira", "aille", "ailles", "aille"],
  faire: ["faire", "fais", "fait", "faisons", "faites", "font", "fait", "faisait", "ferai", "fera", "fasse", "fasses"],
  dire: ["dire", "dis", "dit", "disons", "dites", "disent", "disait", "dira", "dise", "dises"],
  pouvoir: ["pouvoir", "peux", "peut", "pouvons", "pouvez", "peuvent", "pu", "pouvait", "pourra", "puisse", "puisses"],
  vouloir: ["vouloir", "veux", "veut", "voulons", "voulez", "veulent", "voulu", "voulait", "voudra", "veuille", "veuilles"],
  savoir: ["savoir", "sais", "sait", "savons", "savez", "savent", "su", "savait", "saura", "sache", "saches"],
  venir: ["venir", "viens", "vient", "venons", "venez", "viennent", "venu", "venait", "viendra", "vienne", "viennes"],
  voir: ["voir", "vois", "voit", "voyons", "voyez", "voient", "vu", "voyait", "verra", "voie", "voies"],
  prendre: ["prendre", "prends", "prend", "prenons", "prenez", "prennent", "pris", "prenait", "prendra", "prenne", "prennes"],
  devoir: ["devoir", "dois", "doit", "devons", "devez", "doivent", "dû", "devait", "devra", "doive", "doives"],
  suivre: ["suivre", "suis", "suit", "suivons", "suivez", "suivent", "suivi", "suivait", "suira"],
  parler: ["parler", "parle", "parles", "parlons", "parlez", "parlent", "parlé", "parlait", "parlera"],
  croire: ["croire", "crois", "croit", "croyons", "croyez", "croient", "cru", "croyait", "croira", "croie", "croies"],
  aimer: ["aimer", "aime", "aimes", "aimons", "aimez", "aiment", "aimé", "aimait", "aimera"],
  falloir: ["falloir", "faut", "fallu", "faudra", "faudrait"],
  passer: ["passer", "passe", "passes", "passons", "passez", "passent", "passé", "passait", "passera"],
  penser: ["penser", "pense", "penses", "pensons", "pensez", "pensent", "pensé", "pensait", "pensera"],
  attendre: ["attendre", "attends", "attend", "attendons", "attendez", "attendent", "attendu", "attendait", "attendra"],
  trouver: ["trouver", "trouve", "trouves", "trouvons", "trouvez", "trouvent", "trouvé", "trouvait", "trouvera"],
  laisser: ["laisser", "laisse", "laisses", "laissons", "laissez", "laissent", "laissé", "laissait", "laissera"],
  arriver: ["arriver", "arrive", "arrives", "arrivons", "arrivez", "arrivent", "arrivé", "arrivait", "arrivera"],
  donner: ["donner", "donne", "donnes", "donnons", "donnez", "donnent", "donné", "donnait", "donnera"],
  regarder: ["regarder", "regarde", "regardes", "regardons", "regardez", "regardent", "regardé", "regardait", "regardera"],
  appeler: ["appeler", "appelle", "appelles", "appelons", "appelez", "appellent", "appelé", "appelait", "appellera"],
  connaître: ["connaître", "connais", "connaît", "connaissons", "connaissez", "connaissent", "connu", "connaissait"],
  comprendre: ["comprendre", "comprends", "comprend", "comprenons", "comprenez", "comprennent", "compris", "comprenait"],
};

function normalize(s) {
  return (s || '').trim().toLowerCase();
}

function parseCSV(content) {
  return content.split(/\r?\n/).filter(Boolean).map(line => line.split(','));
}

function getPrompts(lemme) {
  const key = normalize(lemme);
  if (PROMPTS_MAP[key]) return PROMPTS_MAP[key];
  return [`Say "${lemme}" in French`, `Translate: ${lemme}`, `How do you say ${lemme}?`];
}

function getAcceptedAnswers(lemme) {
  const key = normalize(lemme);
  if (VERB_FORMS[key]) return VERB_FORMS[key];
  return [lemme, key];
}

function main() {
  const content = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(content);
  const cards = [];
  let dataStart = 0;
  for (let i = 0; i < rows.length; i++) {
    const first = normalize(rows[i][0]);
    if (first === 'freq' || first === 'lemme') {
      dataStart = i + 1;
      break;
    }
    if (/^\d+$/.test(first)) {
      dataStart = i;
      break;
    }
  }
  for (let i = dataStart; i < Math.min(dataStart + 100, rows.length); i++) {
    const row = rows[i];
    const freq = parseInt(row[0], 10);
    const lemme = (row[1] || '').trim();
    if (!lemme || isNaN(freq)) continue;
    cards.push({
      id: `card-${freq}`,
      french: lemme,
      rank: freq,
      prompts: getPrompts(lemme),
      acceptedAnswers: getAcceptedAnswers(lemme),
    });
  }
  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cards, null, 2), 'utf8');
  console.log(`Wrote ${cards.length} cards to ${OUTPUT_PATH}`);
}

main();
