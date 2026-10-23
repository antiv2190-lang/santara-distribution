import { createFileRoute, Link } from "@tanstack/react-router";
import { DEMO_LEADS, formatDate, useMyLeads, leadsQueryOptions } from "@/lib/leads";
import { LeadsError } from "@/components/LeadsError";
import { Card, DemoBadge, PageHeader, StatusBadge } from "@/components/ui-kit";

export const Route = createFileRoute("/_authenticated/dashboard")({
  loader: ({ context }) => context.queryClient.ensureQueryData(leadsQueryOptions),
  errorComponent: LeadsError,
  notFoundComponent: () => <p>Prospect introuvable.</p>,
  head: () => ({
    meta: [
      { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
      { title: "Tableau de bord — MaliBiz AI" },
      { name: "description", content: "Vue d'ensemble de vos prospects et demandes clients." },
      { property: "og:title", content: "Tableau de bord — MaliBiz AI" },
      { property: "og:description", content: "Vue d'ensemble de vos prospects et demandes clients." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { leads: mine } = useMyLeads();
  const all = [...mine, ...DEMO_LEADS];
  const stats = [
    { label: "Total prospects", value: all.length },
    { label: "Nouvelles demandes", value: all.filter((l) => l.status === "Nouveau").length },
    { label: "Relances à faire", value: all.filter((l) => l.status === "À contacter" || l.status === "Relancé").length },
    { label: "Convertis", value: all.filter((l) => l.status === "Converti").length, green: true },
  ];
  const recent = [...all].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader title="Tableau de bord" subtitle={`${mine.length} prospect(s) réel(s) + ${DEMO_LEADS.length} prospects de démonstration`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className={`mt-2 font-display text-3xl font-bold ${s.green ? "text-success" : "text-foreground"}`}>{s.value}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <h2 className="mb-4 font-display text-lg font-semibold text-foreground">Activité récente</h2>
        <ul className="divide-y">
          {recent.map((l) => (
            <li key={l.id}>
              <Link to="/prospects/$id" params={{ id: l.id }} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-foreground">{l.name} {l.demo && <DemoBadge />}</p>
                  <p className="truncate text-sm text-muted-foreground">{l.need} · {formatDate(l.date)}</p>
                </div>
                <StatusBadge status={l.status} />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
