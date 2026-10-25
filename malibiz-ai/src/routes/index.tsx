import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageSquare, Users, Clock, TrendingUp } from "lucide-react";
import { btn } from "@/components/ui-kit";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
      { title: "MaliBiz AI — Gestion des demandes clients et prospects" },
      { name: "description", content: "Transformez vos demandes clients en opportunités commerciales grâce à l'IA. Pour les PME du Mali." },
      { property: "og:title", content: "MaliBiz AI" },
      { property: "og:description", content: "Support client assisté par IA et gestion de prospects pour les PME." },
    ],
  }),
  component: Landing,
});

const benefits = [
  { icon: MessageSquare, t: "Réponses rapides", d: "Un assistant répond aux questions fréquentes de vos clients, à toute heure." },
  { icon: Users, t: "Prospects organisés", d: "Chaque demande devient un prospect suivi, avec statut et notes." },
  { icon: Clock, t: "Relances à temps", d: "Voyez en un coup d'œil qui doit être contacté ou relancé." },
  { icon: TrendingUp, t: "Plus de ventes", d: "Moins d'opportunités perdues, plus de clients convertis." },
];

function Landing() {
  return (
    <>
      <section className="bg-navy text-navy-foreground">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <span className="inline-block rounded-full border border-success/40 bg-success/10 px-3 py-1 text-xs font-semibold text-success">Pour les PME du Mali</span>
          <h1 className="mt-5 max-w-3xl font-display text-4xl font-bold leading-tight sm:text-5xl">
            Transformez vos demandes clients en opportunités commerciales.
          </h1>
          <p className="mt-5 max-w-2xl text-lg opacity-80">
            MaliBiz AI vous aide à répondre à vos clients plus vite et à suivre chaque prospect jusqu'à la vente.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/assistant" className={btn.accent}>Découvrir la démo</Link>
            <Link to="/prospects" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/25 px-5 font-semibold hover:bg-white/10">Gérer mes prospects</Link>
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        {benefits.map((b) => (
          <div key={b.t} className="rounded-2xl border bg-card p-5">
            <b.icon className="h-6 w-6 text-success" />
            <h2 className="mt-3 font-display font-semibold text-foreground">{b.t}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{b.d}</p>
          </div>
        ))}
      </section>
    </>
  );
}
