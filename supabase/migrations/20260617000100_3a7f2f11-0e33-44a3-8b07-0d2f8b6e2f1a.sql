-- Add user access token support for Facebook Marketing API calls
ALTER TABLE public.facebook_webhook_config
  ADD COLUMN IF NOT EXISTS user_access_token TEXT,
  ADD COLUMN IF NOT EXISTS user_access_token_expires_at timestamptz;

ALTER TABLE public.facebook_webhook_config
  ALTER COLUMN user_access_token DROP NOT NULL;

-- no function changes required for existing get_facebook_config_meta
