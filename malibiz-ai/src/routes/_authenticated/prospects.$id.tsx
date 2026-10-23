import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Phone } from "lucide-react";
import { DEMO_LEADS, deleteLead, formatDate, updateLead, useMyLeads, leadsQueryOptions } from "@/lib/leads";
import { LeadsError } from "@/components/LeadsError";
import { Card, DemoBadge, StatusBadge, btn } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { LeadForm } from "@/components/LeadForm";

export const Route = createFileRoute("/_authenticated/prospects/$id")({
  loader: ({ context }) => context.queryClient.ensureQueryData(leadsQueryOptions),
  errorComponent: LeadsError,
  notFoundComponent: () => <p>Prospect introuvable.</p>,
  head: () => ({
    meta: [
      { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
      { title: "Détail du prospect — MaliBiz AI" },
      { name: "description", content: "Détails, statut et notes d'un prospect." },
      { property: "og:title", content: "Détail du prospect — MaliBiz AI" },
      { property: "og:description", content: "Détails, statut et notes d'un prospect." },
    ],
  }),
  component: LeadDetail,
});

function LeadDetail() {
  const { id } = Route.useParams();
  const { leads, ready } = useMyLeads();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lead = DEMO_LEADS.find((l) => l.id === id) ?? leads.find((l) => l.id === id);

  if (!lead) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Card className="text-center text-muted-foreground">{ready ? "Prospect introuvable." : "Chargement…"}</Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/prospects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Retour aux prospects</Link>
      <Card>
        {editing ? (
          <LeadForm initial={lead} onSubmit={async (v) => { await updateLead(lead.id, v); setEditing(false); }} onCancel={() => setEditing(false)} />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold text-foreground">{lead.name} {lead.demo && <DemoBadge />}</h1>
              <StatusBadge status={lead.status} />
            </div>
            <dl className="mt-6 space-y-4">
              <Row label="Téléphone"><a href={`tel:${lead.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-primary"><Phone className="h-4 w-4" />{lead.phone}</a></Row>
              <Row label="Besoin">{lead.need}</Row>
              <Row label="Date">{formatDate(lead.date)}</Row>
              <Row label="Notes">{lead.notes || <span className="text-muted-foreground">Aucune note</span>}</Row>
            </dl>
            {lead.demo ? (
              <p className="mt-6 rounded-xl bg-muted p-3 text-sm text-muted-foreground">Ceci est un prospect de démonstration. Il ne peut pas être modifié.</p>
            ) : (
              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <button className={btn.primary} onClick={() => setEditing(true)}>Modifier</button>
                <Button variant="outline" className={btn.danger} disabled={busy} onClick={async () => {
                  if (!confirm("Supprimer ce prospect ?")) return;
                  setBusy(true); setError("");
                  try { await deleteLead(lead.id); await navigate({ to: "/prospects" }); }
                  catch (failure) { setError(failure instanceof Error ? failure.message : "Suppression impossible."); }
                  finally { setBusy(false); }
                }}>Supprimer</Button>
              </div>
            )}
          </>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-foreground">{children}</dd>
    </div>
  );
}
