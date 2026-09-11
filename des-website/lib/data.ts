export type Stat = {
  value: number;
  suffix: string;
  label: string;
  decimals?: number;
};

export const keyStats: Stat[] = [
  { value: 340, suffix: " MWc", label: "Capacité solaire installée" },
  { value: 180, suffix: " MWh", label: "Stockage lithium déployé" },
  { value: 62, suffix: "", label: "Postes de transformation livrés" },
  { value: 8, suffix: "", label: "Pays couverts en région AES" },
];

export type Solution = {
  id: string;
  tag: string;
  title: string;
  description: string;
  bullets: string[];
  accent: "solar" | "volt" | "arc";
};

export const solutions: Solution[] = [
  {
    id: "solaire",
    tag: "01 — Production",
    title: "Solaire photovoltaïque",
    description:
      "Centrales solaires au sol et toitures industrielles dimensionnées pour les réseaux et les sites isolés de la région AES, du dimensionnement à la mise en service.",
    bullets: [
      "Centrales de 1 à 100+ MWc, EPC intégral",
      "Études d'irradiation et de foncier",
      "Supervision SCADA et monitoring temps réel",
    ],
    accent: "solar",
  },
  {
    id: "stockage",
    tag: "02 — Stockage",
    title: "Batteries lithium (BESS)",
    description:
      "Systèmes de stockage par batteries lithium-fer-phosphate conçus pour le climat sahélien, garantissant stabilité du réseau et autonomie énergétique.",
    bullets: [
      "Conteneurs BESS haute densité, cyclage 6000+",
      "Gestion thermique adaptée au climat sahélien",
      "Couplage solaire + stockage clé en main",
    ],
    accent: "volt",
  },
  {
    id: "transformateurs",
    tag: "03 — Transport",
    title: "Transformateurs électriques",
    description:
      "Fabrication, fourniture et maintenance de transformateurs de puissance et de distribution pour les opérateurs publics et industriels de la région.",
    bullets: [
      "Transformateurs 15 kV à 225 kV",
      "Maintenance préventive et diagnostics DGA",
      "Postes clé en main et génie électrique",
    ],
    accent: "arc",
  },
];

export type AesCountry = {
  code: string;
  name: string;
  projects: number;
  capacity: string;
  status: "Actif" | "En déploiement" | "Étude";
};

export const aesCountries: AesCountry[] = [
  { code: "ML", name: "Mali", projects: 14, capacity: "96 MWc", status: "Actif" },
  { code: "BF", name: "Burkina Faso", projects: 9, capacity: "58 MWc", status: "Actif" },
  { code: "NE", name: "Niger", projects: 7, capacity: "41 MWc", status: "Actif" },
  { code: "SN", name: "Sénégal", projects: 6, capacity: "34 MWc", status: "En déploiement" },
  { code: "CI", name: "Côte d'Ivoire", projects: 5, capacity: "29 MWc", status: "En déploiement" },
  { code: "GN", name: "Guinée", projects: 3, capacity: "18 MWc", status: "Étude" },
  { code: "BJ", name: "Bénin", projects: 2, capacity: "12 MWc", status: "Étude" },
  { code: "TG", name: "Togo", projects: 2, capacity: "9 MWc", status: "Étude" },
];

export const processSteps = [
  {
    step: "01",
    title: "Étude & faisabilité",
    description:
      "Analyse technique, financière et foncière — irradiation, charge réseau, contraintes réglementaires locales.",
  },
  {
    step: "02",
    title: "Ingénierie (EPC)",
    description:
      "Conception détaillée, approvisionnement et construction par nos équipes d'ingénieurs certifiés.",
  },
  {
    step: "03",
    title: "Déploiement",
    description:
      "Installation, mise en service et intégration réseau avec supervision SCADA en temps réel.",
  },
  {
    step: "04",
    title: "Exploitation & maintenance",
    description:
      "Contrats O&M long terme, maintenance préventive et support technique 24/7 sur site.",
  },
];

export const partners = [
  "SOGEM",
  "EDM-SA",
  "SONABEL",
  "NIGELEC",
  "BOAD",
  "BIDC",
  "Banque Mondiale",
  "AFD",
];
