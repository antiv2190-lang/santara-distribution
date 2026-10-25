import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/leads";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string | undefined; action?: ReactNode | undefined }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border bg-card p-5 shadow-sm", className)}>{children}</div>;
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground", className)}>
      Démo
    </span>
  );
}

const statusStyle: Record<Status, string> = {
  Nouveau: "bg-primary/10 text-primary",
  "À contacter": "bg-warning/20 text-warning-foreground",
  Relancé: "bg-secondary text-secondary-foreground",
  Converti: "bg-success/15 text-success",
};
export function StatusBadge({ status }: { status: Status }) {
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", statusStyle[status])}>{status}</span>;
}

export const btn = {
  primary: "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50",
  accent: "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-success px-5 font-semibold text-success-foreground transition hover:bg-success/90",
  outline: "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border bg-background px-5 font-semibold text-foreground transition hover:bg-muted",
  danger: "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-destructive/40 px-5 font-semibold text-destructive transition hover:bg-destructive/10",
};

const field = "w-full rounded-xl border bg-background px-4 py-3 text-base text-foreground outline-none focus:ring-2 focus:ring-ring";

export function Field({ label, error, children }: { label: string; error?: string | undefined; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">{label}</span>
      {children}
      {error && <span className="mt-1 block text-sm text-destructive">{error}</span>}
    </label>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cn(field, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={4} {...p} className={cn(field, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cn(field, p.className)} />;
