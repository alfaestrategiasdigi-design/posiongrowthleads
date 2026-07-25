DO $$
DECLARE
  v_tenant uuid;
  v_wrong  uuid := '102b4b20-ca7c-4214-ae8a-316a50f6a7a4';
  v_new    uuid;
  v_moved  int;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug='gabriel-lourenco';

  INSERT INTO conversations (tenant_id, remote_jid, telefone, nome_contato, needs_lid_review, lid_review_notes, ultima_interacao, created_at)
  VALUES (v_tenant, '53042896490702@lid', '53042896490702', 'Contato @lid não resolvido', true,
          'Backfill: 75 mensagens outbound foram movidas da conversa de Alexandre Amorim (557781178291) porque o raw_key.remoteJid é 53042896490702@lid — LID diferente do LID canônico do Alexandre (110041474535454@lid).',
          now(), now())
  RETURNING id INTO v_new;

  UPDATE messages SET conversation_id = v_new
  WHERE conversation_id = v_wrong
    AND metadata->'raw_key'->>'remoteJid' = '53042896490702@lid';
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  UPDATE conversations SET
    ultima_mensagem = (SELECT conteudo FROM messages WHERE conversation_id=v_new ORDER BY created_at DESC LIMIT 1),
    ultima_interacao = (SELECT max(created_at) FROM messages WHERE conversation_id=v_new)
  WHERE id=v_new;

  -- Se a conversa do Alexandre ficou vazia, apaga; senão recalcula last message.
  IF NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id=v_wrong) THEN
    DELETE FROM conversations WHERE id=v_wrong;
  ELSE
    UPDATE conversations SET
      ultima_mensagem = (SELECT conteudo FROM messages WHERE conversation_id=v_wrong ORDER BY created_at DESC LIMIT 1),
      ultima_interacao = (SELECT max(created_at) FROM messages WHERE conversation_id=v_wrong)
    WHERE id=v_wrong;
  END IF;

  RAISE NOTICE 'Moved % messages to new conversation %', v_moved, v_new;
END $$;