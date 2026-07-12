# Testes de integração — triggers de promoção

Cobrem `trg_promote_lead_to_patient` e `trg_promote_agency_lead_to_client`
(mais `trg_create_contract_on_ganho`) validando:

1. Promoção para `ganho` cria `patients` / `tenant_client_profile` / `agency_contracts`.
2. **Idempotência**: mover `ganho ↔ ativo` não duplica nada.
3. **Reversão**: sair de `ganho`/`ativo` para `negociacao` preenche `promotion_reverted_at`.
4. **Reativação**: voltar para `ganho` limpa `promotion_reverted_at` (nunca deleta).
5. Transição lateral `ganho → ativo` **não** dispara reversão.
6. Lead sem `tenant_id` **não** cria paciente (Master não vaza para clínica).

Todo o teste roda dentro de uma transação com `ROLLBACK` no final — não persiste dados.

## Como rodar

Precisa de um usuário Postgres com permissão de UPDATE nas tabelas (owner / superuser).
No SQL editor do backend (Lovable Cloud → Backend → SQL) cole o conteúdo do arquivo,
ou localmente com a URL do banco:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/promotion_triggers.test.sql
```

Sucesso = a última linha imprime `ALL PROMOTION TRIGGER TESTS PASSED ✓` e a tx faz `ROLLBACK`.
Qualquer `FAIL n:` aborta a execução com código de erro (ideal para CI).
