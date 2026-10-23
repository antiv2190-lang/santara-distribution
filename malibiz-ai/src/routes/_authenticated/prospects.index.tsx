import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { DEMO_LEADS, STATUSES, addLead, formatDate, useMyLeads, leadsQueryOptions, importLegacyLeads } from "@/lib/leads";
import { LeadsError } from "@/components/LeadsError";
import { Card, DemoBadge, Input, PageHeader, Select, StatusBadge, btn } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { LeadForm } from "@/components/LeadForm";

export const Route = createFileRoute("/_authenticated/prospects/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(leadsQueryOptions),
  errorComponent: LeadsError,
  notFoundComponent: () => <p>Prospect introuvable.</p>,
  head: () => ({
    meta: [
      { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
      { title: "Prospects — MaliBiz AI" },
      { name: "description", content: "Ajoutez, recherchez et suivez vos prospects." },
      { property: "og:title", content: "Prospects — MaliBiz AI" },
      { property: "og:description", content: "Ajoutez, recherchez et suivez vos prospects." },
    ],
  }),
  component: Prospects,
});

function Prospects() {
  const { leads: mine } = useMyLeads();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState<"mine" | "demo">("mine");
  const [adding, setAdding] = useState(false);

  const [importBusy, setImportBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const base = source === "mine" ? mine : DEMO_LEADS;
  const list = base.filter((l) =>
    (!status || l.status === status) &&
    [l.name, l.phone, l.need, l.notes].join(" ").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader title="Prospects" action={!adding && <button className={btn.primary} onClick={() => { setAdding(true); setSource("mine"); }}><Plus className="h-5 w-5" /> Ajouter</button>} />

      {adding && (
        <Card className="mb-6">
          <h2 className="mb-4 font-display text-lg font-semibold text-foreground">Nouveau prospect</h2>
          <LeadForm onSubmit={async (v) => { await addLead(v); setAdding(false); }} onCancel={() => setAdding(false)} />
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 rounded-xl border bg-muted p-1">
        {(["mine", "demo"] as const).map((s) => (
          <button key={s} onClick={() => setSource(s)} className={`min-h-11 rounded-lg text-sm font-semibold ${source === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
            {s === "mine" ? `Mes prospects (${mine.length})` : `Données démo (${DEMO_LEADS.length})`}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher un nom, un téléphone, un besoin…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
          <option value="">Tous les statuts</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
      </div>

      {source === "mine" && (
        <div className="mb-3 text-xs text-muted-foreground"><p>Vos prospects sont enregistrés dans votre compte, accessibles sur vos appareils.</p>
          <Button variant="link" className="px-0 text-xs" disabled={importBusy} onClick={async () => {
            if (!confirm("Importer les anciens prospects de ce navigateur dans votre compte ? Les données locales seront conservées.")) return;
            setImportBusy(true);
            try { const count = await importLegacyLeads(); setNotice(count ? "Importation terminée. Les données locales restent conservées." : "Aucun ancien prospect à importer."); }
            catch (error) { setNotice(error instanceof Error ? error.message : "Importation impossible."); }
            finally { setImportBusy(false); }
          }}>Importer mes anciens prospects</Button>{notice && <p role="status">{notice}</p>}</div>
      )}

      {list.length === 0 ? (
        <Card className="text-center text-muted-foreground">
          {source === "mine" && mine.length === 0 ? "Aucun prospect pour l'instant. Appuyez sur « Ajouter » pour commencer." : "Aucun résultat."}
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.map((l) => (
            <li key={l.id}>
              <Link to="/prospects/$id" params={{ id: l.id }} className="block rounded-2xl border bg-card p-4 transition hover:border-primary/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold text-foreground">{l.name} {l.demo && <DemoBadge />}</p>
                    <p className="text-sm text-muted-foreground">{l.phone}</p>
                  </div>
                  <StatusBadge status={l.status} />
                </div>
                <p className="mt-2 text-sm text-foreground">{l.need}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(l.date)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
