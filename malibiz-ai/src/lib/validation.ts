import { z } from "zod";

export const STATUSES = ["Nouveau", "À contacter", "Relancé", "Converti"] as const;
const phone = z.string().trim().min(8, "Numéro de téléphone invalide.").max(20, "Numéro de téléphone invalide.")
  .regex(/^\+?[0-9][0-9 ]*$/, "Numéro de téléphone invalide.")
  .refine((value) => { const digits = value.replace(/\D/g, ""); return digits.length >= 8 && digits.length <= 15; }, "Numéro de téléphone invalide.");
export const leadSchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(100),
  phone,
  need: z.string().trim().min(1, "Le besoin est obligatoire.").max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => { const d = new Date(v); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v; }, "Date invalide."),
  status: z.enum(STATUSES),
  notes: z.string().max(1000),
});
export const inquirySchema = leadSchema.pick({ name: true, phone: true, need: true }).extend({ message: z.string().trim().min(1, "Veuillez écrire un message.").max(1000) });
export const credentialsSchema = z.object({ email: z.string().trim().email("Adresse e-mail invalide.").max(255), password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères.").max(128) });