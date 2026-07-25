import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Plug, CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw,
  Search, ExternalLink, Settings2, Server,
} from "lucide-react";

type Tenant = { id: string; name: string; slug: string; status: string | null };
type Conn = {
  id: string;
  tenant_id: string | null;
  provider: string | null;
  instance_url: string | null;
  instance_name: string | null;
  status: string | null;
  updated_at: string | null;
};

type CardRow = {
  tenant: Tenant;
  conn: Conn | null;
  liveStatus: string | null;   // resultado ao vivo do evolution-status
  liveState: string | null;    // open|connecting|close
  testing: boolean;
  lastTestedAt: string | null;
  lastError: string | null;
};

type StatusKind = "connected" | "connecting" | "disconnected" | "error" | "missing" | "unknown";

const kindOf = (r: CardRow): StatusKind => {
  if (!r.conn) return "missing";
  const s = (r.liveStatus ?? r.conn.status ?? "").toLowerCase();
  if (r.lastError) return "error";
  if (s === "connected" || s === "open") return "connected";
  if (s === "connecting" || s === "pending") return "connecting";
  if (s === "disconnected" || s === "closed" || s === "close") return "disconnected";
  if (s === "error" || s === "timeout") return "error";
  return "unknown";
};

const KIND_STYLE: Record<StatusKind, { dot: string; label: string; badge: string; icon: JSX.Element }> = {
  connected:    { dot: "bg-emerald-400 shadow-[0_0_10px_hsl(142_76%_45%/0.7)]", label: "Conectado",     badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 className="w-3 h-3" /> },
  connecting:   { dot: "bg-amber-400 animate-pulse",                             label: "Conectando",    badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",       icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  disconnected: { dot: "bg-rose-500",                                            label: "Desconectado",  badge: "bg-rose-500/10 text-rose-400 border-rose-500/30",          icon: <XCircle className="w-3 h-3" /> },
  error:        { dot: "bg-amber-500",                                           label: "Erro",          badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",       icon: <AlertTriangle className="w-3 h-3" /> },
  missing:      { dot: "bg-muted-foreground/40",                                 label: "Não configurado", badge: "bg-muted text-muted-foreground border-border",           icon: <Plug className="w-3 h-3" /> },
  unknown:      { dot: "bg-muted-foreground/40",                                 label: "Sem status",    badge: "bg-muted text-muted-foreground border-border",             icon: <AlertTriangle className="w-3 h-3" /> },
};

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

export default function WhatsAppConnectionsPage() {
  const [rows, setRows] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [bulkTesting, setBulkTesting] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: tenants }, { data: conns }] = await Promise.all([
      supabase.from("tenants").select("id,name,slug,status").eq("status", "ativo").order("name"),
      supabase.from("zapi_connections")
        .select("id,tenant_id,provider,instance_url,instance_name,status,updated_at")
        .eq("provider", "evolution")
        .order("updated_at", { ascending: false }),
    ]);

    const byTenant = new Map<string, Conn>();
    (conns || []).forEach((c: any) => {
      if (c.tenant_id && !byTenant.has(c.tenant_id)) byTenant.set(c.tenant_id, c);
    });

    const next: CardRow[] = (tenants || []).map((t: any) => ({
      tenant: { id: t.id, name: t.name, slug: t.slug, status: t.status },
      conn: byTenant.get(t.id) || null,
      liveStatus: null,
      liveState: null,
      testing: false,
      lastTestedAt: null,
      lastError: null,
    }));
    setRows(next);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const testOne = async (idx: number) => {
    const row = rows[idx];
    if (!row?.conn?.instance_name) {
      setRows(prev => prev.map((r, i) => i === idx ? {
        ...r, testing: false, lastError: "Sem instância configurada", lastTestedAt: new Date().toISOString(),
      } : r));
      return;
    }
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, testing: true, lastError: null } : r));
    try {
      const { data, error } = await supabase.functions.invoke("evolution-status", {
        body: {
          connection_id: row.conn.id,
          instance_name: row.conn.instance_name,
          tenant_id: row.tenant.id,
        },
      });
      const err = error?.message || (data && data.ok === false ? data.error : null);
      setRows(prev => prev.map((r, i) => i === idx ? {
        ...r,
        testing: false,
        lastTestedAt: new Date().toISOString(),
        liveState: data?.state ?? null,
        liveStatus: data?.status ?? (err ? "error" : "unknown"),
        lastError: err || null,
      } : r));
    } catch (e: any) {
      setRows(prev => prev.map((r, i) => i === idx ? {
        ...r,
        testing: false,
        lastTestedAt: new Date().toISOString(),
        liveStatus: "error",
        lastError: e?.message || "Falha ao consultar",
      } : r));
    }
  };

  const testAll = async () => {
    setBulkTesting(true);
    // roda sequencialmente pra não estourar rate limit
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].conn?.instance_name) {
        // eslint-disable-next-line no-await-in-loop
        await testOne(i);
      }
    }
    setBulkTesting(false);
    toast.success("Verificação concluída");
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.tenant.name.toLowerCase().includes(q) ||
      r.tenant.slug.toLowerCase().includes(q) ||
      (r.conn?.instance_name || "").toLowerCase().includes(q)
    );
  }, [rows, filter]);

  const totals = useMemo(() => {
    const acc = { total: rows.length, connected: 0, offline: 0, missing: 0 };
    rows.forEach(r => {
      const k = kindOf(r);
      if (k === "connected") acc.connected++;
      else if (k === "missing") acc.missing++;
      else acc.offline++;
    });
    return acc;
  }, [rows]);

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-primary/80 mb-1">POSION Master · Operação</p>
          <h1 className="text-3xl font-bold tracking-tight font-display flex items-center gap-2">
            <Plug className="w-7 h-7 text-primary" /> Conexões WhatsApp
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Uma credencial por clínica. Status ao vivo consultando a Evolution — não confia apenas no cache do banco.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Recarregar
          </Button>
          <Button onClick={testAll} disabled={bulkTesting || loading} className="gap-2">
            {bulkTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
            Verificar todas ao vivo
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Clínicas ativas", value: totals.total, cls: "text-foreground" },
          { label: "Conectadas", value: totals.connected, cls: "text-emerald-400" },
          { label: "Offline / erro", value: totals.offline, cls: "text-rose-400" },
          { label: "Sem instância", value: totals.missing, cls: "text-amber-400" },
        ].map(k => (
          <Card key={k.label} className="card-elevated">
            <CardContent className="p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{k.label}</p>
              <p className={`text-2xl font-display ${k.cls}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtro */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Buscar por clínica, slug ou instância"
          className="pl-9"
        />
      </div>

      {/* Grid de cards estilo n8n */}
      {loading ? (
        <div className="py-20 flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando conexões…
        </div>
      ) : filtered.length === 0 ? (
        <Card className="card-elevated">
          <CardContent className="py-10 text-center text-muted-foreground">
            Nenhuma clínica encontrada.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => {
            const idx = rows.indexOf(r);
            const kind = kindOf(r);
            const style = KIND_STYLE[kind];
            const hasConn = !!r.conn;
            return (
              <Card
                key={r.tenant.id}
                className="card-elevated relative overflow-hidden group border-border/70 hover:border-primary/40 transition-colors"
              >
                {/* faixa dourada no topo */}
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/70 to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />

                <CardContent className="p-5 space-y-4">
                  {/* header: avatar + nome + status dot */}
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-primary/10 border border-primary/25 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                      {initials(r.tenant.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate leading-tight">{r.tenant.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate font-mono">/{r.tenant.slug}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0" title={style.label}>
                      <span className={`w-2 h-2 rounded-full ${style.dot}`} aria-hidden />
                    </div>
                  </div>

                  {/* instância */}
                  <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5 space-y-1">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Instância Evolution</p>
                    {hasConn ? (
                      <>
                        <p className="text-sm font-mono truncate">{r.conn!.instance_name || "—"}</p>
                        <p className="text-[10.5px] text-muted-foreground truncate">
                          {r.conn!.instance_url || "sem URL"}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-amber-400 flex items-center gap-1.5">
                        <Plug className="w-3.5 h-3.5" /> Nenhuma instância vinculada
                      </p>
                    )}
                  </div>

                  {/* status + timestamps */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Badge variant="outline" className={`${style.badge} gap-1`}>
                      {style.icon}
                      {style.label}
                      {r.liveState && <span className="opacity-70 ml-1">({r.liveState})</span>}
                    </Badge>
                    <p className="text-[10.5px] text-muted-foreground">
                      {r.lastTestedAt
                        ? <>Ao vivo: {fmtDate(r.lastTestedAt)}</>
                        : <>Cache: {fmtDate(r.conn?.updated_at ?? null)}</>}
                    </p>
                  </div>

                  {r.lastError && (
                    <p className="text-[11px] text-rose-400 flex items-start gap-1.5 leading-snug" title={r.lastError}>
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{r.lastError}</span>
                    </p>
                  )}

                  {/* ações */}
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => testOne(idx)}
                      disabled={r.testing || !hasConn}
                      className="gap-1 flex-1"
                    >
                      {r.testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      Verificar
                    </Button>
                    <Button asChild size="sm" variant="outline" className="gap-1" title="Abrir configuração do tenant">
                      <Link to={`/app/${r.tenant.slug}/config`}>
                        <Settings2 className="w-3.5 h-3.5" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="gap-1" title="Abrir clínica">
                      <Link to={`/app/${r.tenant.slug}/dashboard`}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
