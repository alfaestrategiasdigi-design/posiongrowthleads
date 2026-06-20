
ALTER TABLE public.facebook_webhook_config
  ADD COLUMN IF NOT EXISTS cron_token text;
UPDATE public.facebook_webhook_config
  SET cron_token = encode(gen_random_bytes(24), 'hex')
  WHERE cron_token IS NULL;
