import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LayoutDashboard, Users, MessageSquare, Send, Sparkles } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "./ui/button";
import { useState } from "react";

const nav = [
  { to: "/dashboard", label: "Tableau", icon: LayoutDashboard },
  { to: "/prospects", label: "Prospects", icon: Users },
  { to: "/assistant", label: "Assistant", icon: MessageSquare },
  { to: "/demande", label: "Demande", icon: Send },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setBusy(true); setError("");
    try {
      await router.options.context?.queryClient.cancelQueries();
      router.options.context?.queryClient.clear();
      const { error: failure } = await supabase.auth.signOut();
      if (failure) throw failure;
      await navigate({ to: "/connexion", replace: true });
    } catch { setError("Déconnexion impossible. Réessayez."); }
    finally { setBusy(false); }
  }
  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-navy text-navy-foreground">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-success text-success-foreground"><Sparkles className="h-4 w-4" /></span>
            MaliBiz <span className="text-success">AI</span>
          </Link>
          <div className="flex items-center gap-2"><nav className="hidden gap-1 md:flex">
            {nav.map((n) => (
              <Link key={n.to} to={n.to} className="rounded-lg px-3 py-2 text-sm font-medium opacity-80 hover:opacity-100" activeProps={{ className: "bg-white/10 opacity-100" }}>
                {n.label}
              </Link>
            ))}
          </nav>
          {ready && (user ? <Button variant="ghost" disabled={busy} onClick={signOut} className="text-navy-foreground hover:bg-navy-foreground/10 hover:text-navy-foreground">Déconnexion</Button> : <Link to="/connexion" className="rounded-lg px-3 py-2 text-sm font-medium">Connexion</Link>)}
          </div>
        </div>
      </header>
      {error && <p role="alert" className="mx-auto max-w-6xl px-4 py-2 text-sm text-destructive">{error}</p>}
      <main>{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-card md:hidden">
        {nav.map((n) => (
          <Link key={n.to} to={n.to} className="flex flex-col items-center gap-1 py-3 text-xs font-medium text-muted-foreground" activeProps={{ className: "text-primary" }}>
            <n.icon className="h-5 w-5" />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
