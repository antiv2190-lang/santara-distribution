# 2XD : architecture et plan de lancement

## Principe

Un produit simple (fiches PDF à 2 000-3 000 FCFA), vendu par cinq employés IA qui ne parlent qu'au propriétaire, sur Telegram. Le propriétaire fait un seul geste humain : confirmer qu'un paiement est arrivé.

## Schéma

```
Client (Telegram aujourd'hui, WhatsApp demain)
        |
        v
[1 Réceptionniste]  --- écrit ---> table 2xd_clients
   |   |  \
   |   |   +-- capture reçue --> [4 Chasseur de paiements] --> alerte + capture au propriétaire
   |   +------ demande/plainte -> [2 Gestionnaire] --> table 2xd_demandes + alerte
   |                                   ^
   |                                   +-- le propriétaire répond : /rep identifiant message
   v
réponse au client

[3 Relanceur]  chaque jour 10h  --lit--> 2xd_clients --> relance 2 fois max (48h de silence)
[5 Chef de cabinet]  chaque jour 7h --lit--> 2xd_clients + 2xd_demandes --> bilan au propriétaire
```

## Où tout se trouve

| Élément | Emplacement |
|---|---|
| Réceptionniste, gestionnaire, chasseur | n8n : « 2XD - Réceptionniste (test Telegram) » |
| Relanceur | n8n : « 2XD - Relanceur » |
| Chef de cabinet | n8n : « 2XD - Chef de cabinet » |
| Mémoire | n8n Data Tables `2xd_clients`, `2xd_demandes` |
| Produit | `def-maths-fiches.md` et `2XD-DEF-Maths-fiches.pdf` |
| Prix et paquets | `catalogue.md` |

## Décisions prises

1. **Telegram pour tester, WhatsApp pour vendre.** Les clients maliens utilisent WhatsApp. Tout est construit pour changer seulement le déclencheur et le nœud de réponse.
2. **Le propriétaire valide chaque paiement.** Une capture d'écran peut être fausse et il n'y a pas d'accès automatique à Orange Money ou Moov Money.
3. **L'IA ne livre jamais seule.** Elle n'envoie ni lien, ni confirmation de paiement.
4. **Aucun message non sollicité.** Le relanceur ne contacte que les gens qui ont écrit en premier, deux fois maximum.
5. **Un seul produit au départ** (DEF Maths), pour tester si les gens achètent avant de produire d'autres packs.

## Risques connus

- Le bot Telegram actuel appartient au projet DES : à remplacer par un bot 2XD.
- Les fiches n'ont pas été relues par un enseignant malien.
- Les prix sont des propositions, pas des données de marché.
- La détection de preuve de paiement ne marche que pour une photo, pas pour un fichier envoyé en pièce jointe.
- Les ventes ne sont pas encore comptées dans le bilan du matin.

## Plan de lancement, dans l'ordre

| # | Action | Qui | Bloque |
|---|---|---|---|
| 1 | Créer le bot 2XD avec @BotFather et l'ajouter dans n8n (Credentials, Telegram API) | Propriétaire | tout le reste |
| 2 | Brancher les trois workflows sur le nouveau bot | Claude | 1 |
| 3 | Mettre le PDF sur Drive (lecture seule, toute personne avec le lien) et donner le lien | Propriétaire | 4 |
| 4 | Construire les boutons « Payé / Pas reçu » qui envoient le lien au client | Claude | 3 |
| 5 | Faire relire le PDF par un enseignant | Propriétaire | la vente |
| 6 | Test complet avec 2 comptes Telegram (achat, capture, remboursement, /rep) | Propriétaire, avec Claude | 2, 4 |
| 7 | Vérifier 2 ou 3 prix locaux (photocopie, répétiteur) puis valider 2 000 F | Propriétaire | la vente |
| 8 | Ouvrir WhatsApp Business sur un numéro malien | Propriétaire | clients réels |
| 9 | Basculer les workflows sur WhatsApp | Claude | 8 |
| 10 | Premières ventes : 20 à 50 clients autour de Bamako, puis écrire DEF Français | Les deux | 6, 7, 9 |
