import { leadSchema } from "@/lib/validation";
import { Button } from "./ui/button";
import { useState } from "react";
import { STATUSES, today, type Lead, type Status } from "@/lib/leads";
import { Field, Input, Select, Textarea, btn } from "./ui-kit";

type Values = Omit<Lead, "id" | "demo">;

export function LeadForm({ initial, onSubmit, onCancel, submitLabel = "Enregistrer" }: {
  initial?: Partial<Values>;
  onSubmit: (v: Values) => void | Promise<void>;
  onCancel?: (() => void) | undefined;
  submitLabel?: string;
}) {
  const [v, setV] = useState<Values>({
    name: "", phone: "", need: "", date: today(), status: "Nouveau", notes: "", ...initial,
  });
  const [errors, setErrors] = useState<Partial<Record<"name" | "phone" | "need" | "service" | "message", string>>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaveError("");
    const result = leadSchema.safeParse(v);
    const err: typeof errors = {};
    if (!result.success) for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (key === "name" || key === "phone" || key === "need") err[key] = issue.message;
      else setSaveError(issue.message);
    }
    setErrors(err);
    if (!result.success) return;
    setBusy(true);
    try { await onSubmit(result.data); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Nom *" error={errors.name}><Input value={v.name} onChange={set("name")} maxLength={100} /></Field>
      <Field label="Téléphone *" error={errors.phone}><Input type="tel" value={v.phone} onChange={set("phone")} placeholder="+223 ..." /></Field>
      <Field label="Besoin *" error={errors.need}><Input value={v.need} onChange={set("need")} maxLength={200} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><Input type="date" value={v.date} onChange={set("date")} /></Field>
        <Field label="Statut">
          <Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as Status })}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Notes"><Textarea value={v.notes} onChange={set("notes")} maxLength={1000} /></Field>
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={busy} className={btn.primary}>{busy ? "Enregistrement…" : submitLabel}</Button>
        {onCancel && <Button type="button" disabled={busy} onClick={onCancel} variant="outline" className={btn.outline}>Annuler</Button>}
      </div>
    </form>
  );
}
