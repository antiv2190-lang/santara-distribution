import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const AuthContext = createContext<{ user: User | null; ready: boolean }>({ user: null, ready: false });
export const useAuth = () => useContext(AuthContext);
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      const { data } = await supabase.auth.getUser();
      if (active && current === revision) { setUser(data.user); setReady(true); }
    };
    void refresh();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) return;
      if (event === "SIGNED_OUT") {
        revision++;
        setUser(null);
        setReady(true);
        router.options.context?.queryClient.clear();
      }
      // Run outside the auth callback to avoid waiting on Auth's own lock.
      setTimeout(() => {
        if (!active) return;
        if (event !== "SIGNED_OUT") { void refresh(); void router.options.context?.queryClient.invalidateQueries(); }
        void router.invalidate();
      }, 0);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [router]);
  return <AuthContext.Provider value={{ user, ready }}>{children}</AuthContext.Provider>;
}