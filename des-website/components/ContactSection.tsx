"use client";

import { FormEvent, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Mail, MapPin, Phone, Send } from "lucide-react";
import { Reveal } from "./ui/Reveal";

const projectTypes = [
  "Centrale solaire (production)",
  "Stockage par batteries lithium",
  "Transformateurs / poste électrique",
  "Projet intégré (solaire + stockage)",
  "Autre demande institutionnelle",
];

export function ContactSection() {
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    window.setTimeout(() => setStatus("sent"), 900);
  }

  return (
    <section id="contact" className="relative py-24 md:py-32">
      <div className="container-des">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <Reveal>
            <span className="text-[12.5px] font-semibold uppercase tracking-[0.18em] text-solar-400">
              Contact institutionnel
            </span>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-mist-50 md:text-4xl">
              Construisons l&apos;infrastructure énergétique de demain
            </h2>
            <p className="mt-5 max-w-md text-[14.5px] leading-relaxed text-mist-300">
              Opérateurs publics, industriels, bailleurs et investisseurs — notre équipe
              d&apos;ingénierie répond sous 48h ouvrées pour toute étude de faisabilité.
            </p>

            <div className="mt-10 space-y-5">
              <div className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg panel">
                  <MapPin className="h-4 w-4 text-solar-400" />
                </span>
                <div>
                  <p className="text-[13.5px] font-medium text-mist-100">Siège social</p>
                  <p className="text-[13px] text-mist-300">
                    Zone ACI 2000, Bamako, Mali
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg panel">
                  <Mail className="h-4 w-4 text-volt-400" />
                </span>
                <div>
                  <p className="text-[13.5px] font-medium text-mist-100">Direction commerciale</p>
                  <p className="text-[13px] text-mist-300">contact@diawara-energies.com</p>
                </div>
              </div>
              <div className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg panel">
                  <Phone className="h-4 w-4 text-arc-400" />
                </span>
                <div>
                  <p className="text-[13.5px] font-medium text-mist-100">Ligne directe</p>
                  <p className="text-[13px] text-mist-300">+223 00 00 00 00</p>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="relative overflow-hidden rounded-3xl panel p-6 md:p-9">
              <AnimatePresence mode="wait">
                {status === "sent" ? (
                  <motion.div
                    key="sent"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex min-h-[420px] flex-col items-center justify-center text-center"
                  >
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 200, damping: 14, delay: 0.1 }}
                      className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-volt-500/15"
                    >
                      <CheckCircle2 className="h-8 w-8 text-volt-400" />
                    </motion.span>
                    <h3 className="font-display text-xl font-semibold text-mist-50">
                      Demande envoyée
                    </h3>
                    <p className="mt-2 max-w-xs text-[13.5px] text-mist-300">
                      Merci pour votre confiance. Un ingénieur DES vous recontactera sous 48h
                      ouvrées.
                    </p>
                  </motion.div>
                ) : (
                  <motion.form
                    key="form"
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onSubmit={handleSubmit}
                    className="grid gap-5"
                  >
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field label="Nom complet" required>
                        <input required name="name" type="text" placeholder="Ex. Fatoumata Diawara" className="input-des" />
                      </Field>
                      <Field label="Société / Institution" required>
                        <input required name="company" type="text" placeholder="Ex. EDM-SA" className="input-des" />
                      </Field>
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field label="Email professionnel" required>
                        <input required name="email" type="email" placeholder="vous@institution.com" className="input-des" />
                      </Field>
                      <Field label="Téléphone">
                        <input name="phone" type="tel" placeholder="+223 00 00 00 00" className="input-des" />
                      </Field>
                    </div>

                    <Field label="Type de projet" required>
                      <select required name="projectType" defaultValue="" className="input-des">
                        <option value="" disabled>
                          Sélectionnez une option
                        </option>
                        {projectTypes.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Message" required>
                      <textarea
                        required
                        name="message"
                        rows={4}
                        placeholder="Décrivez votre projet, sa localisation et son échéance..."
                        className="input-des resize-none"
                      />
                    </Field>

                    <button
                      type="submit"
                      disabled={status === "submitting"}
                      className="group mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-mist-50 px-6 py-3.5 text-[14px] font-semibold text-ink-950 transition-transform hover:scale-[1.015] active:scale-[0.98] disabled:opacity-60"
                    >
                      {status === "submitting" ? (
                        "Envoi en cours..."
                      ) : (
                        <>
                          Envoyer la demande
                          <Send className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </button>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[12.5px] font-medium text-mist-200">
        {label} {required && <span className="text-solar-400">*</span>}
      </span>
      {children}
    </label>
  );
}
