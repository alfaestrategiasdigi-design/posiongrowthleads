
-- 1) Marca o conjunto envenenado
WITH poisoned_phones AS (
  SELECT tenant_id, phone_jid
  FROM public.whatsapp_jid_aliases
  WHERE quarantined_at IS NULL
    AND phone_jid LIKE '%@s.whatsapp.net'
  GROUP BY tenant_id, phone_jid
  HAVING count(*) > 2
),
to_quarantine AS (
  SELECT a.id
  FROM public.whatsapp_jid_aliases a
  WHERE a.quarantined_at IS NULL
    AND (
      length(regexp_replace(split_part(a.phone_jid,'@',1), '\D', '', 'g')) < 10
      OR EXISTS (
        SELECT 1 FROM poisoned_phones p
        WHERE p.phone_jid = a.phone_jid
          AND (p.tenant_id IS NOT DISTINCT FROM a.tenant_id)
      )
    )
)
UPDATE public.whatsapp_jid_aliases a
SET quarantined_at = now(),
    quarantine_reason = COALESCE(a.quarantine_reason, 'poisoned_sink_cleanup_2026_07_25')
FROM to_quarantine q
WHERE a.id = q.id;

-- 2) Split das mensagens misfiled em conversas que ficaram como "sink"
DO $$
DECLARE
  msg RECORD;
  target_conv UUID;
  lid TEXT;
BEGIN
  FOR msg IN
    SELECT m.id,
           c.tenant_id,
           m.conversation_id,
           m.metadata->'raw_key'->>'remoteJid' AS rjid,
           m.created_at,
           m.conteudo
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE c.remote_jid IN (
      SELECT DISTINCT phone_jid
      FROM public.whatsapp_jid_aliases
      WHERE quarantine_reason = 'poisoned_sink_cleanup_2026_07_25'
    )
    AND m.metadata->'raw_key'->>'remoteJid' LIKE '%@lid'
    AND m.metadata->'raw_key'->>'remoteJid' <> c.remote_jid
  LOOP
    lid := msg.rjid;

    SELECT id INTO target_conv
    FROM public.conversations
    WHERE remote_jid = lid
      AND (tenant_id IS NOT DISTINCT FROM msg.tenant_id)
    LIMIT 1;

    IF target_conv IS NULL THEN
      INSERT INTO public.conversations
        (tenant_id, remote_jid, telefone, nome_contato,
         needs_lid_review, lid_review_notes, provider,
         ultima_interacao, ultima_mensagem)
      VALUES
        (msg.tenant_id, lid, split_part(lid,'@',1), split_part(lid,'@',1),
         true, 'auto_split_from_poisoned_alias_sink_2026_07_25', 'evolution',
         msg.created_at, LEFT(COALESCE(msg.conteudo,''), 200))
      RETURNING id INTO target_conv;
    END IF;

    UPDATE public.messages
    SET conversation_id = target_conv
    WHERE id = msg.id;
  END LOOP;
END $$;

-- 3) Recalcula ultima_mensagem / ultima_interacao em conversas afetadas
WITH latest AS (
  SELECT DISTINCT ON (conversation_id)
    conversation_id,
    created_at,
    conteudo
  FROM public.messages
  ORDER BY conversation_id, created_at DESC
)
UPDATE public.conversations c
SET ultima_interacao = latest.created_at,
    ultima_mensagem = LEFT(COALESCE(latest.conteudo,''), 500)
FROM latest
WHERE c.id = latest.conversation_id
  AND (c.ultima_interacao IS DISTINCT FROM latest.created_at
       OR c.ultima_mensagem IS DISTINCT FROM LEFT(COALESCE(latest.conteudo,''), 500));
