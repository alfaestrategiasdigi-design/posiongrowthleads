DELETE FROM public.messages
WHERE conversation_id IN (
  SELECT id
  FROM public.conversations
  WHERE remote_jid ILIKE '%@lid%'
     OR remote_jid ILIKE '%@broadcast%'
     OR remote_jid ILIKE '%@g.us%'
);

DELETE FROM public.conversations
WHERE remote_jid ILIKE '%@lid%'
   OR remote_jid ILIKE '%@broadcast%'
   OR remote_jid ILIKE '%@g.us%';

UPDATE public.conversations
SET telefone = regexp_replace(COALESCE(telefone, split_part(remote_jid, '@', 1)), '\D', '', 'g')
WHERE telefone IS DISTINCT FROM regexp_replace(COALESCE(telefone, split_part(remote_jid, '@', 1)), '\D', '', 'g')
  AND regexp_replace(COALESCE(telefone, split_part(remote_jid, '@', 1)), '\D', '', 'g') <> '';

UPDATE public.conversations
SET remote_jid = telefone || '@s.whatsapp.net'
WHERE telefone ~ '^\d{8,15}$'
  AND provider = 'evolution'
  AND (remote_jid IS NULL OR remote_jid NOT LIKE '%@s.whatsapp.net');

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY COALESCE(tenant_id::text, 'master'), telefone
           ORDER BY ultima_interacao DESC NULLS LAST, created_at DESC
         ) AS rn
  FROM public.conversations
  WHERE telefone ~ '^\d{8,15}$'
)
UPDATE public.messages m
SET conversation_id = keep.id
FROM ranked dup
JOIN ranked keep
  ON keep.rn = 1
 AND dup.rn > 1
 AND keep.id <> dup.id
WHERE m.conversation_id = dup.id;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY COALESCE(tenant_id::text, 'master'), telefone
           ORDER BY ultima_interacao DESC NULLS LAST, created_at DESC
         ) AS rn
  FROM public.conversations
  WHERE telefone ~ '^\d{8,15}$'
)
DELETE FROM public.conversations
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS conversations_tenant_phone_uniq
  ON public.conversations (COALESCE(tenant_id::text, 'master'), telefone)
  WHERE telefone ~ '^\d{8,15}$';