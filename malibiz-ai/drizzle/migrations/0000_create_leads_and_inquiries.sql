CREATE TABLE public.leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL DEFAULT auth.uid(),
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
 phone text NOT NULL CHECK (char_length(phone) BETWEEN 8 AND 20 AND phone ~ '^\+?[0-9][0-9 ]*$' AND char_length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 8 AND 15),
 need text NOT NULL CHECK (char_length(btrim(need)) BETWEEN 1 AND 200),
 date date NOT NULL DEFAULT CURRENT_DATE,
 status text NOT NULL DEFAULT 'Nouveau' CHECK (status IN ('Nouveau', 'À contacter', 'Relancé', 'Converti')),
 notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY leads_select_own ON public.leads FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY leads_insert_own ON public.leads FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY leads_update_own ON public.leads FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY leads_delete_own ON public.leads FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE INDEX leads_user_id_idx ON public.leads(user_id);
CREATE TABLE public.inquiries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
 phone text NOT NULL CHECK (char_length(phone) BETWEEN 8 AND 20 AND phone ~ '^\+?[0-9][0-9 ]*$' AND char_length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 8 AND 15),
 need text NOT NULL CHECK (char_length(btrim(need)) BETWEEN 1 AND 200),
 message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.inquiries TO anon, authenticated;
GRANT SELECT ON public.inquiries TO authenticated;
GRANT ALL ON public.inquiries TO service_role;
ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY inquiries_insert_validated ON public.inquiries FOR INSERT TO anon, authenticated WITH CHECK (
 char_length(btrim(name)) BETWEEN 1 AND 100 AND char_length(phone) BETWEEN 8 AND 20 AND phone ~ '^\+?[0-9][0-9 ]*$' AND char_length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 8 AND 15 AND char_length(btrim(need)) BETWEEN 1 AND 200 AND char_length(btrim(message)) BETWEEN 1 AND 1000
);
CREATE POLICY inquiries_authenticated_read ON public.inquiries FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);