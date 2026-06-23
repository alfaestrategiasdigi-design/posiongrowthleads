import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Search, Send, Paperclip, Phone, MoreVertical, User, MessageCircle, Smile,
  Settings, QrCode, Copy, CheckCircle2, Loader2, Wifi, WifiOff, RefreshCw,
  Tag as TagIcon, Plus, X, Sparkles, Filter, FileText, Check, CheckCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Conversation, Message } from "@/types/admin";

const PROJECT_REF = "mbhbflbuawkmtmpjazcj";
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/whatsapp-webhook`;

type EvoConn = { id?: string; instance_url: string; api_key: string; instance_name: string; status: string };
type TagRow = { id: string; nome: string; cor: string; tenant_id: string | null };
type Welcome = {
  id?: string;
  enabled: boolean;
  message_template: string;
  delay_seconds: number;
  trigger_form: boolean;
  trigger_facebook: boolean;
  trigger_kanban_status: string | null;
};

const DEFAULT_WELCOME: Welcome = {
  enabled: false,
  message_template: "Olá {{nome}}, obrigado pelo interesse! Em breve um consultor entrará em contato. 🚀",
  delay_seconds: 30,
  trigger_form: true,
  trigger_facebook: true,
  trigger_kanban_status: null,
};
const TAG_COLORS = ["#c9a84c", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#ef4444", "#f59e0b", "#06b6d4"];

const WhatsAppChat = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convTags, setConvTags] = useState<Record<string, TagRow[]>>({});
  const [allTags, setAllTags] = useState<TagRow[]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Config
  const [cfgOpen, setCfgOpen] = useState(false);
  const [conn, setConn] = useState<EvoConn>({ instance_url: "", api_key: "", instance_name: "", status: "disconnected" });
  const [urlError, setUrlError] = useState<string | undefined>(undefined);
  const [qr, setQr] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [welcome, setWelcome] = useState<Welcome>(DEFAULT_WELCOME);
  const [savingWelcome, setSavingWelcome] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);

  // ============ Loads ============
  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations").select("*").order("ultima_interacao", { ascending: false });
    setConversations((data as Conversation[]) || []);
    setLoading(false);
  }, []);

  const loadTags = useCallback(async () => {
    const { data: tags } = await supabase.from("conversation_tags").select("*").order("nome");
    setAllTags((tags as TagRow[]) || []);
    const { data: assigns } = await supabase
      .from("conversation_tag_assignments")
      .select("conversation_id, conversation_tags(*)");
    const map: Record<string, TagRow[]> = {};
    (assigns || []).forEach((row: any) => {
      const t = row.conversation_tags;
      if (!t) return;
      (map[row.conversation_id] ||= []).push(t);
    });
    setConvTags(map);
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    const { data } = await supabase
      .from("messages").select("*").eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    setMessages((data as Message[]) || []);
  }, []);

  const loadConn = useCallback(async () => {
    const { data } = await supabase.from("zapi_connections")
      .select("id, instance_url, instance_name, api_key, status")
      .eq("provider", "evolution")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (data) setConn({
      id: data.id, instance_url: data.instance_url || "", api_key: data.api_key || "",
      instance_name: data.instance_name || "", status: data.status || "disconnected",
    });
  }, []);

  const loadWelcome = useCallback(async () => {
    const { data } = await supabase.from("whatsapp_welcome_config").select("*").maybeSingle();
    if (data) setWelcome({
      id: data.id, enabled: data.enabled, message_template: data.message_template,
      delay_seconds: data.delay_seconds, trigger_form: data.trigger_form,
      trigger_facebook: data.trigger_facebook, trigger_kanban_status: data.trigger_kanban_status,
    });
  }, []);

  useEffect(() => {
    loadConversations(); loadConn(); loadTags(); loadWelcome();
  }, [loadConversations, loadConn, loadTags, loadWelcome]);

  useEffect(() => {
    const channel = supabase.channel("wa-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        const row: any = payload.new ?? payload.old;
        if (row?.conversation_id && selectedConversation && row.conversation_id === selectedConversation.id) {
          loadMessages(selectedConversation.id);
        }
        loadConversations();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadConversations())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_tag_assignments" }, () => loadTags())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedConversation?.id, loadConversations, loadMessages, loadTags]);

  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation.id);
      supabase.from("conversations").update({ nao_lidas: 0 }).eq("id", selectedConversation.id).then(() => {});
    }
  }, [selectedConversation, loadMessages]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ============ Send ============
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || sending) return;
    const body = newMessage.trim();
    setSending(true); setNewMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("evolution-send", {
        body: { conversation_id: selectedConversation.id, body },
      });
      if (error || (data as any)?.error) {
        toast.error("Falha ao enviar", { description: (data as any)?.error || error?.message });
        setNewMessage(body);
      } else {
        loadMessages(selectedConversation.id); loadConversations();
      }
    } finally { setSending(false); }
  };

  const handleAttach = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedConversation) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `outgoing/${selectedConversation.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("whatsapp-media").upload(path, file, {
        contentType: file.type, upsert: false,
      });
      if (upErr) { toast.error("Upload falhou", { description: upErr.message }); return; }
      const { data: signed } = await supabase.storage.from("whatsapp-media").createSignedUrl(path, 60 * 60 * 24 * 7);
      const url = signed?.signedUrl;
      if (!url) { toast.error("URL não gerada"); return; }
      const mediaType = file.type.startsWith("image/") ? "image"
        : file.type.startsWith("video/") ? "video"
        : file.type.startsWith("audio/") ? "audio" : "document";
      const { data, error } = await supabase.functions.invoke("evolution-send", {
        body: { conversation_id: selectedConversation.id, media_url: url, media_type: mediaType, caption: newMessage.trim() || undefined },
      });
      if (error || (data as any)?.error) {
        toast.error("Falha ao enviar mídia", { description: (data as any)?.error || error?.message });
      } else {
        setNewMessage("");
        loadMessages(selectedConversation.id); loadConversations();
      }
    } finally { setUploading(false); }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  // ============ Connect ============
  const sanitizeBaseUrl = (raw: string): { url: string; error?: string } => {
    const trimmed = (raw || "").trim();
    if (!trimmed) return { url: "" };
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    let u: URL;
    try { u = new URL(withProto); } catch { return { url: trimmed, error: "URL inválida" }; }
    const path = u.pathname.replace(/\/+$/, "");
    if (/\/manager(\/|$)/i.test(path) || /\/manager\b/i.test(trimmed)) {
      return { url: `${u.protocol}//${u.host}`, error: "Use apenas a URL base (http://host:porta). URLs do Manager não são aceitas." };
    }
    if (path && path !== "") {
      return { url: `${u.protocol}//${u.host}`, error: "Use apenas a URL base sem caminho." };
    }
    return { url: `${u.protocol}//${u.host}` };
  };
  const handleUrlBlur = () => {
    const { url, error } = sanitizeBaseUrl(conn.instance_url);
    if (url !== conn.instance_url) setConn(c => ({ ...c, instance_url: url }));
    setUrlError(error);
    if (error) toast.warning(error);
  };
  const handleConnect = async () => {
    if (!conn.instance_url || !conn.api_key || !conn.instance_name) { toast.error("Preencha URL, API Key e nome da instância"); return; }
    const { url, error } = sanitizeBaseUrl(conn.instance_url);
    if (error) { setConn(c => ({ ...c, instance_url: url })); setUrlError(error); toast.error(error); return; }
    setUrlError(undefined); setConn(c => ({ ...c, instance_url: url }));
    setConnecting(true); setQr(null);
    try {
      const { data, error: e } = await supabase.functions.invoke("evolution-connect", {
        body: { instance_url: url, api_key: conn.api_key, instance_name: conn.instance_name },
      });
      if (e || (data as any)?.error) {
        toast.error("Falha ao conectar", { description: (data as any)?.error || e?.message });
      } else {
        const qrCode = (data as any)?.qr;
        if (qrCode) {
          setQr(qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode.replace(/^data:[^,]+,/, "")}`);
          toast.success("QR Code gerado — escaneie no WhatsApp");
        } else toast.success("Conectado", { description: "Instância já vinculada." });
        loadConn();
      }
    } finally { setConnecting(false); }
  };
  const handleCheckStatus = async () => {
    if (!conn.instance_name) return;
    setCheckingStatus(true);
    try {
      const { data, error } = await supabase.functions.invoke("evolution-status", { body: { instance_name: conn.instance_name } });
      if (error || (data as any)?.error) {
        toast.error("Falha ao consultar status", { description: (data as any)?.error || error?.message });
      } else {
        const status = (data as any)?.status || "disconnected";
        setConn(c => ({ ...c, status }));
        toast.success(`Status: ${status}`);
        if (status === "connected") setQr(null);
      }
    } finally { setCheckingStatus(false); }
  };
  const copyWebhook = () => { navigator.clipboard.writeText(WEBHOOK_URL); toast.success("Webhook copiado"); };

  // ============ Welcome ============
  const saveWelcome = async () => {
    setSavingWelcome(true);
    try {
      const payload = {
        enabled: welcome.enabled, message_template: welcome.message_template,
        delay_seconds: welcome.delay_seconds, trigger_form: welcome.trigger_form,
        trigger_facebook: welcome.trigger_facebook, trigger_kanban_status: welcome.trigger_kanban_status,
      };
      if (welcome.id) {
        const { error } = await supabase.from("whatsapp_welcome_config").update(payload).eq("id", welcome.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("whatsapp_welcome_config").insert(payload).select("id").maybeSingle();
        if (error) throw error;
        if (data) setWelcome(w => ({ ...w, id: data.id }));
      }
      toast.success("Boas-vindas salvas");
    } catch (e: any) {
      toast.error("Falha ao salvar", { description: e.message });
    } finally { setSavingWelcome(false); }
  };

  // ============ Tags ============
  const createTag = async () => {
    if (!newTagName.trim()) return;
    const { error } = await supabase.from("conversation_tags").insert({ nome: newTagName.trim(), cor: newTagColor });
    if (error) toast.error("Falha", { description: error.message });
    else { setNewTagName(""); loadTags(); toast.success("Tag criada"); }
  };
  const deleteTag = async (id: string) => {
    if (!confirm("Excluir tag?")) return;
    const { error } = await supabase.from("conversation_tags").delete().eq("id", id);
    if (error) toast.error("Falha", { description: error.message });
    else loadTags();
  };
  const toggleConvTag = async (tagId: string) => {
    if (!selectedConversation) return;
    const current = convTags[selectedConversation.id] || [];
    const has = current.some(t => t.id === tagId);
    if (has) {
      await supabase.from("conversation_tag_assignments").delete()
        .eq("conversation_id", selectedConversation.id).eq("tag_id", tagId);
    } else {
      await supabase.from("conversation_tag_assignments").insert({
        conversation_id: selectedConversation.id, tag_id: tagId,
      });
    }
    loadTags();
  };

  // ============ Render helpers ============
  const filteredConversations = conversations.filter(c => {
    if (searchQuery && !(c.nome_contato || c.telefone).toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (tagFilter && !(convTags[c.id] || []).some(t => t.id === tagFilter)) return false;
    return true;
  });

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

  const renderMessageBody = (msg: Message) => {
    const tipo = msg.media_type || msg.tipo;
    if (msg.media_url) {
      if (tipo === "image") return <img src={msg.media_url} alt="" className="rounded-lg max-w-full max-h-72 object-cover mb-1" />;
      if (tipo === "audio") return <audio controls src={msg.media_url} className="max-w-full" />;
      if (tipo === "video") return <video controls src={msg.media_url} className="rounded-lg max-w-full max-h-72" />;
      if (tipo === "document") return (
        <a href={msg.media_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline">
          <FileText className="w-4 h-4" /> {msg.conteudo || "documento"}
        </a>
      );
    }
    return <p className="text-sm whitespace-pre-wrap break-words">{msg.conteudo}</p>;
  };

  const renderStatus = (msg: Message) => {
    if (msg.sender !== "usuario") return null;
    const s = msg.status || "sent";
    if (s === "read") return <CheckCheck className="w-3 h-3 text-sky-400 inline" />;
    if (s === "delivered") return <CheckCheck className="w-3 h-3 inline" />;
    return <Check className="w-3 h-3 inline" />;
  };

  // ============ JSX ============
  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-[320px] border-r border-border flex flex-col bg-card/50 shrink-0">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
          {statusBadge()}
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Filtrar por tag">
                  <Filter className={`w-4 h-4 ${tagFilter ? "text-accent" : ""}`} />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="end">
                <button onClick={() => setTagFilter(null)} className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-xs">
                  Todas
                </button>
                {allTags.map(t => (
                  <button key={t.id} onClick={() => setTagFilter(t.id)}
                    className={`w-full text-left px-2 py-1.5 rounded hover:bg-muted text-xs flex items-center gap-2 ${tagFilter === t.id ? "bg-muted" : ""}`}>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.cor }} /> {t.nome}
                  </button>
                ))}
                {allTags.length === 0 && <p className="text-[11px] text-muted-foreground px-2 py-1">Nenhuma tag.</p>}
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCfgOpen(true)} title="Configurações">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Pesquisar conversas..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-muted/50 border-none text-sm" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <MessageCircle className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm">Nenhuma conversa</p>
            </div>
          ) : (
            filteredConversations.map(conv => {
              const tags = convTags[conv.id] || [];
              return (
                <div key={conv.id} onClick={() => setSelectedConversation(conv)}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors border-b border-border/30 ${selectedConversation?.id === conv.id ? "bg-muted/50" : ""}`}>
                  <div className="w-11 h-11 rounded-full bg-accent/10 flex items-center justify-center shrink-0 overflow-hidden">
                    {conv.foto_url
                      ? <img src={conv.foto_url} alt="" className="w-full h-full object-cover" />
                      : <User className="w-5 h-5 text-accent" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium text-foreground truncate">{conv.nome_contato || conv.telefone}</h4>
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{formatTime(conv.ultima_interacao)}</span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <p className="text-xs text-muted-foreground truncate">{conv.ultima_mensagem || "Sem mensagens"}</p>
                      {conv.nao_lidas > 0 && (
                        <span className="w-5 h-5 rounded-full bg-accent text-accent-foreground text-[10px] flex items-center justify-center font-bold shrink-0 ml-2">
                          {conv.nao_lidas}
                        </span>
                      )}
                    </div>
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {tags.slice(0, 3).map(t => (
                          <span key={t.id} className="text-[9px] px-1.5 py-0.5 rounded text-white"
                            style={{ background: t.cor }}>{t.nome}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Chat */}
      {selectedConversation ? (
        <div className="flex-1 flex flex-col">
          <div className="h-16 border-b border-border flex items-center justify-between px-4 bg-card/50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center overflow-hidden">
                {selectedConversation.foto_url
                  ? <img src={selectedConversation.foto_url} alt="" className="w-full h-full object-cover" />
                  : <User className="w-5 h-5 text-accent" />}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{selectedConversation.nome_contato || selectedConversation.telefone}</h3>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">{selectedConversation.telefone}</p>
                  {(convTags[selectedConversation.id] || []).map(t => (
                    <span key={t.id} className="text-[9px] px-1.5 py-0.5 rounded text-white" style={{ background: t.cor }}>{t.nome}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9" title="Tags"><TagIcon className="w-4 h-4 text-muted-foreground" /></Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="end">
                  <p className="text-[11px] text-muted-foreground px-2 pb-1">Aplicar tags</p>
                  {allTags.length === 0 && <p className="text-[11px] text-muted-foreground px-2 py-1">Crie tags nas Configurações.</p>}
                  {allTags.map(t => {
                    const active = (convTags[selectedConversation.id] || []).some(x => x.id === t.id);
                    return (
                      <button key={t.id} onClick={() => toggleConvTag(t.id)}
                        className={`w-full text-left px-2 py-1.5 rounded hover:bg-muted text-xs flex items-center gap-2 ${active ? "bg-muted" : ""}`}>
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.cor }} />
                        <span className="flex-1">{t.nome}</span>
                        {active && <Check className="w-3 h-3 text-accent" />}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
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
              messages.map(msg => {
                const isOut = msg.sender === "usuario";
                return (
                  <div key={msg.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] rounded-2xl px-3 py-2 ${isOut ? "rounded-br-md text-[#1a1208]" : "rounded-bl-md text-foreground border border-border/50"}`}
                      style={isOut ? { background: "#c9a84c" } : { background: "#0d1426" }}>
                      {msg.tipo_disparo === "boas_vindas" && (
                        <div className="flex items-center gap-1 text-[10px] opacity-70 mb-1">
                          <Sparkles className="w-3 h-3" /> Boas-vindas automática
                        </div>
                      )}
                      {renderMessageBody(msg)}
                      <p className={`text-[10px] mt-1 text-right flex items-center justify-end gap-1 ${isOut ? "text-[#1a1208]/60" : "text-muted-foreground"}`}>
                        {formatMessageTime(msg.created_at)} {renderStatus(msg)}
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
              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={handleAttach} disabled={uploading}>
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5 text-muted-foreground" />}
              </Button>
              <input ref={fileInputRef} type="file" hidden onChange={handleFileSelected}
                accept="image/*,video/*,audio/*,application/pdf" />
              <Input placeholder="Digite uma mensagem..." value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)} onKeyDown={handleKeyPress}
                disabled={sending} className="flex-1 bg-muted/50 border-none h-10" />
              <Button onClick={handleSendMessage} disabled={!newMessage.trim() || sending}
                size="icon" className="h-10 w-10 rounded-full bg-accent hover:bg-accent/90 shrink-0">
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
            <p className="text-muted-foreground text-sm mb-4">Selecione uma conversa ou configure a Evolution API.</p>
            <Button onClick={() => setCfgOpen(true)} variant="outline" size="sm" className="gap-2">
              <Settings className="w-4 h-4" /> Configurações
            </Button>
          </div>
        </div>
      )}

      {/* Config Dialog */}
      <Dialog open={cfgOpen} onOpenChange={setCfgOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Settings className="w-5 h-5" /> WhatsApp — Configurações</DialogTitle>
            <DialogDescription>Conexão, mensagem de boas-vindas e tags.</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="conn" className="mt-2">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="conn">Conexão</TabsTrigger>
              <TabsTrigger value="welcome">Boas-vindas</TabsTrigger>
              <TabsTrigger value="tags">Tags</TabsTrigger>
            </TabsList>

            {/* Conexão */}
            <TabsContent value="conn" className="space-y-4 mt-4">
              <div className="grid gap-3">
                <div>
                  <Label className="text-xs">URL base da Evolution API</Label>
                  <Input placeholder="http://129.121.36.166:8080" value={conn.instance_url}
                    onChange={(e) => { setConn(c => ({ ...c, instance_url: e.target.value })); if (urlError) setUrlError(undefined); }}
                    onBlur={handleUrlBlur} className={urlError ? "border-destructive" : ""} />
                  <p className={`text-[11px] mt-1 ${urlError ? "text-destructive" : "text-muted-foreground"}`}>
                    {urlError || "Apenas a URL base (http://host:porta). Não cole URLs do /manager."}
                  </p>
                </div>
                <div>
                  <Label className="text-xs">API Key global</Label>
                  <Input type="password" placeholder="••••••••" value={conn.api_key}
                    onChange={(e) => setConn(c => ({ ...c, api_key: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Nome da instância</Label>
                  <Input placeholder="posion-master" value={conn.instance_name}
                    onChange={(e) => setConn(c => ({ ...c, instance_name: e.target.value }))} />
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
                  <p className="text-xs text-muted-foreground mb-3">Escaneie em <strong>Dispositivos conectados</strong></p>
                  <img src={qr} alt="QR Code" className="w-56 h-56 rounded-md bg-white p-2" />
                </div>
              )}
              <div className="border border-accent/30 bg-accent/5 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-accent" />
                  <h4 className="text-sm font-semibold text-foreground">Webhook URL</h4>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  Cole na Evolution em <strong>Settings → Webhooks</strong>, ative <code className="text-accent">MESSAGES_UPSERT</code>, <code className="text-accent">MESSAGES_UPDATE</code>, <code className="text-accent">CONTACTS_UPDATE</code>, <code className="text-accent">CONNECTION_UPDATE</code>.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-background/60 border border-border rounded px-2 py-2 font-mono break-all">{WEBHOOK_URL}</code>
                  <Button size="icon" variant="outline" onClick={copyWebhook} className="h-9 w-9 shrink-0"><Copy className="w-4 h-4" /></Button>
                </div>
              </div>
            </TabsContent>

            {/* Welcome */}
            <TabsContent value="welcome" className="space-y-4 mt-4">
              <div className="flex items-center justify-between border border-border rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium">Disparar mensagem ao novo lead</p>
                  <p className="text-[11px] text-muted-foreground">Quando alguém preenche o form ou vem do Facebook Ads.</p>
                </div>
                <Switch checked={welcome.enabled} onCheckedChange={(v) => setWelcome(w => ({ ...w, enabled: v }))} />
              </div>

              <div>
                <Label className="text-xs">Mensagem (use {`{{nome}}`}, {`{{empresa}}`}, {`{{especialidade}}`})</Label>
                <Textarea rows={5} value={welcome.message_template}
                  onChange={(e) => setWelcome(w => ({ ...w, message_template: e.target.value }))} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Atraso (segundos)</Label>
                  <Input type="number" min={0} max={60} value={welcome.delay_seconds}
                    onChange={(e) => setWelcome(w => ({ ...w, delay_seconds: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Disparar quando</Label>
                  <div className="flex items-center gap-2 text-xs">
                    <Switch checked={welcome.trigger_form} onCheckedChange={(v) => setWelcome(w => ({ ...w, trigger_form: v }))} />
                    Form do site
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Switch checked={welcome.trigger_facebook} onCheckedChange={(v) => setWelcome(w => ({ ...w, trigger_facebook: v }))} />
                    Facebook Ads
                  </div>
                </div>
              </div>

              <Button onClick={saveWelcome} disabled={savingWelcome} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                {savingWelcome ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Salvar boas-vindas
              </Button>
            </TabsContent>

            {/* Tags */}
            <TabsContent value="tags" className="space-y-4 mt-4">
              <div className="border border-border rounded-lg p-3 space-y-2">
                <Label className="text-xs">Nova tag</Label>
                <div className="flex gap-2 items-center">
                  <Input placeholder="ex: VIP, Aguardando, Quente..." value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)} className="flex-1" />
                  <div className="flex gap-1">
                    {TAG_COLORS.map(c => (
                      <button key={c} onClick={() => setNewTagColor(c)}
                        className={`w-6 h-6 rounded-full border-2 ${newTagColor === c ? "border-foreground" : "border-transparent"}`}
                        style={{ background: c }} />
                    ))}
                  </div>
                  <Button size="icon" onClick={createTag} className="h-9 w-9"><Plus className="w-4 h-4" /></Button>
                </div>
              </div>
              <div className="space-y-1">
                {allTags.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhuma tag criada.</p>}
                {allTags.map(t => (
                  <div key={t.id} className="flex items-center justify-between border border-border rounded p-2">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ background: t.cor }} />
                      <span className="text-sm">{t.nome}</span>
                    </div>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteTag(t.id)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WhatsAppChat;
