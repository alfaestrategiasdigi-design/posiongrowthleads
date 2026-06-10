CREATE TABLE public.qualification_criteria (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  field TEXT NOT NULL,
  label TEXT NOT NULL,
  disqualify_values JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.qualification_criteria TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qualification_criteria TO authenticated;
GRANT ALL ON public.qualification_criteria TO service_role;

ALTER TABLE public.qualification_criteria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active criteria"
  ON public.qualification_criteria FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage criteria"
  ON public.qualification_criteria FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_qualification_criteria_updated_at
  BEFORE UPDATE ON public.qualification_criteria
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();