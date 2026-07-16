UPDATE public.zapi_connections
SET webhook_url = 'https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/whatsapp-webhook?tenant=gabriel-lourenco&secret=895ddcd4ca0daddba7823deb20987d96f401e9af1d62cf71',
    updated_at = now()
WHERE id = 'baaa940b-aa10-45f0-a53f-990c80c9eda9';

UPDATE public.zapi_connections
SET webhook_url = 'https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/whatsapp-webhook?tenant=donna-face&secret=28eda183-5f9d-42f0-830a-2882e83038c1',
    updated_at = now()
WHERE id = 'b00041e5-9235-4f1f-b4ed-90f28458e6d2';