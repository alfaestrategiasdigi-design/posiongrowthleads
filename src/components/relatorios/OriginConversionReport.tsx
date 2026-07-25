import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp } from "lucide-react";
import { BRL } from "@/lib/clinic-kpis";

interface Props { tenantId: string }

type Row = {
  origem: string;
  totalLeads: number;
  convertidos: number;
  receita: number;
};

async function fetchAll<T>(table: "leads" | "sales", tenantId: string, select: string): Promise<T[]> {
  const pageSize = 1000;
  let from = 0;
  const out: T[] = [];
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq("tenant_id", tenantId)
      .range(from, from + pageSize - 1);
    if (error || !data) break;
    out.push(...(data as unknown as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export default function OriginConversionReport({ tenantId }: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      setLoading(true);
      const [leads, sales] = await Promise.all([
        fetchAll<{ id: string; origem: string | null }>("leads", tenantId, "id,origem"),
        fetchAll<{ lead_id: string | null; amount: number | null }>("sales", tenantId, "lead_id,amount"),
      ]);

      const salesByLead = new Map<string, number>();
      for (const s of sales) {
        if (!s.lead_id) continue;
        salesByLead.set(s.lead_id, (salesByLead.get(s.lead_id) || 0) + Number(s.amount || 0));
      }

      const acc = new Map<string, Row>();
      for (const l of leads) {
        const key = (l.origem || "sem_origem").toLowerCase();
        const r = acc.get(key) || { origem: key, totalLeads: 0, convertidos: 0, receita: 0 };
        r.totalLeads += 1;
        const rev = salesByLead.get(l.id);
        if (rev !== undefined) {
          r.convertidos += 1;
          r.receita += rev;
        }
        acc.set(key, r);
      }

      const list = Array.from(acc.values()).sort((a, b) => b.totalLeads - a.totalLeads);
      setRows(list);
      setLoading(false);
    })();
  }, [tenantId]);

  const totals = useMemo(() => rows.reduce(
    (t, r) => ({ leads: t.leads + r.totalLeads, conv: t.conv + r.convertidos, rev: t.rev + r.receita }),
    { leads: 0, conv: 0, rev: 0 }
  ), [rows]);

  return (
    <Card className="premium-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="w-4 h-4 text-accent" />
          Conversão por origem · Leads importados × Fechamentos
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Cruza todos os leads do tenant com as vendas vinculadas por <code>lead_id</code>. Origens como <b>whatsapp_import</b> mostram quantos leads viraram pacientes pagantes.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-8 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Sem leads registrados neste tenant.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Convertidos</TableHead>
                <TableHead className="text-right">Taxa</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">Ticket médio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const rate = r.totalLeads > 0 ? (r.convertidos / r.totalLeads) * 100 : 0;
                const avg = r.convertidos > 0 ? r.receita / r.convertidos : 0;
                return (
                  <TableRow key={r.origem}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px]">{r.origem}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{r.totalLeads}</TableCell>
                    <TableCell className="text-right font-medium text-emerald-500">{r.convertidos}</TableCell>
                    <TableCell className="text-right">
                      <span className={rate > 0 ? "text-emerald-500 font-medium" : "text-muted-foreground"}>
                        {rate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium">{BRL(r.receita)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.convertidos > 0 ? BRL(avg) : "—"}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/30 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{totals.leads}</TableCell>
                <TableCell className="text-right text-emerald-500">{totals.conv}</TableCell>
                <TableCell className="text-right">
                  {totals.leads > 0 ? ((totals.conv / totals.leads) * 100).toFixed(1) : "0.0"}%
                </TableCell>
                <TableCell className="text-right">{BRL(totals.rev)}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {totals.conv > 0 ? BRL(totals.rev / totals.conv) : "—"}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
