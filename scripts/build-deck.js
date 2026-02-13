/**
 * Build cards.json from words.csv - top 100 French lemmas with French fill-in-blank prompts.
 * Run: node scripts/build-deck.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '..', 'words.csv');
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'cards.json');

// Extended accepted forms for verbs (lemma + common conjugations)
const VERB_FORMS = {
  être: ['être', 'suis', 'es', 'est', 'sommes', 'êtes', 'sont', 'été', 'étais', 'était', 'étaient', 'serai', 'sera', 'soit', 'sois', 'soyons', 'soyez'],
  avoir: ['avoir', 'ai', 'as', 'a', 'avons', 'avez', 'ont', 'eu', 'avais', 'avait', 'avions', 'aviez', 'avaient', 'aurai', 'aura', 'ait', 'aie', 'ayons', 'ayez'],
  aller: ['aller', 'vais', 'vas', 'va', 'allons', 'allez', 'vont', 'allé', 'allait', 'irai', 'ira', 'aille', 'ailles'],
  faire: ['faire', 'fais', 'fait', 'faisons', 'faites', 'font', 'faisait', 'ferai', 'fera', 'fasse', 'fasses'],
  dire: ['dire', 'dis', 'dit', 'disons', 'dites', 'disent', 'disait', 'dira', 'dise', 'dises'],
  pouvoir: ['pouvoir', 'peux', 'peut', 'pouvons', 'pouvez', 'peuvent', 'pu', 'pouvait', 'pourra', 'puisse', 'puisses'],
  vouloir: ['vouloir', 'veux', 'veut', 'voulons', 'voulez', 'veulent', 'voulu', 'voulait', 'voudra', 'veuille', 'veuilles'],
  savoir: ['savoir', 'sais', 'sait', 'savons', 'savez', 'savent', 'su', 'savait', 'saura', 'sache', 'saches'],
  venir: ['venir', 'viens', 'vient', 'venons', 'venez', 'viennent', 'venu', 'venait', 'viendra', 'vienne', 'viennes'],
  voir: ['voir', 'vois', 'voit', 'voyons', 'voyez', 'voient', 'vu', 'voyait', 'verra', 'voie', 'voies'],
  prendre: ['prendre', 'prends', 'prend', 'prenons', 'prenez', 'prennent', 'pris', 'prenait', 'prendra', 'prenne', 'prennes'],
  devoir: ['devoir', 'dois', 'doit', 'devons', 'devez', 'doivent', 'dû', 'devait', 'devra', 'doive', 'doives'],
  suivre: ['suivre', 'suis', 'suit', 'suivons', 'suivez', 'suivent', 'suivi', 'suivait', 'suira'],
  parler: ['parler', 'parle', 'parles', 'parlons', 'parlez', 'parlent', 'parlé', 'parlait', 'parlera'],
  croire: ['croire', 'crois', 'croit', 'croyons', 'croyez', 'croient', 'cru', 'croyait', 'croira', 'croie', 'croies'],
  aimer: ['aimer', 'aime', 'aimes', 'aimons', 'aimez', 'aiment', 'aimé', 'aimait', 'aimera'],
  falloir: ['falloir', 'faut', 'fallu', 'faudra', 'faudrait'],
  passer: ['passer', 'passe', 'passes', 'passons', 'passez', 'passent', 'passé', 'passait', 'passera'],
  penser: ['penser', 'pense', 'penses', 'pensons', 'pensez', 'pensent', 'pensé', 'pensait', 'pensera'],
  attendre: ['attendre', 'attends', 'attend', 'attendons', 'attendez', 'attendent', 'attendu', 'attendait', 'attendra'],
  trouver: ['trouver', 'trouve', 'trouves', 'trouvons', 'trouvez', 'trouvent', 'trouvé', 'trouvait', 'trouvera'],
  laisser: ['laisser', 'laisse', 'laisses', 'laissons', 'laissez', 'laissent', 'laissé', 'laissait', 'laissera'],
  arriver: ['arriver', 'arrive', 'arrives', 'arrivons', 'arrivez', 'arrivent', 'arrivé', 'arrivait', 'arrivera'],
  donner: ['donner', 'donne', 'donnes', 'donnons', 'donnez', 'donnent', 'donné', 'donnait', 'donnera'],
  regarder: ['regarder', 'regarde', 'regardes', 'regardons', 'regardez', 'regardent', 'regardé', 'regardait', 'regardera'],
  appeler: ['appeler', 'appelle', 'appelles', 'appelons', 'appelez', 'appellent', 'appelé', 'appelait', 'appellera'],
};

// French fill-in-blank prompts: { sentence, hint, acceptedAnswers } per word
const FRENCH_BLANK_PROMPTS = {
  être: [
    { sentence: 'Je ___ fatigué', hint: 'be', acceptedAnswers: ['suis', 'étais', 'serai', 'sois'] },
    { sentence: 'Tu ___ français', hint: 'be', acceptedAnswers: ['es', 'étais', 'seras', 'sois'] },
    { sentence: 'Nous ___ ici', hint: 'be', acceptedAnswers: ['sommes', 'étions', 'serons', 'soyons'] },
    { sentence: 'Ils ___ contents', hint: 'be', acceptedAnswers: ['sont', 'étaient', 'seront', 'soient'] },
  ],
  je: [
    { sentence: '___ suis prêt', hint: 'I', acceptedAnswers: ['Je', 'je'] },
    { sentence: '___ veux partir', hint: 'I', acceptedAnswers: ['Je', 'je'] },
  ],
  de: [
    { sentence: 'Un morceau ___ gâteau', hint: 'of', acceptedAnswers: ['de', "d'"] },
    { sentence: 'Je viens ___ Paris', hint: 'from', acceptedAnswers: ['de', "d'"] },
    { sentence: 'La maison ___ mon ami', hint: 'of', acceptedAnswers: ['de', "d'"] },
  ],
  ne: [
    { sentence: 'Je ___ comprends pas', hint: 'not', acceptedAnswers: ['ne', "n'"] },
    { sentence: 'Elle ___ veut pas', hint: 'not', acceptedAnswers: ['ne', "n'"] },
  ],
  avoir: [
    { sentence: "J'___ un chien", hint: 'have', acceptedAnswers: ['ai', 'avais', 'aurai', 'aie'] },
    { sentence: 'Elle ___ du temps', hint: 'have', acceptedAnswers: ['a', 'avait', 'aura'] },
    { sentence: 'Tu ___ un stylo?', hint: 'have', acceptedAnswers: ['as', 'avais'] },
  ],
  pas: [
    { sentence: 'Je comprends ___.', hint: 'not', acceptedAnswers: ['pas'] },
    { sentence: 'Non, ___ encore', hint: 'not', acceptedAnswers: ['pas'] },
  ],
  la: [
    { sentence: '___ femme est belle', hint: 'the', acceptedAnswers: ['La', 'la'] },
    { sentence: '___ maison est grande', hint: 'the', acceptedAnswers: ['La', 'la'] },
  ],
  tu: [
    { sentence: '___ es gentil', hint: 'you', acceptedAnswers: ['Tu', 'tu'] },
    { sentence: '___ veux du café?', hint: 'you', acceptedAnswers: ['Tu', 'tu'] },
  ],
  le: [
    { sentence: '___ homme arrive', hint: 'the', acceptedAnswers: ["L'", "l'", 'Le', 'le'] },
    { sentence: '___ livre est intéressant', hint: 'the', acceptedAnswers: ['Le', 'le'] },
  ],
  vous: [
    { sentence: '___ êtes les bienvenus', hint: 'you', acceptedAnswers: ['Vous', 'vous'] },
    { sentence: '___ parlez français?', hint: 'you', acceptedAnswers: ['Vous', 'vous'] },
  ],
  il: [
    { sentence: '___ est ici', hint: 'he', acceptedAnswers: ['Il', 'il'] },
    { sentence: '___ pleut', hint: 'it', acceptedAnswers: ['Il', 'il'] },
  ],
  et: [
    { sentence: 'Du pain ___ du beurre', hint: 'and', acceptedAnswers: ['et'] },
    { sentence: 'Toi ___ moi', hint: 'and', acceptedAnswers: ['et'] },
  ],
  à: [
    { sentence: 'Je suis ___ la maison', hint: 'at', acceptedAnswers: ['à'] },
    { sentence: 'On va ___ Paris', hint: 'to', acceptedAnswers: ['à'] },
  ],
  un: [
    { sentence: '___ livre', hint: 'a', acceptedAnswers: ['un'] },
    { sentence: '___ jour', hint: 'one', acceptedAnswers: ['un'] },
  ],
  aller: [
    { sentence: 'Je ___ à la maison', hint: 'go', acceptedAnswers: ['vais', 'allais', 'irai'] },
    { sentence: "On ___ partir", hint: 'go', acceptedAnswers: ['va', 'allait', 'ira'] },
    { sentence: 'Tu ___ où?', hint: 'go', acceptedAnswers: ['vas', 'allais', 'iras'] },
  ],
  ça: [
    { sentence: '___ va bien', hint: 'that', acceptedAnswers: ['Ça', 'ça'] },
    { sentence: "C'est ___", hint: 'it', acceptedAnswers: ['ça'] },
  ],
  faire: [
    { sentence: 'Je ___ mes devoirs', hint: 'do', acceptedAnswers: ['fais', 'faisais', 'ferai'] },
    { sentence: 'Qu\'est-ce que tu ___?', hint: 'do', acceptedAnswers: ['fais', 'faisais'] },
    { sentence: 'On ___ le dîner', hint: 'make', acceptedAnswers: ['fait', 'faisait', 'fera'] },
  ],
  les: [
    { sentence: '___ enfants jouent', hint: 'the', acceptedAnswers: ['Les', 'les'] },
    { sentence: '___ livres sont là', hint: 'the', acceptedAnswers: ['Les', 'les'] },
  ],
  on: [
    { sentence: '___ y va', hint: 'we', acceptedAnswers: ['On', 'on'] },
    { sentence: '___ va voir', hint: 'we', acceptedAnswers: ['On', 'on'] },
  ],
  "l'": [
    { sentence: "___ avion part", hint: 'the', acceptedAnswers: ["L'", "l'"] },
    { sentence: "___ heure est venue", hint: 'the', acceptedAnswers: ["L'", "l'"] },
  ],
  une: [
    { sentence: '___ maison', hint: 'a', acceptedAnswers: ['une'] },
    { sentence: '___ idée', hint: 'an', acceptedAnswers: ['une'] },
  ],
  "d'": [
    { sentence: "Beaucoup ___ eau", hint: 'of', acceptedAnswers: ["d'", 'de'] },
    { sentence: "Je viens ___ ici", hint: 'from', acceptedAnswers: ["d'", 'de'] },
  ],
  pour: [
    { sentence: 'C\'est ___ toi', hint: 'for', acceptedAnswers: ['pour'] },
    { sentence: '___ le dessert', hint: 'for', acceptedAnswers: ['pour'] },
  ],
  des: [
    { sentence: '___ livres', hint: 'some', acceptedAnswers: ['des'] },
    { sentence: '___ amis', hint: 'some', acceptedAnswers: ['des'] },
  ],
  dire: [
    { sentence: 'Qu\'est-ce que tu ___?', hint: 'say', acceptedAnswers: ['dis', 'disais', 'diras'] },
    { sentence: 'On ___ que...', hint: 'say', acceptedAnswers: ['dit', 'disait', 'dira'] },
  ],
  en: [
    { sentence: '___ français', hint: 'in', acceptedAnswers: ['en'] },
    { sentence: '___ train', hint: 'by', acceptedAnswers: ['en'] },
  ],
  pouvoir: [
    { sentence: 'Je ___ t\'aider', hint: 'can', acceptedAnswers: ['peux', 'pouvais', 'pourrai'] },
    { sentence: 'Tu ___ venir?', hint: 'can', acceptedAnswers: ['peux', 'pouvais'] },
  ],
  qui: [
    { sentence: '___ est là?', hint: 'who', acceptedAnswers: ['Qui', 'qui'] },
    { sentence: 'L\'homme ___ parle', hint: 'who', acceptedAnswers: ['qui'] },
  ],
  vouloir: [
    { sentence: 'Je ___ du café', hint: 'want', acceptedAnswers: ['veux', 'voulais', 'voudrai'] },
    { sentence: 'Tu ___ venir?', hint: 'want', acceptedAnswers: ['veux', 'voulais'] },
  ],
  ce: [
    { sentence: '___ livre-ci', hint: 'this', acceptedAnswers: ['Ce', 'ce', 'cet'] },
    { sentence: '___ qu\'il faut', hint: 'what', acceptedAnswers: ['ce'] },
  ],
  mais: [
    { sentence: 'Oui, ___ je ne sais pas', hint: 'but', acceptedAnswers: ['mais'] },
    { sentence: '___ cependant', hint: 'but', acceptedAnswers: ['mais'] },
  ],
  me: [
    { sentence: 'Donne-___ le livre', hint: 'me', acceptedAnswers: ['moi', 'me', '-moi'] },
    { sentence: 'Il ___ l\'a dit', hint: 'me', acceptedAnswers: ['me', "m'"] },
  ],
  nous: [
    { sentence: '___ partons', hint: 'we', acceptedAnswers: ['Nous', 'nous'] },
    { sentence: 'Donne-___ ça', hint: 'us', acceptedAnswers: ['nous', '-nous'] },
  ],
  dans: [
    { sentence: '___ la maison', hint: 'in', acceptedAnswers: ['Dans', 'dans'] },
    { sentence: '___ 5 minutes', hint: 'in', acceptedAnswers: ['dans'] },
  ],
  elle: [
    { sentence: '___ est belle', hint: 'she', acceptedAnswers: ['Elle', 'elle'] },
    { sentence: '___ est prête', hint: 'it', acceptedAnswers: ['Elle', 'elle'] },
  ],
  savoir: [
    { sentence: 'Je ___', hint: 'know', acceptedAnswers: ['sais', 'savais', 'saurai'] },
    { sentence: 'Tu ___?', hint: 'know', acceptedAnswers: ['sais', 'savais'] },
  ],
  du: [
    { sentence: '___ pain', hint: 'some', acceptedAnswers: ['du'] },
    { sentence: 'Je veux ___ lait', hint: 'some', acceptedAnswers: ['du'] },
  ],
  y: [
    { sentence: 'Je ___ vais', hint: 'there', acceptedAnswers: ['y'] },
    { sentence: 'Il ___ a un problème', hint: 'there', acceptedAnswers: ['y'] },
  ],
  "t'": [
    { sentence: "Je ___ aime", hint: 'you', acceptedAnswers: ["t'", 'te'] },
    { sentence: "Je ___ l'ai dit", hint: 'you', acceptedAnswers: ["t'", 'te'] },
  ],
  bien: [
    { sentence: 'Très ___', hint: 'well', acceptedAnswers: ['bien'] },
    { sentence: '___ fait!', hint: 'well', acceptedAnswers: ['Bien', 'bien'] },
  ],
  voir: [
    { sentence: 'Je veux ___', hint: 'see', acceptedAnswers: ['voir', 'vu'] },
    { sentence: 'Laisse-moi ___', hint: 'see', acceptedAnswers: ['voir'] },
  ],
  que: [
    { sentence: 'Je pense ___ c\'est bon', hint: 'that', acceptedAnswers: ['que', 'qu\''] },
    { sentence: '___ dis-tu?', hint: 'what', acceptedAnswers: ['Que', 'que', 'Qu\''] },
  ],
  plus: [
    { sentence: '___ de sucre', hint: 'more', acceptedAnswers: ['plus'] },
    { sentence: 'Je ne ___ sais', hint: 'no more', acceptedAnswers: ['plus'] },
  ],
  non: [
    { sentence: '___, merci', hint: 'no', acceptedAnswers: ['Non', 'non'] },
    { sentence: '___, pas du tout', hint: 'no', acceptedAnswers: ['Non', 'non'] },
  ],
  te: [
    { sentence: 'Je ___ le dis', hint: 'you', acceptedAnswers: ['te', "t'"] },
    { sentence: 'Je ___ cherche', hint: 'you', acceptedAnswers: ['te', "t'"] },
  ],
  mon: [
    { sentence: '___ ami', hint: 'my', acceptedAnswers: ['mon'] },
    { sentence: '___ livre', hint: 'my', acceptedAnswers: ['mon'] },
  ],
  au: [
    { sentence: '___ revoir', hint: 'to the', acceptedAnswers: ['au'] },
    { sentence: 'Je vais ___ marché', hint: 'to the', acceptedAnswers: ['au'] },
  ],
  avec: [
    { sentence: '___ moi', hint: 'with', acceptedAnswers: ['Avec', 'avec'] },
    { sentence: '___ du sucre', hint: 'with', acceptedAnswers: ['avec'] },
  ],
  moi: [
    { sentence: 'Donne à ___', hint: 'me', acceptedAnswers: ['moi'] },
    { sentence: 'Viens ___', hint: 'me', acceptedAnswers: ['avec moi'] },
  ],
  devoir: [
    { sentence: 'Je ___ partir', hint: 'must', acceptedAnswers: ['dois', 'devais', 'devrai'] },
    { sentence: 'Tu ___ te reposer', hint: 'should', acceptedAnswers: ['dois', 'devais'] },
  ],
  oui: [
    { sentence: '___, merci', hint: 'yes', acceptedAnswers: ['Oui', 'oui'] },
    { sentence: '___, bien sûr', hint: 'yes', acceptedAnswers: ['Oui', 'oui'] },
  ],
  ils: [
    { sentence: '___ sont là', hint: 'they', acceptedAnswers: ['Ils', 'ils'] },
    { sentence: '___ veulent partir', hint: 'they', acceptedAnswers: ['Ils', 'ils'] },
  ],
  tout: [
    { sentence: '___ va bien', hint: 'all', acceptedAnswers: ['Tout', 'tout'] },
    { sentence: '___ le monde', hint: 'all', acceptedAnswers: ['tout'] },
  ],
  se: [
    { sentence: 'Il ___ repose', hint: 'himself', acceptedAnswers: ['se', "s'"] },
    { sentence: 'Elle ___ lève', hint: 'herself', acceptedAnswers: ['se', "s'"] },
  ],
  venir: [
    { sentence: '___ ici!', hint: 'come', acceptedAnswers: ['Viens', 'viens', 'venez'] },
    { sentence: 'Il va ___', hint: 'come', acceptedAnswers: ['venir', 'venu'] },
  ],
  sur: [
    { sentence: '___ la table', hint: 'on', acceptedAnswers: ['Sur', 'sur'] },
    { sentence: 'Un livre ___ le français', hint: 'about', acceptedAnswers: ['sur'] },
  ],
  toi: [
    { sentence: 'C\'est pour ___', hint: 'you', acceptedAnswers: ['toi'] },
    { sentence: 'Et ___?', hint: 'you', acceptedAnswers: ['toi'] },
  ],
  "s'": [
    { sentence: "Il ___ appelle Jean", hint: 'himself', acceptedAnswers: ["s'", 'se'] },
    { sentence: "Elle ___ en va", hint: 'herself', acceptedAnswers: ["s'", 'se'] },
  ],
  ici: [
    { sentence: 'Viens ___', hint: 'here', acceptedAnswers: ['ici'] },
    { sentence: '___ et maintenant', hint: 'here', acceptedAnswers: ['Ici', 'ici'] },
  ],
  rien: [
    { sentence: '___ du tout', hint: 'nothing', acceptedAnswers: ['Rien', 'rien'] },
    { sentence: 'Il n\'y a ___', hint: 'nothing', acceptedAnswers: ['rien'] },
  ],
  ma: [
    { sentence: '___ maison', hint: 'my', acceptedAnswers: ['ma'] },
    { sentence: '___ mère', hint: 'my', acceptedAnswers: ['ma'] },
  ],
  comme: [
    { sentence: '___ ça', hint: 'like', acceptedAnswers: ['Comme', 'comme'] },
    { sentence: '___ toujours', hint: 'as', acceptedAnswers: ['comme'] },
  ],
  lui: [
    { sentence: 'Donne-___ le livre', hint: 'him', acceptedAnswers: ['lui'] },
    { sentence: 'Je pense à ___', hint: 'him', acceptedAnswers: ['lui'] },
  ],
  où: [
    { sentence: '___ vas-tu?', hint: 'where', acceptedAnswers: ['Où', 'où'] },
    { sentence: 'Le jour ___ j\'ai vu', hint: 'when', acceptedAnswers: ['où'] },
  ],
  si: [
    { sentence: '___ tu veux', hint: 'if', acceptedAnswers: ['Si', 'si'] },
    { sentence: '___, c\'est vrai', hint: 'yes', acceptedAnswers: ['Si', 'si'] },
  ],
  là: [
    { sentence: 'Il est ___', hint: 'there', acceptedAnswers: ['là'] },
    { sentence: '___ -bas', hint: 'there', acceptedAnswers: ['là'] },
  ],
  suivre: [
    { sentence: '___ -moi', hint: 'follow', acceptedAnswers: ['Suis', 'suis', 'suivez'] },
    { sentence: 'Je te ___', hint: 'follow', acceptedAnswers: ['suis', 'suivais', 'suivrai'] },
  ],
  parler: [
    { sentence: 'Je ___ français', hint: 'speak', acceptedAnswers: ['parle', 'parlais', 'parlerai'] },
    { sentence: 'On doit ___', hint: 'talk', acceptedAnswers: ['parler', 'parlé'] },
  ],
  prendre: [
    { sentence: '___ -le', hint: 'take', acceptedAnswers: ['Prends', 'prends', 'prenez'] },
    { sentence: 'Je vais ___', hint: 'take', acceptedAnswers: ['prendre', 'pris'] },
  ],
  cette: [
    { sentence: '___ femme', hint: 'this', acceptedAnswers: ['Cette', 'cette'] },
    { sentence: '___ fois', hint: 'this', acceptedAnswers: ['cette'] },
  ],
  votre: [
    { sentence: '___ maison', hint: 'your', acceptedAnswers: ['Votre', 'votre'] },
    { sentence: '___ livre', hint: 'your', acceptedAnswers: ['votre'] },
  ],
  quand: [
    { sentence: '___ tu viens?', hint: 'when', acceptedAnswers: ['Quand', 'quand'] },
    { sentence: '___ il pleut', hint: 'when', acceptedAnswers: ['quand'] },
  ],
  alors: [
    { sentence: '___ on y va', hint: 'then', acceptedAnswers: ['Alors', 'alors'] },
    { sentence: '___ comme ça', hint: 'so', acceptedAnswers: ['alors'] },
  ],
  chose: [
    { sentence: 'Une ___', hint: 'thing', acceptedAnswers: ['chose'] },
    { sentence: 'Quelque ___', hint: 'thing', acceptedAnswers: ['chose'] },
  ],
  par: [
    { sentence: '___ la fenêtre', hint: 'through', acceptedAnswers: ['par'] },
    { sentence: '___ jour', hint: 'per', acceptedAnswers: ['par'] },
  ],
  son: [
    { sentence: '___ livre', hint: 'his/her', acceptedAnswers: ['son'] },
    { sentence: '___ nom', hint: 'his/her', acceptedAnswers: ['son'] },
  ],
  ton: [
    { sentence: '___ livre', hint: 'your', acceptedAnswers: ['ton'] },
    { sentence: '___ nom', hint: 'your', acceptedAnswers: ['ton'] },
  ],
  croire: [
    { sentence: 'Je te ___', hint: 'believe', acceptedAnswers: ['crois', 'croyais', 'croirai'] },
    { sentence: 'On doit ___', hint: 'believe', acceptedAnswers: ['croire', 'cru'] },
  ],
  aimer: [
    { sentence: 'Je ___ ça', hint: 'like', acceptedAnswers: ['aime', 'aimais', 'aimerai'] },
    { sentence: 'Je t\'___', hint: 'love', acceptedAnswers: ['aime', 'aimais'] },
  ],
  falloir: [
    { sentence: 'Il ___ partir', hint: 'must', acceptedAnswers: ['faut', 'fallait', 'faudra'] },
    { sentence: 'Il ___ que...', hint: 'necessary', acceptedAnswers: ['faut', 'fallait'] },
  ],
  très: [
    { sentence: '___ bien', hint: 'very', acceptedAnswers: ['Très', 'très'] },
    { sentence: '___ bon', hint: 'very', acceptedAnswers: ['très'] },
  ],
  ou: [
    { sentence: 'Toi ___ moi', hint: 'or', acceptedAnswers: ['ou'] },
    { sentence: 'Café ___ thé?', hint: 'or', acceptedAnswers: ['ou'] },
  ],
  quoi: [
    { sentence: '___ de neuf?', hint: 'what', acceptedAnswers: ['Quoi', 'quoi'] },
    { sentence: 'C\'est ___?', hint: 'what', acceptedAnswers: ['quoi'] },
  ],
  bon: [
    { sentence: '___ jour!', hint: 'good', acceptedAnswers: ['Bon', 'bon'] },
    { sentence: 'C\'est ___', hint: 'good', acceptedAnswers: ['bon'] },
  ],
  passer: [
    { sentence: 'Je ___ te voir', hint: 'pass', acceptedAnswers: ['passe', 'passais', 'passerai'] },
    { sentence: 'Viens ___', hint: 'come in', acceptedAnswers: ['passer', 'passé'] },
  ],
  penser: [
    { sentence: 'Je ___ que oui', hint: 'think', acceptedAnswers: ['pense', 'pensais', 'penserai'] },
    { sentence: 'Tu ___ quoi?', hint: 'think', acceptedAnswers: ['penses', 'pensais'] },
  ],
  aussi: [
    { sentence: 'Moi ___', hint: 'also', acceptedAnswers: ['aussi'] },
    { sentence: '___ bien', hint: 'also', acceptedAnswers: ['aussi'] },
  ],
  jamais: [
    { sentence: '___ de la vie', hint: 'never', acceptedAnswers: ['Jamais', 'jamais'] },
    { sentence: 'Tu n\'___?', hint: 'ever', acceptedAnswers: ['jamais'] },
  ],
  attendre: [
    { sentence: '___ -moi', hint: 'wait', acceptedAnswers: ['Attends', 'attends', 'attendez'] },
    { sentence: "J'___ depuis longtemps", hint: 'wait', acceptedAnswers: ['attends', 'attendais'] },
  ],
  pourquoi: [
    { sentence: '___ pas?', hint: 'why', acceptedAnswers: ['Pourquoi', 'pourquoi'] },
    { sentence: '___ tu viens?', hint: 'why', acceptedAnswers: ['Pourquoi', 'pourquoi'] },
  ],
  trouver: [
    { sentence: 'J\'ai ___', hint: 'find', acceptedAnswers: ['trouvé', 'trouvais'] },
    { sentence: 'On doit ___', hint: 'find', acceptedAnswers: ['trouver', 'trouvé'] },
  ],
  laisser: [
    { sentence: '___ -moi', hint: 'let', acceptedAnswers: ['Laisse', 'laisse', 'laissez'] },
    { sentence: 'Je vais ___', hint: 'leave', acceptedAnswers: ['laisser', 'laissé'] },
  ],
  sa: [
    { sentence: '___ maison', hint: 'his/her', acceptedAnswers: ['sa'] },
    { sentence: '___ main', hint: 'his/her', acceptedAnswers: ['sa'] },
  ],
  ta: [
    { sentence: '___ maison', hint: 'your', acceptedAnswers: ['ta'] },
    { sentence: '___ main', hint: 'your', acceptedAnswers: ['ta'] },
  ],
  arriver: [
    { sentence: 'On va ___', hint: 'arrive', acceptedAnswers: ['arriver', 'arrivé'] },
    { sentence: 'Il peut ___', hint: 'happen', acceptedAnswers: ['arriver', 'arrivé'] },
  ],
  ces: [
    { sentence: '___ livres', hint: 'these', acceptedAnswers: ['Ces', 'ces'] },
    { sentence: '___ gens', hint: 'these', acceptedAnswers: ['ces'] },
  ],
  donner: [
    { sentence: 'Donne-___', hint: 'give', acceptedAnswers: ['moi', '-moi'] },
    { sentence: 'Je vais ___', hint: 'give', acceptedAnswers: ['donner', 'donné'] },
  ],
  regarder: [
    { sentence: '___ ça', hint: 'look', acceptedAnswers: ['Regarde', 'regarde', 'regardez'] },
    { sentence: 'Je ___ la télé', hint: 'watch', acceptedAnswers: ['regarde', 'regardais'] },
  ],
  encore: [
    { sentence: 'Une fois ___', hint: 'again', acceptedAnswers: ['encore'] },
    { sentence: '___ un peu', hint: 'more', acceptedAnswers: ['encore'] },
  ],
  appeler: [
    { sentence: '___ -moi', hint: 'call', acceptedAnswers: ['Appelle', 'appelle', 'appelez'] },
    { sentence: 'Comment tu t\'___?', hint: 'call', acceptedAnswers: ['appelles', 'appelais'] },
  ],
};

function normalize(s) {
  return (s || '').trim().toLowerCase();
}

function parseCSV(content) {
  return content.split(/\r?\n/).filter(Boolean).map((line) => line.split(','));
}

function getPrompts(lemme) {
  const key = normalize(lemme);
  if (FRENCH_BLANK_PROMPTS[key]) return FRENCH_BLANK_PROMPTS[key];
  return [{ sentence: `___`, hint: lemme, acceptedAnswers: [lemme] }];
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
    const prompts = getPrompts(lemme);
    cards.push({
      id: `card-${freq}`,
      french: lemme,
      rank: freq,
      prompts,
    });
  }
  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cards, null, 2), 'utf8');
  console.log(`Wrote ${cards.length} cards to ${OUTPUT_PATH}`);
}

main();
