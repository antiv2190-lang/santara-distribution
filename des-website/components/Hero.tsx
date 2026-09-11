"use client";

import { motion } from "framer-motion";
import { ArrowRight, ChevronDown, Sun, BatteryCharging, GitBranch } from "lucide-react";
import { HeroBackdrop } from "./ui/HeroBackdrop";

const headline = ["Ingénierie", "énergétique", "pour l'Afrique", "de l'Ouest."];

const chipData = [
  { icon: Sun, label: "340 MWc solaire", top: "18%", left: "6%", delay: 0.9 },
  { icon: BatteryCharging, label: "180 MWh stockés", top: "62%", left: "2%", delay: 1.1 },
  { icon: GitBranch, label: "62 postes livrés", top: "40%", left: "84%", delay: 1.3 },
];

export function Hero() {
  return (
    <section id="top" className="relative flex min-h-[100svh] items-center overflow-hidden pt-28">
      <HeroBackdrop />

      {chipData.map((c, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: c.delay, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none absolute z-10 hidden animate-float items-center gap-2 rounded-full panel px-4 py-2.5 shadow-glow md:flex"
          style={{ top: c.top, left: c.left, animationDelay: `${i * 0.6}s` }}
        >
          <c.icon className="h-4 w-4 text-solar-400" />
          <span className="whitespace-nowrap text-[12.5px] font-medium text-mist-100">
            {c.label}
          </span>
        </motion.div>
      ))}

      <div className="container-des relative z-10">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full panel px-4 py-1.5"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-volt-400 shadow-glow-volt" />
            <span className="text-[12.5px] font-medium text-mist-200">
              Diawara Énergies S.A.S. — Région AES
            </span>
          </motion.div>

          <h1 className="font-display text-balance text-[13vw] font-semibold leading-[1.02] tracking-[-0.03em] text-mist-50 sm:text-6xl md:text-7xl lg:text-[5.5rem]">
            {headline.map((word, i) => (
              <span key={word} className="inline-block overflow-hidden pb-1 pr-3 align-top">
                <motion.span
                  initial={{ y: "110%" }}
                  animate={{ y: "0%" }}
                  transition={{
                    duration: 0.9,
                    delay: 0.15 + i * 0.09,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className={`inline-block ${i === 1 ? "gradient-text" : ""}`}
                >
                  {word}
                </motion.span>
              </span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.65 }}
            className="mx-auto mt-7 max-w-2xl text-balance text-[15.5px] leading-relaxed text-mist-300 md:text-[17px]"
          >
            DES conçoit, finance et déploie des centrales solaires, des systèmes de
            stockage par batteries lithium et des transformateurs électriques pour les
            opérateurs publics, industriels et investisseurs de la région AES.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.8 }}
            className="mt-10 flex flex-col items-center justify-center gap-3.5 sm:flex-row"
          >
            <a
              href="#contact"
              className="group inline-flex items-center gap-2 rounded-full bg-mist-50 px-7 py-3.5 text-[14px] font-semibold text-ink-950 transition-transform hover:scale-[1.03] active:scale-[0.98]"
            >
              Demander une étude
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="#solutions"
              className="inline-flex items-center gap-2 rounded-full panel px-7 py-3.5 text-[14px] font-semibold text-mist-100 transition-colors hover:bg-white/[0.07]"
            >
              Découvrir nos solutions
            </a>
          </motion.div>
        </div>
      </div>

      <motion.a
        href="#chiffres"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 0.6 }}
        className="absolute bottom-8 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-2 text-mist-400 md:flex"
      >
        <span className="text-[11px] font-medium uppercase tracking-[0.2em]">Explorer</span>
        <motion.span
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </motion.a>
    </section>
  );
}
