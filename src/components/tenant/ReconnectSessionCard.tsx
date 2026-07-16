import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, RefreshCcw, CheckCircle2, QrCode } from "lucide-react";
import { toast } from "sonner";

interface Props {
  tenantId: string;
  connectionId: string | null;
  instanceName: string;
  /** Called when the reconnect flow reports the session is receiving messages again. */
  onHealthy?: () => void;
}

type Phase = "idle" | "reconnecting" | "awaiting_scan" | "waiting_first_message" | "healthy" | "error";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Card de reconexão de emergência para sessão Evolution/Baileys travada.
 * Fluxo:
 * 1. Chama edge function `evolution-reconnect` (logout + connect).
 * 2. Exibe QR code para o dono do número escanear no celular.
 * 3. Faz polling na tabela `messages` procurando uma mensagem inbound nova com
 *    `created_at > reconnect_started_at`. Só então a sessão está sadia.
 */
export default function ReconnectSessionCard({ tenantId, connectionId, instanceName, onHealthy }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [lastMessage, setLastMessage] = useState<{ content: string; created_at: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const startTsRef = useRef<number>(0);

  const stopPolling = () => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
  };

  useEffect(() => () => stopPolling(), []);

  const startPolling = (sinceIso: string) => {
    stopPolling();
    startTsRef.current = Date.now();
    tickRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTsRef.current) / 1000));
    }, 1000);
    pollRef.current = window.setInterval(async () => {
      // Timeout: para de esperar após POLL_TIMEOUT_MS
      if (Date.now() - startTsRef.current > POLL_TIMEOUT_MS) {
        stopPolling();
        setPhase("error");
        setError("Tempo esgotado — a sessão não confirmou conexão em 5 min. Verifique se o celular escaneou o QR.");
        return;
      }
      // 1) Sinal primário: status da conexão flipou para 'connected' após o reconnect.
      if (connectionId) {
        const { data: conn } = await supabase
          .from("zapi_connections")
          .select("status, updated_at")
          .eq("id", connectionId)
          .maybeSingle();
        if (conn && (conn.status === "connected" || conn.status === "open") && conn.updated_at && conn.updated_at > sinceIso) {
          stopPolling();
          setPhase("healthy");
          toast.success("Sessão reconectada com sucesso");
          onHealthy?.();
          return;
        }
      }
      // 2) Sinal secundário (opcional): se já chegou mensagem inbound nova, também confirma.
      const { data } = await supabase
        .from("messages")
        .select("id, conteudo, created_at, direction")
        .eq("tenant_id", tenantId)
        .eq("direction", "inbound")
        .gt("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        stopPolling();
        setLastMessage({ content: (data.conteudo || "(mídia)").slice(0, 120), created_at: data.created_at });
        setPhase("healthy");
        toast.success("Sessão restaurada — mensagens fluindo");
        onHealthy?.();
      }
    }, POLL_INTERVAL_MS);
  };

  const runReconnect = async () => {
    if (!connectionId) {
      toast.error("Nenhuma conexão Evolution configurada");
      return;
    }
    setPhase("reconnecting");
    setQr(null);
    setPairingCode(null);
    setError(null);
    setLastMessage(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("evolution-reconnect", {
        body: { connection_id: connectionId },
      });
      if (fnErr || data?.error) throw new Error(data?.error || fnErr?.message || "Falha no reconnect");
      const q: string | null = data?.qr ?? null;
      if (q) {
        setQr(q.startsWith("data:") ? q : `data:image/png;base64,${q.replace(/^data:[^,]+,/, "")}`);
      }
      setPairingCode(data?.pairing_code ?? null);
      const since: string = data?.reconnect_started_at ?? new Date().toISOString();
      setStartedAt(since);
      setPhase(q || data?.pairing_code ? "awaiting_scan" : "waiting_first_message");
      startPolling(since);
      toast.success(q ? "QR code gerado — escaneie no celular" : "Sessão reiniciada — aguardando mensagens");
    } catch (e: any) {
      setPhase("error");
      setError(e.message || "Erro ao reconectar");
      toast.error(e.message || "Falha ao reconectar");
    }
  };

  const cancel = () => {
    stopPolling();
    setPhase("idle");
    setQr(null);
    setPairingCode(null);
    setError(null);
    setStartedAt(null);
    setElapsed(0);
  };

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Reconectar sessão do WhatsApp
            </CardTitle>
            <CardDescription>
              Use quando a instância <code className="text-xs bg-muted px-1 rounded">{instanceName || "—"}</code> aparenta "conectada" mas
              não recebe mais mensagens novas. Vai encerrar a sessão atual e gerar um novo QR code.
            </CardDescription>
          </div>
          <PhaseBadge phase={phase} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {phase === "idle" && (
          <>
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Isso é seguro?</p>
              <ul className="list-disc pl-4 space-y-0.5 text-xs">
                <li>Histórico de conversas e mensagens no sistema <strong>não é apagado</strong>.</li>
                <li>O celular vai pedir para escanear o QR novamente em <em>Dispositivos conectados</em>.</li>
                <li>Após o scan, esperamos automaticamente uma mensagem nova para confirmar que a sessão está sadia.</li>
              </ul>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="reconnect-confirm"
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
                className="accent-primary"
              />
              <label htmlFor="reconnect-confirm" className="text-sm select-none cursor-pointer">
                Estou com o celular do número em mãos e pronto para escanear
              </label>
            </div>
            <Button
              onClick={runReconnect}
              disabled={!confirm || !connectionId}
              variant="default"
              className="gap-2"
            >
              <RefreshCcw className="w-4 h-4" /> Reconectar agora
            </Button>
          </>
        )}

        {phase === "reconnecting" && (
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            Encerrando sessão atual e gerando QR…
          </div>
        )}

        {(phase === "awaiting_scan" || phase === "waiting_first_message") && (
          <div className="space-y-3">
            {qr && (
              <div className="border border-border rounded-lg p-4 flex flex-col items-center bg-card">
                <p className="text-xs text-muted-foreground mb-3">
                  Escaneie em <strong>WhatsApp &gt; Dispositivos conectados &gt; Conectar aparelho</strong>
                </p>
                <img src={qr} alt="QR Code" className="w-56 h-56 rounded-md bg-white p-2" />
              </div>
            )}
            {pairingCode && !qr && (
              <div className="border border-border rounded-lg p-4 flex flex-col items-center bg-card">
                <p className="text-xs text-muted-foreground mb-2">Ou use o código de pareamento:</p>
                <p className="font-mono text-2xl tracking-widest">{pairingCode}</p>
              </div>
            )}
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm space-y-1">
              <p className="flex items-center gap-2 font-medium">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                 Conectada, aguardando mensagem de teste… ({formatElapsed(elapsed)})
              </p>
              <p className="text-xs text-muted-foreground">
                 Envie uma mensagem de outro WhatsApp para este número. Somente uma nova mensagem recebida confirma que a sessão está saudável.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={runReconnect} className="gap-2">
                <QrCode className="w-3.5 h-3.5" /> Gerar novo QR
              </Button>
              <Button variant="ghost" size="sm" onClick={cancel}>Cancelar</Button>
            </div>
          </div>
        )}

        {phase === "healthy" && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-500">
              <CheckCircle2 className="w-4 h-4" /> Sessão saudável — mensagens sendo recebidas
            </p>
            {lastMessage && (
              <div className="text-xs text-muted-foreground">
                Primeira mensagem confirmada em{" "}
                <span className="text-foreground">
                  {new Date(lastMessage.created_at).toLocaleString("pt-BR")}
                </span>
                : <span className="italic">"{lastMessage.content}"</span>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={cancel}>Fechar</Button>
          </div>
        )}

        {phase === "error" && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 space-y-2">
            <p className="text-sm font-medium text-destructive">Falha ao reconectar</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={runReconnect} className="gap-2">
                <RefreshCcw className="w-3.5 h-3.5" /> Tentar de novo
              </Button>
              <Button variant="ghost" size="sm" onClick={cancel}>Fechar</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  if (phase === "healthy")
    return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30" variant="outline">Saudável</Badge>;
  if (phase === "awaiting_scan")
    return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30" variant="outline">Aguardando scan</Badge>;
  if (phase === "waiting_first_message")
    return <Badge className="bg-primary/15 text-primary border-primary/30" variant="outline">Aguardando msg</Badge>;
  if (phase === "reconnecting")
    return <Badge className="bg-primary/15 text-primary border-primary/30" variant="outline">Reconectando…</Badge>;
  if (phase === "error")
    return <Badge className="bg-destructive/15 text-destructive border-destructive/30" variant="outline">Erro</Badge>;
  return null;
}

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}min ${rem}s` : `${rem}s`;
}
