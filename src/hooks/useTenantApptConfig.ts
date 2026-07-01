import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface TeamMember { name: string; role?: string }
export interface DayHours { start: string; end: string; closed: boolean }
export interface WorkingHours {
  mon: DayHours; tue: DayHours; wed: DayHours;
  thu: DayHours; fri: DayHours; sat: DayHours; sun: DayHours;
}
export interface TenantApptConfig {
  id?: string;
  tenant_id: string;
  appointment_types: string[];
  team_members: TeamMember[];
  working_hours: WorkingHours;
  default_duration_minutes: number;
}

const DEFAULT_HOURS: WorkingHours = {
  mon: { start: "08:00", end: "18:00", closed: false },
  tue: { start: "08:00", end: "18:00", closed: false },
  wed: { start: "08:00", end: "18:00", closed: false },
  thu: { start: "08:00", end: "18:00", closed: false },
  fri: { start: "08:00", end: "18:00", closed: false },
  sat: { start: "09:00", end: "13:00", closed: true },
  sun: { start: "09:00", end: "13:00", closed: true },
};

export function useTenantApptConfig(tenantId: string | undefined) {
  const [config, setConfig] = useState<TenantApptConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId) { setConfig(null); setLoading(false); return; }
    setLoading(true);
    const { data } = await (supabase as any)
      .from("tenant_appointment_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (data) {
      setConfig({
        id: data.id,
        tenant_id: data.tenant_id,
        appointment_types: data.appointment_types || [],
        team_members: (data.team_members || []) as TeamMember[],
        working_hours: (data.working_hours || DEFAULT_HOURS) as WorkingHours,
        default_duration_minutes: data.default_duration_minutes || 60,
      });
    } else {
      setConfig({
        tenant_id: tenantId,
        appointment_types: ["Avaliação", "Consulta", "Retorno", "Procedimento"],
        team_members: [],
        working_hours: DEFAULT_HOURS,
        default_duration_minutes: 60,
      });
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (patch: Partial<TenantApptConfig>) => {
    if (!tenantId || !config) return { error: new Error("no tenant") };
    const next = { ...config, ...patch };
    const payload = {
      tenant_id: tenantId,
      appointment_types: next.appointment_types,
      team_members: next.team_members,
      working_hours: next.working_hours,
      default_duration_minutes: next.default_duration_minutes,
    };
    const { data, error } = await (supabase as any)
      .from("tenant_appointment_config")
      .upsert(payload, { onConflict: "tenant_id" })
      .select()
      .single();
    if (!error && data) {
      setConfig({ ...next, id: data.id });
    }
    return { error };
  }, [tenantId, config]);

  return { config, loading, save, reload: load };
}

export { DEFAULT_HOURS };
