-- Cron: fallback de reconciliação de ACKs (delivered/read) para mensagens
-- outbound presas em `sent`. Roda a cada 5 minutos para todos os tenants.
DO $$
DECLARE v_jobid int;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='whatsapp-ack-reconcile-5m';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END $$;

SELECT cron.schedule(
  'whatsapp-ack-reconcile-5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/whatsapp-ack-reconcile',
    headers := public._internal_dispatch_headers(),
    body := jsonb_build_object(
      'internal_token', current_setting('app.settings.service_role_key', true),
      'older_than_minutes', 3,
      'limit', 300
    )
  );
  $$
);