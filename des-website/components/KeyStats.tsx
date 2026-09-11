"use client";

import { keyStats } from "@/lib/data";
import { AnimatedCounter } from "./ui/AnimatedCounter";
import { Reveal, RevealGroup, RevealItem } from "./ui/Reveal";

export function KeyStats() {
  return (
    <section id="chiffres" className="relative border-y border-white/[0.06] bg-ink-900/60 py-20 md:py-28">
      <div className="container-des">
        <Reveal className="mx-auto mb-14 max-w-xl text-center">
          <span className="text-[12.5px] font-semibold uppercase tracking-[0.18em] text-solar-400">
            Impact mesurable
          </span>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-mist-50 md:text-4xl">
            Une échelle continentale
          </h2>
        </Reveal>

        <RevealGroup className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.07] md:grid-cols-4">
          {keyStats.map((stat) => (
            <RevealItem key={stat.label} className="bg-ink-900 px-6 py-10 text-center md:px-8 md:py-12">
              <div className="font-display text-4xl font-semibold tracking-tight text-mist-50 md:text-5xl">
                <AnimatedCounter value={stat.value} suffix={stat.suffix} />
              </div>
              <p className="mt-3 text-[13px] leading-snug text-mist-300">{stat.label}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
