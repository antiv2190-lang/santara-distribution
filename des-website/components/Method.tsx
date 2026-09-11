"use client";

import { processSteps } from "@/lib/data";
import { Reveal, RevealGroup, RevealItem } from "./ui/Reveal";

export function Method() {
  return (
    <section id="methode" className="relative py-24 md:py-32">
      <div className="container-des">
        <Reveal className="mx-auto mb-16 max-w-xl text-center">
          <span className="text-[12.5px] font-semibold uppercase tracking-[0.18em] text-solar-400">
            Notre méthode
          </span>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-mist-50 md:text-4xl">
            Du terrain à la mise en service
          </h2>
        </Reveal>

        <RevealGroup className="relative grid gap-6 md:grid-cols-4" stagger={0.12}>
          <div className="pointer-events-none absolute left-0 right-0 top-[38px] hidden h-px bg-gradient-to-r from-transparent via-white/15 to-transparent md:block" />
          {processSteps.map((step) => (
            <RevealItem key={step.step} className="relative">
              <div className="relative z-10 flex flex-col">
                <div className="flex h-[76px] w-[76px] items-center justify-center rounded-2xl panel font-display text-2xl font-semibold text-solar-400">
                  {step.step}
                </div>
                <h3 className="mt-5 font-display text-[17px] font-semibold text-mist-50">
                  {step.title}
                </h3>
                <p className="mt-2.5 text-[13.5px] leading-relaxed text-mist-300">
                  {step.description}
                </p>
              </div>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
