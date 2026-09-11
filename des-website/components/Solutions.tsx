"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, Check } from "lucide-react";
import { solutions } from "@/lib/data";
import { Reveal, RevealGroup, RevealItem } from "./ui/Reveal";
import { SolutionArt } from "./ui/SolutionArt";

const accentStyles = {
  solar: {
    tag: "text-solar-400",
    ring: "group-hover:shadow-glow-solar",
    border: "hover:border-solar-500/30",
  },
  volt: {
    tag: "text-volt-400",
    ring: "group-hover:shadow-glow-volt",
    border: "hover:border-volt-500/30",
  },
  arc: {
    tag: "text-arc-400",
    ring: "group-hover:shadow-[0_0_40px_-8px_rgba(56,189,248,0.4)]",
    border: "hover:border-arc-500/30",
  },
} as const;

export function Solutions() {
  return (
    <section id="solutions" className="relative py-24 md:py-32">
      <div className="container-des">
        <div className="mb-16 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <Reveal>
            <span className="text-[12.5px] font-semibold uppercase tracking-[0.18em] text-solar-400">
              Nos solutions
            </span>
            <h2 className="mt-3 max-w-lg font-display text-3xl font-semibold tracking-tight text-mist-50 md:text-4xl">
              Trois piliers d&apos;infrastructure, une seule chaîne de valeur
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="max-w-sm text-[14.5px] leading-relaxed text-mist-300">
              De la production à la distribution, DES intègre l&apos;ensemble de la
              chaîne énergétique pour ses partenaires publics et privés.
            </p>
          </Reveal>
        </div>

        <RevealGroup className="grid gap-5 md:grid-cols-3" stagger={0.15}>
          {solutions.map((s) => {
            const style = accentStyles[s.accent];
            return (
              <RevealItem key={s.id}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className={`group relative flex h-full flex-col overflow-hidden rounded-3xl panel p-7 transition-colors ${style.border}`}
                >
                  <div
                    className={`absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${style.ring}`}
                  />
                  <span className={`text-[11.5px] font-semibold uppercase tracking-[0.16em] ${style.tag}`}>
                    {s.tag}
                  </span>

                  <div className="my-6 rounded-2xl border border-white/[0.06] bg-black/20 p-4">
                    <SolutionArt variant={s.accent} />
                  </div>

                  <h3 className="font-display text-xl font-semibold tracking-tight text-mist-50">
                    {s.title}
                  </h3>
                  <p className="mt-3 text-[13.5px] leading-relaxed text-mist-300">
                    {s.description}
                  </p>

                  <ul className="mt-5 space-y-2.5">
                    {s.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-[13px] text-mist-200">
                        <Check className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${style.tag}`} />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>

                  <a
                    href="#contact"
                    className="mt-7 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-mist-50"
                  >
                    En savoir plus
                    <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </a>
                </motion.div>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
