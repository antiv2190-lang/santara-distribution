import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Inquiry = { id: string; name: string; phone: string; need: string; message: string; created_at: string };

/** True only if the signed-in user has the admin role (false while the migration is not applied). */
export const isAdminQueryOptions = queryOptions({
  queryKey: ["is-admin"],
  queryFn: async (): Promise<boolean> => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return false;
    const { data, error } = await supabase.rpc("has_role", { _user_id: auth.user.id, _role: "admin" });
    return !error && data === true;
  },
});

/** Rows are only returned to admins by row-level security; others get an empty list. */
export const inquiriesQueryOptions = queryOptions({
  queryKey: ["inquiries"],
  queryFn: async (): Promise<Inquiry[]> => {
    const { data, error } = await supabase
      .from("inquiries")
      .select("id,name,phone,need,message,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  },
});
