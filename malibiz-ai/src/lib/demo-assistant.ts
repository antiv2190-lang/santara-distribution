// Rule-based demo assistant. NO real AI is connected.
// Price/delay questions are unknown on purpose: a human must confirm them.
// It only answers from the fictional company info below.

export const COMPANY = {
  name: "BâtiSahel Construction (entreprise fictive)",
  facts: [
    "Située à Bamako, quartier ACI 2000.",
    "Ouverte du lundi au samedi, de 8h à 18h.",
    "Services : construction de villas, rénovation, clôtures, dallage, toiture.",
    "Devis gratuit après visite du terrain à Bamako.",
    "Contact : +223 20 00 00 00 (numéro fictif).",
  ],
};

const rules: { keys: string[]; answer: string }[] = [
  { keys: ["prix", "coût", "cout", "combien", "tarif", "délai", "delai"], answer: "" },
  { keys: ["horaire", "heure", "ouvert", "ferm"], answer: "BâtiSahel est ouverte du lundi au samedi, de 8h à 18h." },
  { keys: ["où", "adresse", "situé", "localis", "bureau"], answer: "Nos bureaux sont à Bamako, quartier ACI 2000." },
  { keys: ["service", "faites", "proposez", "travaux"], answer: "Nous proposons : construction de villas, rénovation, clôtures, dallage et toiture." },
  { keys: ["devis"], answer: "Le devis est gratuit, après une visite de votre terrain à Bamako." },
  { keys: ["contact", "téléphone", "telephone", "appeler", "numéro"], answer: "Vous pouvez nous joindre au +223 20 00 00 00 (numéro fictif de démonstration)." },
  { keys: ["villa", "maison"], answer: "Oui, nous construisons des villas. Une visite du terrain permet d'établir un devis gratuit." },
  { keys: ["toit", "toiture"], answer: "Oui, nous réalisons et réparons les toitures." },
  { keys: ["bonjour", "salut", "bonsoir"], answer: "Bonjour ! Je suis l'assistant de démonstration de BâtiSahel. Posez-moi une question sur nos services, horaires ou devis." },
];

export const UNKNOWN =
  "Je n'ai pas cette information. Un membre de l'équipe (humain) doit confirmer cette réponse. Laissez vos coordonnées via le formulaire de demande.";

export function answer(question: string): string {
  const q = question.toLowerCase();
  return rules.find((r) => r.keys.some((k) => q.includes(k)))?.answer || UNKNOWN;
}
