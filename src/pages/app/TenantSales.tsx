import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search } from "lucide-react";
import { BRL, type SaleRow } from "@/lib/clinic-kpis";

export default function TenantSales() {
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

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return sales.filter((r) =>
      !s ||
      r.patient_name.toLowerCase().includes(s) ||
      (r.product || "").toLowerCase().includes(s) ||
      (r.seller_name || "").toLowerCase().includes(s) ||
      (r.channel || "").toLowerCase().includes(s)
    );
  }, [sales, q]);

  const total = filtered.reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fechamentos</h1>
          <p className="text-muted-foreground">{filtered.length} vendas · {BRL(total)}</p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente, produto, vendedor..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Lista de Fechamentos</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Pagto</TableHead>
                  <TableHead>Compareceu</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-sm">{new Date(s.sale_date + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="font-medium">{s.patient_name}</TableCell>
                    <TableCell className="text-sm">{s.product}</TableCell>
                    <TableCell className="text-sm">{s.seller_name}</TableCell>
                    <TableCell className="text-sm">{s.channel}</TableCell>
                    <TableCell className="text-sm">{s.payment_method}</TableCell>
                    <TableCell>
                      {s.attended === "SIM" && <Badge className="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20">SIM</Badge>}
                      {s.attended === "NÃO" && <Badge className="bg-rose-500/15 text-rose-400 hover:bg-rose-500/20">NÃO</Badge>}
                      {s.attended === "FUTURA" && <Badge className="bg-sky-500/15 text-sky-400 hover:bg-sky-500/20">FUTURA</Badge>}
                      {(!s.attended || s.attended === "-") && <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{BRL(Number(s.amount))}</TableCell>
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
