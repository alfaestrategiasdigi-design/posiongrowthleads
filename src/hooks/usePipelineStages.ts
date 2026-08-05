import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface StageDef {
  id: string; // stage_key (ex.: "lead", "ganho", "custom_ab12cd34")
  title: string;
  short: string;
  color: string;
  hex: string;
  isSystem?: boolean;
  rowId?: string; // pipeline_stages.id
}

type DefaultStage = { id: string; title: string; short: string; color: string; hex: string };

// Etapas protegidas: alimentam automações (venda, perda, paciente ativo) e não podem ser excluídas.
const PROTECTED_KEYS = new Set(["lead", "ganho", "perdido", "ativo"]);

function mapRow(r: any): StageDef {
  return {
    id: r.stage_key,
    title: r.title,
    short: r.short,
    color: r.color,
    hex: r.hex,
    isSystem: !!r.is_system,
    rowId: r.id,
  };
}

async function selectStages(tenantId: string | null) {
  let q = (supabase as any)
    .from("pipeline_stages")
    .select("*")
    .order("position", { ascending: true });
  q = tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) return null;
  return (data || []) as any[];
}

/**
 * Carrega as etapas do Kanban do escopo (tenant ou master global, tenantId = null).
 * Semeia a tabela com o funil padrão na primeira vez; se o usuário não tiver
 * permissão de escrita, usa o funil padrão em memória.
 */
export function usePipelineStages(
  tenantId: string | null | undefined,
  defaults: readonly DefaultStage[],
) {
  const [stages, setStages] = useState<StageDef[]>(() => defaults.map((d) => ({ ...d })));
  const [loading, setLoading] = useState(true);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const load = useCallback(async () => {
    if (tenantId === undefined) return;
    setLoading(true);
    const rows = await selectStages(tenantId);
    if (rows && rows.length > 0) {
      setStages(rows.map(mapRow));
      setLoading(false);
      return;
    }
    // Primeira vez: semear com o funil padrão
    const seedRows = defaultsRef.current.map((d, i) => ({
      tenant_id: tenantId,
      stage_key: d.id,
      title: d.title,
      short: d.short,
      color: d.color,
      hex: d.hex,
      position: i,
      is_system: PROTECTED_KEYS.has(d.id),
    }));
    await (supabase as any).from("pipeline_stages").insert(seedRows);
    const seeded = await selectStages(tenantId);
    if (seeded && seeded.length > 0) setStages(seeded.map(mapRow));
    // Se falhar (sem permissão), mantém o funil padrão em memória.
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  return { stages, loading, refresh: load };
}
