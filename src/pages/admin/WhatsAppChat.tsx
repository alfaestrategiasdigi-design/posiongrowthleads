import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Search, Send, Paperclip, Phone, MoreVertical, User, MessageCircle, Smile,
  Settings, QrCode, Copy, CheckCircle2, XCircle, Loader2, Wifi, WifiOff, RefreshCw,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Conversation, Message } from "@/types/admin";

const PROJECT_REF = "mbhbflbuawkmtmpjazcj";
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/whatsapp-webhook`;

type EvoConn = {
  id?: string;
  instance_url: string;
  api_key: string;
  instance_name: string;
  status: string;
};

const WhatsAppChat = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Config dialog
  const [cfgOpen, setCfgOpen] = useState(false);
  const [conn, setConn] = useState<EvoConn>({ instance_url: "", api_key: "", instance_name: "", status: "disconnected" });
  const [qr, setQr] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .order("ultima_interacao", { ascending: false });
    setConversations((data as Conversation[]) || []);
    setLoading(false);
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    setMessages((data as Message[]) || []);
  }, []);

  const loadConn = useCallback(async () => {
    const { data } = await supabase
      .from("zapi_connections")
      .select("id, instance_url, instance_name, api_key, status")
      .eq("provider", "evolution")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setConn({
        id: data.id,
        instance_url: data.instance_url || "",
        api_key: data.api_key || "",
        instance_name: data.instance_name || "",
        status: data.status || "disconnected",
      });
    }
  }, []);

  useEffect(() => {
    loadConversations();
    loadConn();

    const channel = supabase
      .channel("wa-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        const row: any = payload.new ?? payload.old;
        if (row?.conversation_id && selectedConversation && row.conversation_id === selectedConversation.id) {
          loadMessages(selectedConversation.id);
        }
        loadConversations();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        loadConversations();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversation?.id]);

  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation.id);
      // mark as read
      supabase.from("conversations").update({ nao_lidas: 0 }).eq("id", selectedConversation.id).then(() => {});
    }
  }, [selectedConversation, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || sending) return;
    const body = newMessage.trim();
    setSending(true);
    setNewMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("evolution-send", {
        body: { conversation_id: selectedConversation.id, body },
      });
      if (error || (data as any)?.error) {
        toast.error("Falha ao enviar", { description: (data as any)?.error || error?.message });
        setNewMessage(body);
      } else {
        loadMessages(selectedConversation.id);
        loadConversations();
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleConnect = async () => {
    if (!conn.instance_url || !conn.api_key || !conn.instance_name) {
      toast.error("Preencha URL, API Key e nome da instância");
      return;
    }
    setConnecting(true);
    setQr(null);
    try {
      const { data, error } = await supabase.functions.invoke("evolution-connect", {
        body: {
          instance_url: conn.instance_url,
          api_key: conn.api_key,
          instance_name: conn.instance_name,
        },
      });
      if (error || (data as any)?.error) {
        toast.error("Falha ao conectar", { description: (data as any)?.error || error?.message });
      } else {
        const qrCode = (data as any)?.qr;
        if (qrCode) {
          setQr(qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode.replace(/^data:[^,]+,/, "")}`);
          toast.success("QR Code gerado — escaneie no WhatsApp");
        } else {
          toast.success("Conectado", { description: "Sem QR — instância já vinculada." });
        }
        loadConn();
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!conn.instance_name) return;
    setCheckingStatus(true);
    try {
      const { data, error } = await supabase.functions.invoke("evolution-status", {
        body: { instance_name: conn.instance_name },
      });
      if (error || (data as any)?.error) {
        toast.error("Falha ao consultar status", { description: (data as any)?.error || error?.message });
      } else {
        const status = (data as any)?.status || "disconnected";
        setConn(c => ({ ...c, status }));
        toast.success(`Status: ${status}`);
        if (status === "connected") setQr(null);
      }
    } finally {
      setCheckingStatus(false);
    }
  };

  const copyWebhook = () => {
    navigator.clipboard.writeText(WEBHOOK_URL);
    toast.success("Webhook copiado");
  };

  const filteredConversations = conversations.filter(c =>
    !searchQuery || (c.nome_contato || c.telefone).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "";
    try { return format(new Date(dateStr), "HH:mm"); } catch { return ""; }
  };
  const formatMessageTime = (dateStr: string) => {
    try { return format(new Date(dateStr), "HH:mm"); } catch { return ""; }
  };

  const statusBadge = () => {
    if (conn.status === "connected") return <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 gap-1"><Wifi className="w-3 h-3" />Conectado</Badge>;
    if (conn.status === "connecting") return <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 gap-1"><Loader2 className="w-3 h-3 animate-spin" />Pareando</Badge>;
    return <Badge variant="outline" className="border-rose-500/30 text-rose-300 gap-1"><WifiOff className="w-3 h-3" />Desconectado</Badge>;
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar de Conversas */}
      <div className="w-[300px] border-r border-border flex flex-col bg-card/50 shrink-0">
        {/* Header with status + config */}
        <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
          {statusBadge()}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCfgOpen(true)} title="Configurar Evolution API">
            <Settings className="w-4 h-4" />
          </Button>
        </div>
        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Pesquisar conversas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-muted/50 border-none text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <MessageCircle className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm">Nenhuma conversa ainda</p>
              <p className="text-muted-foreground text-xs mt-1">As mensagens da Evolution aparecerão aqui</p>
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setSelectedConversation(conv)}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors border-b border-border/30 ${
                  selectedConversation?.id === conv.id ? "bg-muted/50" : ""
                }`}
              >
                <div className="w-11 h-11 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                  {conv.foto_url ? (
                    <img src={conv.foto_url} alt="" className="w-full h-full rounded-full object-cover" />
                  ) : (
                    <User className="w-5 h-5 text-accent" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-foreground truncate">
                      {conv.nome_contato || conv.telefone}
                    </h4>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                      {formatTime(conv.ultima_interacao)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-xs text-muted-foreground truncate">
                      {conv.ultima_mensagem || "Sem mensagens"}
                    </p>
                    {conv.nao_lidas > 0 && (
                      <span className="w-5 h-5 rounded-full bg-accent text-accent-foreground text-[10px] flex items-center justify-center font-bold shrink-0 ml-2">
                        {conv.nao_lidas}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat Window */}
      {selectedConversation ? (
        <div className="flex-1 flex flex-col">
          <div className="h-16 border-b border-border flex items-center justify-between px-4 bg-card/50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <User className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {selectedConversation.nome_contato || selectedConversation.telefone}
                </h3>
                <p className="text-xs text-muted-foreground">{selectedConversation.telefone}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-9 w-9"><Phone className="w-4 h-4 text-muted-foreground" /></Button>
              <Button variant="ghost" size="icon" className="h-9 w-9"><MoreVertical className="w-4 h-4 text-muted-foreground" /></Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#050816]/60">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full bg-muted/30 flex items-center justify-center mx-auto mb-4">
                    <MessageCircle className="w-10 h-10 text-muted-foreground/50" />
                  </div>
                  <p className="text-muted-foreground text-sm">Nenhuma mensagem nesta conversa</p>
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isOut = msg.sender === "usuario";
                return (
                  <div key={msg.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                        isOut
                          ? "rounded-br-md text-[#1a1208]"
                          : "rounded-bl-md text-foreground border border-border/50"
                      }`}
                      style={isOut
                        ? { background: "#c9a84c" }
                        : { background: "#0d1426" }}
                    >
                      <p className="text-sm whitespace-pre-wrap break-words">{msg.conteudo}</p>
                      <p className={`text-[10px] mt-1 text-right ${isOut ? "text-[#1a1208]/60" : "text-muted-foreground"}`}>
                        {formatMessageTime(msg.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 border-t border-border bg-card/50 shrink-0">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0"><Smile className="w-5 h-5 text-muted-foreground" /></Button>
              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0"><Paperclip className="w-5 h-5 text-muted-foreground" /></Button>
              <Input
                placeholder="Digite uma mensagem..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyPress}
                disabled={sending}
                className="flex-1 bg-muted/50 border-none h-10"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!newMessage.trim() || sending}
                size="icon"
                className="h-10 w-10 rounded-full bg-accent hover:bg-accent/90 shrink-0"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-background/50">
          <div className="text-center max-w-sm">
            <div className="w-24 h-24 rounded-full bg-muted/20 flex items-center justify-center mx-auto mb-6">
              <MessageCircle className="w-12 h-12 text-muted-foreground/30" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">WhatsApp Inbox</h2>
            <p className="text-muted-foreground text-sm mb-4">
              Selecione uma conversa ou configure a Evolution API para começar a receber mensagens.
            </p>
            <Button onClick={() => setCfgOpen(true)} variant="outline" size="sm" className="gap-2">
              <Settings className="w-4 h-4" /> Configurar Evolution
            </Button>
          </div>
        </div>
      )}

      {/* Config Dialog */}
      <Dialog open={cfgOpen} onOpenChange={setCfgOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" /> Evolution API
            </DialogTitle>
            <DialogDescription>
              Configure sua instância Evolution v2 para enviar e receber mensagens do WhatsApp diretamente neste inbox.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3">
              <div>
                <Label className="text-xs">URL base da Evolution API</Label>
                <Input
                  placeholder="https://evolution.seudominio.com"
                  value={conn.instance_url}
                  onChange={(e) => setConn(c => ({ ...c, instance_url: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">API Key global</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={conn.api_key}
                  onChange={(e) => setConn(c => ({ ...c, api_key: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Nome da instância</Label>
                <Input
                  placeholder="posion-master"
                  value={conn.instance_name}
                  onChange={(e) => setConn(c => ({ ...c, instance_name: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {statusBadge()}
                <Button variant="ghost" size="sm" onClick={handleCheckStatus} disabled={checkingStatus || !conn.instance_name} className="h-7 gap-1">
                  <RefreshCw className={`w-3 h-3 ${checkingStatus ? "animate-spin" : ""}`} /> Atualizar
                </Button>
              </div>
              <Button onClick={handleConnect} disabled={connecting} className="gap-2 bg-accent hover:bg-accent/90 text-accent-foreground">
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                Conectar / Gerar QR
              </Button>
            </div>

            {qr && (
              <div className="border border-border rounded-lg p-4 flex flex-col items-center bg-card">
                <p className="text-xs text-muted-foreground mb-3">Escaneie no WhatsApp em <strong>Dispositivos conectados</strong></p>
                <img src={qr} alt="QR Code Evolution" className="w-56 h-56 rounded-md bg-white p-2" />
              </div>
            )}

            <div className="border border-accent/30 bg-accent/5 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-accent" />
                <h4 className="text-sm font-semibold text-foreground">Webhook URL</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Cole esta URL na sua instância Evolution em <strong>Settings → Webhooks</strong>, e ative o evento <code className="text-accent">MESSAGES_UPSERT</code>.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background/60 border border-border rounded px-2 py-2 font-mono text-foreground/90 break-all">
                  {WEBHOOK_URL}
                </code>
                <Button size="icon" variant="outline" onClick={copyWebhook} className="h-9 w-9 shrink-0">
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WhatsAppChat;
