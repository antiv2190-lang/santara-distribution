"use client";

import { motion } from "framer-motion";

const accentMap = {
  solar: { stroke: "#F5B84C", glow: "#EE9F2E" },
  volt: { stroke: "#3EE3A6", glow: "#1FC98A" },
  arc: { stroke: "#7DD3FC", glow: "#38BDF8" },
};

const draw = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: (i: number) => ({
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { delay: i * 0.15, duration: 1.1, ease: [0.16, 1, 0.3, 1] },
      opacity: { delay: i * 0.15, duration: 0.3 },
    },
  }),
};

function SolarArt({ stroke }: { stroke: string }) {
  const panels = [0, 1, 2].map((i) => (
    <motion.rect
      key={i}
      x={18 + i * 42}
      y={54}
      width={34}
      height={22}
      rx={2}
      stroke={stroke}
      strokeWidth={1.4}
      fill="none"
      custom={i}
      variants={draw}
    />
  ));
  return (
    <svg viewBox="0 0 160 110" fill="none" className="h-full w-full">
      {panels}
      {[0, 1, 2].map((p) =>
        [0, 1, 2].map((l) => (
          <motion.line
            key={`${p}-${l}`}
            x1={18 + p * 42 + 6 + l * 10}
            y1={54}
            x2={18 + p * 42 + 6 + l * 10}
            y2={76}
            stroke={stroke}
            strokeWidth={0.8}
            opacity={0.5}
            custom={0.6}
            variants={draw}
          />
        ))
      )}
      <motion.path
        d="M34 76 L34 92 M76 76 L76 96 M118 76 L118 92"
        stroke={stroke}
        strokeWidth={1.4}
        custom={0.9}
        variants={draw}
      />
      <motion.path
        d="M10 96 H150"
        stroke={stroke}
        strokeWidth={1}
        opacity={0.5}
        custom={1.1}
        variants={draw}
      />
      <motion.circle
        cx={128}
        cy={20}
        r={12}
        stroke={stroke}
        strokeWidth={1.2}
        custom={0}
        variants={draw}
      />
      {[...Array(8)].map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        return (
          <motion.line
            key={i}
            x1={128 + Math.cos(angle) * 15}
            y1={20 + Math.sin(angle) * 15}
            x2={128 + Math.cos(angle) * 19}
            y2={20 + Math.sin(angle) * 19}
            stroke={stroke}
            strokeWidth={1}
            custom={0.2 + i * 0.02}
            variants={draw}
          />
        );
      })}
    </svg>
  );
}

function BatteryArt({ stroke }: { stroke: string }) {
  return (
    <svg viewBox="0 0 160 110" fill="none" className="h-full w-full">
      {[0, 1, 2].map((i) => (
        <motion.g key={i} custom={i * 0.25}>
          <motion.rect
            x={30 + i * 34}
            y={30}
            width={24}
            height={54}
            rx={3}
            stroke={stroke}
            strokeWidth={1.4}
            custom={i * 0.2}
            variants={draw}
          />
          <motion.rect
            x={37 + i * 34}
            y={24}
            width={10}
            height={7}
            rx={1.5}
            stroke={stroke}
            strokeWidth={1.2}
            custom={i * 0.2 + 0.1}
            variants={draw}
          />
          <motion.path
            d={`M${38 + i * 34} 68 L${44 + i * 34} 56 L${48 + i * 34} 62 L${52 + i * 34} 46`}
            stroke={stroke}
            strokeWidth={1.6}
            custom={i * 0.2 + 0.4}
            variants={draw}
          />
        </motion.g>
      ))}
      <motion.path
        d="M12 96 H148"
        stroke={stroke}
        strokeWidth={1}
        opacity={0.5}
        custom={1}
        variants={draw}
      />
      <motion.circle cx={20} cy={20} r={3} fill={stroke} custom={1.2} variants={draw} />
      <motion.circle cx={140} cy={16} r={2} fill={stroke} opacity={0.6} custom={1.3} variants={draw} />
    </svg>
  );
}

function TransformerArt({ stroke }: { stroke: string }) {
  return (
    <svg viewBox="0 0 160 110" fill="none" className="h-full w-full">
      <motion.rect
        x={54}
        y={44}
        width={52}
        height={40}
        rx={3}
        stroke={stroke}
        strokeWidth={1.4}
        custom={0}
        variants={draw}
      />
      {[0, 1, 2].map((i) => (
        <motion.line
          key={i}
          x1={62 + i * 16}
          y1={44}
          x2={62 + i * 16}
          y2={30}
          stroke={stroke}
          strokeWidth={1.2}
          custom={0.3 + i * 0.1}
          variants={draw}
        />
      ))}
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={62 + i * 16}
          cy={24}
          r={5}
          stroke={stroke}
          strokeWidth={1.2}
          custom={0.5 + i * 0.1}
          variants={draw}
        />
      ))}
      <motion.path
        d="M28 20 V88 M132 20 V88"
        stroke={stroke}
        strokeWidth={1.2}
        opacity={0.55}
        custom={0.8}
        variants={draw}
      />
      {[30, 42, 54, 66, 78].map((y, i) => (
        <motion.line
          key={y}
          x1={22}
          y1={y}
          x2={34}
          y2={y}
          stroke={stroke}
          strokeWidth={1}
          opacity={0.5}
          custom={0.9 + i * 0.05}
          variants={draw}
        />
      ))}
      <motion.path
        d="M12 96 H148"
        stroke={stroke}
        strokeWidth={1}
        opacity={0.5}
        custom={1.1}
        variants={draw}
      />
    </svg>
  );
}

export function SolutionArt({
  variant,
}: {
  variant: "solar" | "volt" | "arc";
}) {
  const { stroke, glow } = accentMap[variant];
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.5 }}
      className="relative aspect-[16/11] w-full"
    >
      <div
        className="absolute inset-0 -z-10 rounded-2xl opacity-40 blur-2xl"
        style={{ background: `radial-gradient(60% 60% at 50% 40%, ${glow}33, transparent 70%)` }}
      />
      {variant === "solar" && <SolarArt stroke={stroke} />}
      {variant === "volt" && <BatteryArt stroke={stroke} />}
      {variant === "arc" && <TransformerArt stroke={stroke} />}
    </motion.div>
  );
}
