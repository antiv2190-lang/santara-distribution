import { useEffect } from "react";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { leadSchema, inquirySchema } from "./validation";

export const STATUSES = ["Nouveau", "À contacter", "Relancé", "Converti"] as const;
export type Status = (typeof STATUSES)[number];

export type Lead = {
  id: string;
  name: string;
  phone: string;
  need: string;
  date: string; // YYYY-MM-DD
  status: Status;
  notes: string;
  demo?: boolean | undefined;
};

// Demo data: fixed, never saved, always flagged.
export const DEMO_LEADS: Lead[] = [
  { id: "demo-1", name: "Aminata Traoré", phone: "+223 76 12 34 56", need: "Construction villa R+1 à Kalaban Coura", date: "2026-10-20", status: "Nouveau", notes: "Budget à préciser. Terrain déjà acquis.", demo: true },
  { id: "demo-2", name: "Moussa Keïta", phone: "+223 66 45 78 90", need: "Rénovation boutique au Grand Marché", date: "2026-10-18", status: "À contacter", notes: "Souhaite un devis avant fin du mois.", demo: true },
  { id: "demo-3", name: "Fatoumata Diallo", phone: "+223 79 23 11 08", need: "Clôture et portail pour parcelle", date: "2026-10-15", status: "Relancé", notes: "Relancée par téléphone le 19/10.", demo: true },
  { id: "demo-4", name: "Ibrahim Coulibaly", phone: "+223 65 98 76 54", need: "Dallage cour et terrasse", date: "2026-10-10", status: "Converti", notes: "Contrat signé. Début des travaux le 3/11.", demo: true },
  { id: "demo-5", name: "Awa Sangaré", phone: "+223 70 55 44 33", need: "Étude de plan pour immeuble R+3", date: "2026-10-21", status: "Nouveau", notes: "", demo: true },
  { id: "demo-6", name: "Seydou Konaté", phone: "+223 67 01 02 03", need: "Réparation toiture après hivernage", date: "2026-10-12", status: "À contacter", notes: "Urgent selon le client.", demo: true },
];

const EVT = "malibiz-leads-changed";
export const leadsQueryOptions = queryOptions({
  queryKey: ["leads"],
  queryFn: async (): Promise<Lead[]> => {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) throw new Error("Veuillez vous connecter.");
    const { data, error } = await supabase.from("leads").select("id, name, phone, need, date, status, notes").eq("user_id", auth.user.id).order("created_at", { ascending: false });
    if (error) throw new Error("Impossible de charger vos prospects.");
    return (data ?? []).map((row) => ({ id: row.id, ...leadSchema.parse(row) }));
  },
});
const changed = () => window.dispatchEvent(new Event(EVT));
export async function addLead(data: Omit<Lead, "id" | "demo">) {
  const values = leadSchema.parse(data);
  const { data: lead, error } = await supabase.from("leads").insert(values).select("id, name, phone, need, date, status, notes").single();
  if (error) throw new Error("Impossible d’enregistrer le prospect. Réessayez.");
  changed(); return lead;
}
export async function updateLead(id: string, data: Partial<Lead>) {
  if (id.startsWith("demo-")) throw new Error("Ce prospect de démonstration ne peut pas être modifié.");
  const { data: rows, error } = await supabase.from("leads").update(leadSchema.partial().parse(data)).eq("id", id).select("id");
  if (error || !rows?.length) throw new Error("Impossible de modifier ce prospect.");
  changed();
}
export async function deleteLead(id: string) {
  if (id.startsWith("demo-")) throw new Error("Ce prospect de démonstration ne peut pas être supprimé.");
  const { data: rows, error } = await supabase.from("leads").delete().eq("id", id).select("id");
  if (error || !rows?.length) throw new Error("Impossible de supprimer ce prospect.");
  changed();
}
export async function submitInquiry(input: unknown) {
  // No read-back: anonymous visitors have INSERT access only.
  const { error } = await supabase.from("inquiries").insert(inquirySchema.parse(input));
  if (error) throw new Error("Impossible d’envoyer la demande. Réessayez.");
}
export async function importLegacyLeads() {
  let legacy: unknown;
  try { legacy = JSON.parse(localStorage.getItem("malibiz_leads_v1") ?? "[]"); }
  catch { throw new Error("Les données locales restent conservées mais ne peuvent pas être lues."); }
  if (!Array.isArray(legacy)) throw new Error("Anciennes données invalides. Elles restent conservées.");
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("Veuillez vous connecter.");
  const rows = legacy.filter((l) => l && !l.demo).map((l) => {
    if (typeof l.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(l.id)) throw new Error("Une ancienne donnée est invalide. Les données locales restent conservées.");
    return { ...leadSchema.parse(l), id: l.id, user_id: auth.user.id };
  });
  if (rows.length) {
    const { error } = await supabase.from("leads").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error("Importation impossible. Les données locales restent conservées.");
    changed();
  }
  return rows.length;
}
/** Server-stored leads scoped to the authenticated account by RLS. */
export function useMyLeads() {
  const { data: leads } = useSuspenseQuery(leadsQueryOptions);
  const client = useQueryClient();
  useEffect(() => {
    const sync = () => { void client.invalidateQueries({ queryKey: ["leads"] }); };
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [client]);
  return { leads, ready: true };
}

export const today = () => new Date().toISOString().slice(0, 10);
export const formatDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
