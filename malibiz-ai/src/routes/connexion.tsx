import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { credentialsSchema } from "@/lib/validation";
import { Card, Field, Input, PageHeader, btn } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/connexion")({
  head: () => ({ meta: [
    { title: "Connexion — MaliBiz AI" },
    { name: "description", content: "Connectez-vous ou créez votre compte MaliBiz AI." },
    { property: "og:title", content: "Connexion — MaliBiz AI" },
    { property: "og:description", content: "Accédez à vos prospects personnels en toute sécurité." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Connexion,
});
function Connexion() {
  const navigate = useNavigate();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(""); setNotice("");
    const result = credentialsSchema.safeParse({ email, password });
    if (!result.success) { setError(result.error.issues[0]?.message ?? "Vérifiez les champs."); return; }
    setBusy(true);
    try {
      if (signup) {
        const { data, error: failure } = await supabase.auth.signUp({ ...result.data, options: { emailRedirectTo: window.location.origin } });
        if (failure) throw failure;
        if (!data.session) { setNotice("Consultez votre e-mail pour confirmer votre inscription, puis connectez-vous."); setPassword(""); }
        else await navigate({ to: "/dashboard" });
      } else {
        const { error: failure } = await supabase.auth.signInWithPassword(result.data);
        if (failure) throw failure;
        await navigate({ to: "/dashboard" });
      }
    } catch { setError(signup ? "Inscription impossible. Vérifiez vos informations ou réessayez plus tard." : "Connexion impossible. Vérifiez votre e-mail, votre mot de passe et la confirmation de votre compte."); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-xl px-4 py-8">
    <PageHeader title={signup ? "Inscription" : "Connexion"} />
    <Card><form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="E-mail *"><Input type="email" autoComplete="email" maxLength={255} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Mot de passe *"><Input type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}
      <Button type="submit" disabled={busy} className={`${btn.primary} w-full`}>{busy ? "Veuillez patienter…" : signup ? "Créer mon compte" : "Se connecter"}</Button>
      <Button type="button" variant="outline" disabled={busy} className={`${btn.outline} w-full`} onClick={() => { setSignup(!signup); setError(""); setNotice(""); }}>{signup ? "Déjà un compte ? Se connecter" : "Créer un compte"}</Button>
    </form></Card>
  </div>;
}