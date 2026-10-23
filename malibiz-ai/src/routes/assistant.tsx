import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { COMPANY, UNKNOWN, answer } from "@/lib/demo-assistant";
import { Card, Input, PageHeader, btn } from "@/components/ui-kit";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
      { title: "Assistant (démo) — MaliBiz AI" },
      { name: "description", content: "Démonstration d'un assistant client pour une entreprise de construction fictive." },
      { property: "og:title", content: "Assistant (démo) — MaliBiz AI" },
      { property: "og:description", content: "Démonstration d'un assistant client pour une entreprise fictive." },
    ],
  }),
  component: Assistant,
});

type Msg = { from: "user" | "bot"; text: string };
const suggestions = ["Quels sont vos horaires ?", "Le devis est-il gratuit ?", "Quel est le prix d'une villa ?"];

function Assistant() {
  const [msgs, setMsgs] = useState<Msg[]>([{ from: "bot", text: answer("bonjour") }]);
  const [text, setText] = useState("");
  const [aiOn, setAiOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs]);

  async function send(t: string) {
    const v = t.trim().slice(0, 500);
    if (!v || busy) return;
    const history = [...msgs, { from: "user" as const, text: v }];
    setMsgs(history);
    setText("");
    setBusy(true);
    let reply = answer(v);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(1).map((m) => ({ role: m.from === "user" ? "user" : "assistant", content: m.text })).slice(-12),
        }),
      });
      const data = (await res.json()) as { mode?: string; text?: string; unknown?: boolean; error?: string };
      if (res.ok && data.mode === "ai") {
        setAiOn(true);
        reply = data.unknown ? UNKNOWN : data.text || answer(v);
      } else if (res.status === 429) {
        reply = data.error || "Trop de messages, réessayez dans une minute.";
      } else {
        setAiOn(false);
      }
    } catch {
      setAiOn(false);
    }
    setMsgs((m) => [...m, { from: "bot", text: reply }]);
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="Assistant client" subtitle={COMPANY.name} />
      <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
        {aiOn ? (<><strong>Mode démonstration avec IA :</strong> les réponses sont générées par une IA, uniquement à partir des informations de l'entreprise fictive. Les prix et délais restent à confirmer par un humain.</>) : (<><strong>Mode démonstration :</strong> les réponses viennent de règles simples basées uniquement sur les informations de l'entreprise fictive (l'IA se connecte dès le premier message si elle est configurée).</>)}
      </div>
      <Card className="flex h-[55vh] flex-col p-0">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.from === "user" ? "bg-primary text-primary-foreground" : m.text === UNKNOWN ? "border border-warning/50 bg-warning/10 text-foreground" : "bg-muted text-foreground"}`}>
                {m.text}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
        <div className="flex gap-2 overflow-x-auto border-t px-4 pt-3">
          {suggestions.map((s) => (
            <button key={s} onClick={() => send(s)} className="shrink-0 rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">{s}</button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2 p-4">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Posez votre question…" maxLength={500} />
          <button disabled={busy} className={btn.primary} aria-label="Envoyer"><Send className="h-5 w-5" /></button>
        </form>
      </Card>
      <details className="mt-4 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium">Informations connues de l'assistant</summary>
        <ul className="mt-2 list-disc pl-5">{COMPANY.facts.map((f) => <li key={f}>{f}</li>)}</ul>
      </details>
    </div>
  );
}
