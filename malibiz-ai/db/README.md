# Migrations à appliquer manuellement (non appliquées automatiquement)

1. `0001_admin_role.sql` : table `user_roles`, fonction `has_role`, lecture des demandes réservée aux admins.
2. Créer votre compte sur le site avec votre e-mail.
3. `0002_grant_admin.sql` : vous donne le rôle admin.

Exécution : Lovable Cloud > Database > SQL, ou le SQL Editor Supabase du projet.
Tant que 0001 n'est pas appliquée, la lecture des demandes reste fermée à tous (état actuel).
