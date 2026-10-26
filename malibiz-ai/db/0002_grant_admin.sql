-- À exécuter UNE SEULE FOIS, après que le propriétaire a créé son compte avec cet e-mail.
-- (Pas de « premier inscrit = admin » : le site est public, ce serait exploitable.)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users WHERE email = 'diawaradiadie1998@gmail.com'
ON CONFLICT DO NOTHING;
