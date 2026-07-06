CREATE TABLE public.facebook_lead_forms_cache (
  id INT PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT singleton_row CHECK (id = 1)
);
GRANT SELECT ON public.facebook_lead_forms_cache TO authenticated;
GRANT ALL ON public.facebook_lead_forms_cache TO service_role;
ALTER TABLE public.facebook_lead_forms_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view lead forms cache" ON public.facebook_lead_forms_cache
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));