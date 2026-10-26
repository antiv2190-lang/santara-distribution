-- MaliBiz AI — rôle administrateur pour lire les demandes (inquiries).
-- À APPLIQUER seulement après accord du propriétaire (voir db/README.md).

CREATE TYPE public.app_role AS ENUM ('admin');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
-- Chacun peut seulement voir ses propres rôles. Aucune écriture depuis le client.
CREATE POLICY user_roles_select_own ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- Lecture des demandes réservée aux administrateurs.
DROP POLICY IF EXISTS inquiries_authenticated_read ON public.inquiries;
CREATE POLICY inquiries_admin_read ON public.inquiries
  FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'));
