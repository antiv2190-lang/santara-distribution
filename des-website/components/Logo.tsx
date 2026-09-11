export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} fill="none" aria-hidden>
      <path
        d="M14 78 A 50 50 0 1 1 96 24"
        stroke="#EFA33A"
        strokeWidth={11}
        strokeLinecap="round"
        fill="none"
      />
      <g transform="skewX(-10)">
        <rect x="14" y="58" width="15" height="34" rx="1.5" fill="#0E3358" />
        <rect x="34" y="42" width="15" height="50" rx="1.5" fill="#0E3358" />
        <rect x="54" y="24" width="15" height="68" rx="1.5" fill="#0E3358" />
      </g>
    </svg>
  );
}

export function Logo({
  className,
  markClassName = "h-9 w-9",
  variant = "full",
}: {
  className?: string;
  markClassName?: string;
  variant?: "full" | "mark-only";
}) {
  return (
    <span className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <LogoMark className={markClassName} />
      {variant === "full" && (
        <span className="leading-tight">
          <span className="block font-display text-[15px] font-bold tracking-tight text-mist-50">
            D.E.S.
          </span>
          <span className="block text-[9.5px] font-medium uppercase tracking-[0.12em] text-mist-300">
            Diawara Énergies S.A.S.
          </span>
        </span>
      )}
    </span>
  );
}
