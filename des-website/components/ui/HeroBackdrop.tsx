"use client";

import { motion } from "framer-motion";

export function HeroBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-ink-950" />
      <div className="absolute inset-0 bg-grid-fine bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_20%,black,transparent)]" />
      <div className="absolute inset-0 bg-radial-fade" />

      <motion.div
        aria-hidden
        className="absolute -top-40 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-solar-500/20 blur-[120px]"
        animate={{ opacity: [0.5, 0.8, 0.5], scale: [1, 1.08, 1] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute top-1/3 -right-24 h-[420px] w-[420px] rounded-full bg-volt-500/15 blur-[110px]"
        animate={{ opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 11, repeat: Infinity, ease: "easeInOut", delay: 1 }}
      />
      <motion.div
        aria-hidden
        className="absolute bottom-0 -left-24 h-[380px] w-[380px] rounded-full bg-arc-500/10 blur-[110px]"
        animate={{ opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
      />

      <svg
        className="absolute inset-x-0 bottom-0 h-[46%] w-full opacity-[0.35]"
        viewBox="0 0 1200 300"
        preserveAspectRatio="none"
        fill="none"
      >
        <motion.path
          d="M0 220 L120 220 L150 160 L210 160 L235 260 L300 260 L330 120 L420 120 L450 200 L560 200 L590 90 L640 90 L665 220 L760 220 L790 150 L900 150 L925 240 L1030 240 L1060 100 L1200 100"
          stroke="#F5B84C"
          strokeWidth={1.5}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.7 }}
          transition={{ duration: 2.4, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
        />
        <motion.path
          d="M0 260 L90 260 L120 210 L200 210 L225 280 L310 280 L340 190 L460 190 L490 250 L610 250 L640 170 L720 170 L750 270 L860 270 L890 200 L1000 200 L1030 260 L1200 260"
          stroke="#3EE3A6"
          strokeWidth={1}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.35 }}
          transition={{ duration: 2.6, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
        />
      </svg>

      <div className="absolute inset-0 noise" />
    </div>
  );
}
