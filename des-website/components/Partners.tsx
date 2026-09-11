import { partners } from "@/lib/data";

export function Partners() {
  const loop = [...partners, ...partners];
  return (
    <section className="border-y border-white/[0.06] bg-ink-900/60 py-12">
      <div className="container-des mb-6">
        <p className="text-center text-[12px] font-medium uppercase tracking-[0.18em] text-mist-400">
          Ils nous font confiance
        </p>
      </div>
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink-900 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink-900 to-transparent" />
        <div className="flex w-max animate-marquee gap-14">
          {loop.map((name, i) => (
            <span
              key={`${name}-${i}`}
              className="whitespace-nowrap font-display text-lg font-medium text-mist-400/70"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
