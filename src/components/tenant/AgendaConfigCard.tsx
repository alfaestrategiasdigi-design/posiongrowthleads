import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Plus, X, CalendarCog } from "lucide-react";
import { toast } from "sonner";
import { useTenantApptConfig, DEFAULT_HOURS, type TeamMember, type DayHours } from "@/hooks/useTenantApptConfig";

const DAY_LABELS: Array<[keyof typeof DEFAULT_HOURS, string]> = [
  ["mon", "Segunda"], ["tue", "Terça"], ["wed", "Quarta"], ["thu", "Quinta"],
  ["fri", "Sexta"], ["sat", "Sábado"], ["sun", "Domingo"],
];

export default function AgendaConfigCard({ tenantId }: { tenantId: string }) {
  const { config, loading, save } = useTenantApptConfig(tenantId);
  const [saving, setSaving] = useState(false);
  const [newType, setNewType] = useState("");
  const [newMember, setNewMember] = useState<TeamMember>({ name: "", role: "" });

  if (loading || !config) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarCog className="w-4 h-4 text-primary" /> Agenda</CardTitle></CardHeader>
        <CardContent><Loader2 className="w-4 h-4 animate-spin" /></CardContent>
      </Card>
    );
  }

  const types = config.appointment_types;
  const team = config.team_members;
  const hours = config.working_hours;

  async function persist(patch: Parameters<typeof save>[0]) {
    setSaving(true);
    const { error } = await save(patch);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Agenda atualizada");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><CalendarCog className="w-4 h-4 text-primary" /> Agenda</CardTitle>
        <CardDescription>Tipos, equipe, horários e duração padrão dos atendimentos.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Tipos */}
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Tipos de agendamento</Label>
          <div className="flex flex-wrap gap-2">
            {types.map((t) => (
              <Badge key={t} variant="outline" className="gap-1 pl-2 pr-1 py-1">
                {t}
                <button type="button" onClick={() => persist({ appointment_types: types.filter((x) => x !== t) })} className="hover:text-destructive"><X className="w-3 h-3" /></button>
              </Badge>
            ))}
            {types.length === 0 && <span className="text-xs text-muted-foreground">Nenhum tipo cadastrado</span>}
          </div>
          <div className="flex gap-2">
            <Input placeholder="Ex: Avaliação Gold" value={newType} onChange={(e) => setNewType(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newType.trim()) { persist({ appointment_types: [...types, newType.trim()] }); setNewType(""); } }} />
            <Button variant="outline" size="sm" onClick={() => { if (!newType.trim()) return; persist({ appointment_types: [...types, newType.trim()] }); setNewType(""); }}><Plus className="w-4 h-4" /></Button>
          </div>
        </div>

        {/* Equipe */}
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Membros da equipe</Label>
          <div className="space-y-1">
            {team.map((m, i) => (
              <div key={`${m.name}-${i}`} className="flex items-center justify-between border border-border rounded-md px-3 py-2 bg-card">
                <div className="text-sm">
                  <span className="font-medium">{m.name}</span>
                  {m.role && <span className="text-muted-foreground"> — {m.role}</span>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => persist({ team_members: team.filter((_, x) => x !== i) })}><X className="w-4 h-4" /></Button>
              </div>
            ))}
            {team.length === 0 && <span className="text-xs text-muted-foreground">Nenhum membro cadastrado</span>}
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input placeholder="Nome" value={newMember.name} onChange={(e) => setNewMember({ ...newMember, name: e.target.value })} />
            <Input placeholder="Cargo" value={newMember.role} onChange={(e) => setNewMember({ ...newMember, role: e.target.value })} />
            <Button variant="outline" size="sm" onClick={() => { if (!newMember.name.trim()) return; persist({ team_members: [...team, { name: newMember.name.trim(), role: newMember.role?.trim() || undefined }] }); setNewMember({ name: "", role: "" }); }}><Plus className="w-4 h-4" /></Button>
          </div>
        </div>

        {/* Horários */}
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Horário de funcionamento</Label>
          <div className="space-y-2">
            {DAY_LABELS.map(([key, label]) => {
              const d: DayHours = (hours as any)[key] || { start: "08:00", end: "18:00", closed: false };
              return (
                <div key={key} className="grid grid-cols-[100px_1fr_1fr_auto] gap-2 items-center">
                  <span className="text-sm">{label}</span>
                  <Input type="time" value={d.start} disabled={d.closed} onChange={(e) => persist({ working_hours: { ...hours, [key]: { ...d, start: e.target.value } } as any })} />
                  <Input type="time" value={d.end} disabled={d.closed} onChange={(e) => persist({ working_hours: { ...hours, [key]: { ...d, end: e.target.value } } as any })} />
                  <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={d.closed} onChange={(e) => persist({ working_hours: { ...hours, [key]: { ...d, closed: e.target.checked } } as any })} />
                    Fechado
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        {/* Duração padrão */}
        <div className="space-y-2 max-w-xs">
          <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Duração padrão (min)</Label>
          <div className="flex gap-2">
            <Input type="number" min={5} value={config.default_duration_minutes} onChange={(e) => persist({ default_duration_minutes: Number(e.target.value) || 60 })} />
            <Button variant="outline" size="sm" disabled={saving}><Save className="w-4 h-4" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
