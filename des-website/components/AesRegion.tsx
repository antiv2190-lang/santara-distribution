"use client";

import { motion } from "framer-motion";
import { MapPin } from "lucide-react";
import { aesCountries } from "@/lib/data";
import { Reveal, RevealGroup, RevealItem } from "./ui/Reveal";

const statusStyles: Record<string, string> = {
  Actif: "bg-volt-500/15 text-volt-400 border-volt-500/25",
  "En déploiement": "bg-arc-500/15 text-arc-400 border-arc-500/25",
  Étude: "bg-mist-400/15 text-mist-200 border-mist-400/25",
};

export function AesRegion() {
  return (
    <section id="region-aes" className="relative border-y border-white/[0.06] bg-ink-900/60 py-24 md:py-32">
      <div className="container-des">
        <div className="mb-16 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <Reveal>
            <span className="text-[12.5px] font-semibold uppercase tracking-[0.18em] text-solar-400">
              Empreinte régionale
            </span>
            <h2 className="mt-3 max-w-lg font-display text-3xl font-semibold tracking-tight text-mist-50 md:text-4xl">
              Présents dans 8 pays de la région AES
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="max-w-sm text-[14.5px] leading-relaxed text-mist-300">
              Alliance des États du Sahel et Afrique de l&apos;Ouest élargie — un
              portefeuille de projets actifs, en déploiement et à l&apos;étude.
            </p>
          </Reveal>
        </div>

        <RevealGroup
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          stagger={0.08}
        >
          {aesCountries.map((c) => (
            <RevealItem key={c.code}>
              <motion.div
                whileHover={{ y: -4, scale: 1.015 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="group relative overflow-hidden rounded-2xl panel p-5"
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[11px] font-bold tracking-wide text-mist-100">
                    {c.code}
                  </div>
                  <MapPin className="h-4 w-4 text-mist-400 transition-colors group-hover:text-solar-400" />
                </div>

                <h3 className="mt-4 font-display text-base font-semibold text-mist-50">
                  {c.name}
                </h3>

                <div className="mt-3 flex items-center justify-between text-[12px] text-mist-300">
                  <span>{c.projects} projets</span>
                  <span className="font-medium text-mist-100">{c.capacity}</span>
                </div>

                <span
                  className={`mt-4 inline-flex items-center rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${statusStyles[c.status]}`}
                >
                  {c.status}
                </span>
              </motion.div>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
