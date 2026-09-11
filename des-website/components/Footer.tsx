import { Zap, Linkedin, Twitter, Facebook } from "lucide-react";

const columns = [
  {
    title: "Solutions",
    links: ["Solaire photovoltaïque", "Stockage lithium (BESS)", "Transformateurs", "Maintenance O&M"],
  },
  {
    title: "Entreprise",
    links: ["À propos de DES", "Région AES", "Carrières", "Presse"],
  },
  {
    title: "Ressources",
    links: ["Études de cas", "Certifications", "Conformité HSE", "Contact"],
  },
];

export function Footer() {
  return (
    <footer className="relative border-t border-white/[0.06] bg-ink-950 pb-10 pt-20">
      <div className="container-des">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <a href="#top" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-solar-400 to-solar-600">
                <Zap className="h-[18px] w-[18px] text-ink-950" strokeWidth={2.5} />
              </span>
              <span className="font-display text-[15px] font-semibold tracking-tight text-mist-50">
                DES <span className="text-mist-300 font-normal">| Diawara Énergies</span>
              </span>
            </a>
            <p className="mt-5 max-w-xs text-[13.5px] leading-relaxed text-mist-400">
              Infrastructures énergétiques de premier plan pour la région AES — solaire,
              stockage lithium et transformateurs électriques.
            </p>
            <div className="mt-6 flex items-center gap-3">
              {[Linkedin, Twitter, Facebook].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  className="flex h-9 w-9 items-center justify-center rounded-lg panel text-mist-300 transition-colors hover:text-mist-50"
                  aria-label="Réseau social"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((col) => (
              <div key={col.title}>
                <h4 className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-mist-200">
                  {col.title}
                </h4>
                <ul className="mt-4 space-y-3">
                  {col.links.map((l) => (
                    <li key={l}>
                      <a href="#" className="text-[13.5px] text-mist-400 transition-colors hover:text-mist-100">
                        {l}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-white/[0.06] pt-8 sm:flex-row">
          <p className="text-[12.5px] text-mist-400">
            © {new Date().getFullYear()} Diawara Énergies S.A.S. Tous droits réservés.
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-[12.5px] text-mist-400 hover:text-mist-100">
              Confidentialité
            </a>
            <a href="#" className="text-[12.5px] text-mist-400 hover:text-mist-100">
              Mentions légales
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
