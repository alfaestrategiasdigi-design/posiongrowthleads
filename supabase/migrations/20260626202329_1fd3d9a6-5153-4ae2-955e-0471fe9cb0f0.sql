
-- Apaga mensagens órfãs e conversas inválidas (lid/broadcast/telefone não numérico)
DELETE FROM public.messages
 WHERE conversation_id IN (
   SELECT id FROM public.conversations
    WHERE remote_jid ILIKE '%@lid%'
       OR remote_jid ILIKE '%@broadcast%'
       OR telefone !~ '^[0-9]+$'
 );

DELETE FROM public.conversations
 WHERE remote_jid ILIKE '%@lid%'
    OR remote_jid ILIKE '%@broadcast%'
    OR telefone !~ '^[0-9]+$';

-- Dedup: mantém a mais recente por (tenant_id, remote_jid)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY COALESCE(tenant_id::text,'global'), remote_jid
           ORDER BY ultima_interacao DESC NULLS LAST, created_at DESC
         ) AS rn
    FROM public.conversations
   WHERE remote_jid IS NOT NULL
)
DELETE FROM public.messages WHERE conversation_id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY COALESCE(tenant_id::text,'global'), remote_jid
           ORDER BY ultima_interacao DESC NULLS LAST, created_at DESC
         ) AS rn
    FROM public.conversations
   WHERE remote_jid IS NOT NULL
)
DELETE FROM public.conversations WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Índice único para evitar reentradas duplicadas
CREATE UNIQUE INDEX IF NOT EXISTS conversations_tenant_jid_uniq
  ON public.conversations (COALESCE(tenant_id::text,'global'), remote_jid)
  WHERE remote_jid IS NOT NULL;
