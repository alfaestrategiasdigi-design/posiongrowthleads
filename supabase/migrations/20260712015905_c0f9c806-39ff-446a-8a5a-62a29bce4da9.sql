-- Add facebook_campaign_id column to leads and backfill from facebook_campaign when it's numeric.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS facebook_campaign_id text;

-- Backfill: when facebook_campaign is 100% digits, it's actually the campaign ID → move it.
UPDATE public.leads
   SET facebook_campaign_id = facebook_campaign,
       facebook_campaign = NULL
 WHERE facebook_campaign_id IS NULL
   AND facebook_campaign IS NOT NULL
   AND facebook_campaign ~ '^[0-9]{6,}$';

CREATE INDEX IF NOT EXISTS idx_leads_facebook_campaign_id
  ON public.leads (facebook_campaign_id)
  WHERE facebook_campaign_id IS NOT NULL;