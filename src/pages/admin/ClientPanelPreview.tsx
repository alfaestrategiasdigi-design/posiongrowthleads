import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ClientPanel from "@/components/clients/ClientPanel";
import type { ClientKind } from "@/hooks/useClientData";

/**
 * Rota de VALIDAÇÃO para o ClientPanel (Fase 3, read-only).
 * Rota: /admin/_client-panel-preview
 * Lista alguns pacientes e clínicas-clientes e abre o painel ao clicar.
 * Não plugado nas telas reais ainda (Fase 4).
 */
export default function ClientPanelPreview() {
  const [patients, setPatients] = useState<Array<{ id: string; name: string; tenant_id: string }>>([]);
  const [tenants, setTenants] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [target, setTarget] = useState<{ kind: ClientKind; id: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: t }] = await Promise.all([
        supabase.from("patients").select("id,name,tenant_id").order("created_at", { ascending: false }).limit(20),
        supabase.from("tenants").select("id,name,slug").order("name").limit(20),
      ]);
      setPatients((p as any) ?? []);
      setTenants((t as any) ?? []);
    })();
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">ClientPanel — preview</h1>
        <p className="text-sm text-muted-foreground">
          Somente para validar a Fase 3. Rota interna, não plugada nas telas reais.
          <Badge variant="secondary" className="ml-2">read-only</Badge>
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Pacientes ({patients.length})</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {patients.length === 0 && <span className="text-sm text-muted-foreground">Nenhum paciente encontrado.</span>}
          {patients.map((p) => (
            <Button key={p.id} variant="outline" size="sm" onClick={() => setTarget({ kind: "patient", id: p.id })}>
              {p.name}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Clínicas-cliente / tenants ({tenants.length})</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {tenants.map((t) => (
            <Button key={t.id} variant="outline" size="sm" onClick={() => setTarget({ kind: "tenant_client", id: t.id })}>
              {t.name}
            </Button>
          ))}
        </CardContent>
      </Card>

      <ClientPanel
        kind={target?.kind ?? null}
        id={target?.id ?? null}
        open={!!target}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
