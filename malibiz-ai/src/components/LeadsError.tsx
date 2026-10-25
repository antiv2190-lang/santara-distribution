import { useRouter } from "@tanstack/react-router";
import { Card, btn } from "./ui-kit";
import { Button } from "./ui/button";
export function LeadsError() {
  const router = useRouter();
  return <div className="mx-auto max-w-xl px-4 py-8"><Card><p role="alert" className="text-destructive">Impossible de charger vos prospects. Vérifiez votre connexion et réessayez.</p><Button className={`${btn.primary} mt-4`} onClick={() => void router.invalidate()}>Réessayer</Button></Card></div>;
}
