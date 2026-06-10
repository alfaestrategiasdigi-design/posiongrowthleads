import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, UserCircle2 } from "lucide-react";
import { BRL, type SaleRow } from "@/lib/clinic-kpis";

interface PatientAgg { name: string; salesCount: number; total: number; firstContact: string | null; lastSale: string; channels: Set<string> }

export default function TenantPatients() {
  const { tenant } = useTenant();
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);
    supabase.from("sales").select("*").eq("tenant_id", tenant.id).order("sale_date", { ascending: false })
      .then(({ data }) => { setSales((data || []) as SaleRow[]); setLoading(false); });
  }, [tenant]);

  const patients = useMemo<PatientAgg[]>(() => {
    const map = new Map<string, PatientAgg>();
    for (const s of sales) {
      const k = s.patient_name;
      const a = map.get(k) || { name: k, salesCount: 0, total: 0, firstContact: s.first_contact_date, lastSale: s.sale_date, channels: new Set<string>() };
      a.salesCount += 1;
      a.total += Number(s.amount);
      if (s.channel) a.channels.add(s.channel);
      if (!a.firstContact || (s.first_contact_date && s.first_contact_date < a.firstContact)) a.firstContact = s.first_contact_date;
      if (s.sale_date > a.lastSale) a.lastSale = s.sale_date;
      map.set(k, a);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [sales]);

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return patients.filter((p) => !s || p.name.toLowerCase().includes(s));
  }, [patients, q]);

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pacientes</h1>
          <p className="text-muted-foreground">{filtered.length} pacientes únicos</p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Lista de Pacientes</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Canais</TableHead>
                  <TableHead>1º Contato</TableHead>
                  <TableHead>Última Venda</TableHead>
                  <TableHead className="text-right">Vendas</TableHead>
                  <TableHead className="text-right">Total Gasto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="font-medium flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center"><UserCircle2 className="w-4 h-4 text-primary" /></div>
                      <span>{p.name}</span>
                      {p.salesCount > 1 && <Badge variant="outline" className="ml-1">recorrente</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">{Array.from(p.channels).join(" · ") || "—"}</TableCell>
                    <TableCell className="text-sm">{p.firstContact ? new Date(p.firstContact + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell className="text-sm">{new Date(p.lastSale + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="text-right">{p.salesCount}</TableCell>
                    <TableCell className="text-right font-semibold">{BRL(p.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
