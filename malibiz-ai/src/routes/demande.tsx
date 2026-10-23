import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { inquirySchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { submitInquiry } from "@/lib/leads";
import { Card, Field, Input, PageHeader, Select, Textarea, btn } from "@/components/ui-kit";

export const Route = createFileRoute("/demande")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
      { title: "Formulaire de demande — MaliBiz AI" },
      { name: "description", content: "Envoyez votre demande de service." },
      { property: "og:title", content: "Formulaire de demande — MaliBiz AI" },
      { property: "og:description", content: "Envoyez votre demande de service." },
    ],
  }),
  component: Demande,
});

const SERVICES = ["Construction", "Rénovation", "Clôture", "Dallage", "Toiture", "Autre"];
const empty = { name: "", phone: "", service: "", message: "" };

function Demande() {
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState<Partial<Record<"name" | "phone" | "need" | "service" | "message", string>>>({});
  const [done, setDone] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err: Partial<Record<"name" | "phone" | "need" | "service" | "message", string>> = {};
    const result = inquirySchema.safeParse({ name: v.name, phone: v.phone, need: v.service, message: v.message });
    if (!result.success) for (const issue of result.error.issues) {
      const key = issue.path[0] === "need" ? "service" : issue.path[0];
      if (key === "name" || key === "phone" || key === "service" || key === "message") err[key] = issue.message;
    }
    if (!SERVICES.includes(v.service)) err.service = "Veuillez choisir un service.";
    setErrors(err);
    if (Object.keys(err).length) return;
    if (!result.success) return;
    setBusy(true); setSaveError("");
    try { await submitInquiry(result.data); setDone(v.name.trim()); setV(empty); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "Impossible d’envoyer la demande."); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <Card className="text-center">
          <CheckCircle2 className="mx-auto h-14 w-14 text-success" />
          <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Merci {done}, demande reçue !</h1>
          <p className="mt-2 text-muted-foreground">Votre demande a été enregistrée et transmise à l’équipe.</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link to="/prospects" className={btn.primary}>Voir mes prospects</Link>
            <button className={btn.outline} onClick={() => setDone(null)}>Nouvelle demande</button>
          </div>
        </Card>
      </div>
    );
  }

  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <PageHeader title="Faire une demande" subtitle="Les champs marqués * sont obligatoires." />
      <Card>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Nom *" error={errors.name}><Input value={v.name} onChange={set("name")} maxLength={100} /></Field>
          <Field label="Téléphone *" error={errors.phone}><Input type="tel" value={v.phone} onChange={set("phone")} placeholder="+223 ..." /></Field>
          <Field label="Service demandé *" error={errors.service}>
            <Select value={v.service} onChange={set("service")}>
              <option value="">Choisir…</option>
              {SERVICES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Message *" error={errors.message}><Textarea value={v.message} onChange={set("message")} maxLength={1000} /></Field>
          {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
          <Button type="submit" disabled={busy} className={`${btn.accent} w-full`}>{busy ? "Envoi…" : "Envoyer la demande"}</Button>
        </form>
      </Card>
    </div>
  );
}
