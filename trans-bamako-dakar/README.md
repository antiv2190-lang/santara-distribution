# Trans Bamako-Dakar — MVP

Plateforme de mise en relation entre demandeurs de transport (plateaux, remorques 40 t, carrosseries)
et transporteurs, sur **Bamako-Dakar** et **Bamako-Abidjan**.

## Contenu
- `index.html` : application complète (accueil, inscription transporteur, signalement de disponibilité,
  demande client avec matching + fourchette de prix, tableau de bord admin, export CSV).
  Fonctionne **sans serveur** : les données sont stockées dans le navigateur (mode démo).
- `supabase/schema.sql` : schéma de base de données pour la version en production.

## Lancer en local
```
cd trans-bamako-dakar && python3 -m http.server 8080
```

## Passer en production
1. Créer un projet Supabase et exécuter `supabase/schema.sql`.
2. Remplacer les fonctions `load()`/`save()` de `index.html` par des appels à l'API Supabase.
3. Ajouter l'authentification par SMS et les rappels WhatsApp quotidiens (Zapier/n8n + WhatsApp Business API).
4. Déployer sur Vercel.

## Important
- Les **tarifs** (`TARIFS` dans `index.html`) sont des valeurs indicatives à calibrer avec de vrais prix du marché.
- Le mode démo n'est pas partagé entre utilisateurs : il sert à valider l'ergonomie, pas à exploiter.
