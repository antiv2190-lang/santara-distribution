# Parcours de paiement et de livraison (v1)

## Étapes

1. Le client choisit un pack.
2. La réceptionniste envoie le numéro Orange Money / Moov Money du marchand, le montant exact, et demande une capture d'écran du paiement.
3. Le client envoie la capture.
4. Le Chasseur de paiements vérifie : montant exact, numéro destinataire exact, date du jour, référence de transaction jamais utilisée.
5. **Approbation** : au début, c'est vous qui confirmez chaque paiement (message de validation sur Telegram ou WhatsApp). On passe en automatique seulement quand le système a fait ses preuves.
6. Après confirmation, l'agent envoie le lien du pack au client.
7. Le Chasseur de paiements enregistre la vente (client, pack, montant, référence, date).

## Pourquoi vous validez au début

Les fausses captures d'écran existent. Une IA ne peut pas vérifier qu'un transfert Orange Money a réellement eu lieu en regardant une image. Le seul contrôle fiable est la notification SMS ou l'historique de **votre** compte marchand. Ne livrez jamais sur la seule foi d'une capture.

## Plus tard

- Passer à une API de paiement mobile (à étudier selon ce qui est disponible au Mali) pour confirmer automatiquement.
- Enregistrer les ventes dans un tableur ou une base pour le résumé du matin (employé n°5).
