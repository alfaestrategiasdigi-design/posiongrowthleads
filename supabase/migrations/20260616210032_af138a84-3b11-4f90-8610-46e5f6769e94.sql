
CREATE TABLE IF NOT EXISTS public.facebook_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  signature_valid boolean,
  page_id text,
  form_id text,
  leadgen_id text,
  ad_id text,
  campaign_id text,
  raw_body jsonb,
  processed boolean NOT NULL DEFAULT false,
  lead_id uuid,
  error text
);

CREATE INDEX IF NOT EXISTS idx_fb_webhook_events_received_at
  ON public.facebook_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_fb_webhook_events_leadgen
  ON public.facebook_webhook_events (leadgen_id);

GRANT SELECT ON public.facebook_webhook_events TO authenticated;
GRANT ALL ON public.facebook_webhook_events TO service_role;

ALTER TABLE public.facebook_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view webhook events"
  ON public.facebook_webhook_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
