import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Search, Send, Paperclip, Phone, MoreVertical, MessageCircle, Smile,
  Settings, QrCode, Copy, CheckCircle2, Loader2, Wifi, WifiOff, RefreshCw,
  Tag as TagIcon, Sparkles, Filter, FileText, Check, CheckCheck, AlertTriangle,
  Plus, X, Trash2, Reply, MapPin, User as UserIcon, Mic, StopCircle, CornerDownRight, Target, ExternalLink,
} from "lucide-react";
import type { MessageReaction } from "@/types/admin";
import UnifiedLeadPanel from "@/components/leads/UnifiedLeadPanel";
import { WhatsAppAudioPlayer } from "@/components/admin/whatsapp/WhatsAppAudioPlayer";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { format, isToday, isThisWeek, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Conversation, Message } from "@/types/admin";
import ContactAvatar from "@/components/admin/whatsapp/ContactAvatar";
import { LidReviewDialog } from "@/components/admin/whatsapp/LidReviewDialog";
import { ReassignMessageDialog } from "@/components/admin/whatsapp/ReassignMessageDialog";
import { Move } from "lucide-react";


const PROJECT_REF = "mbhbflbuawkmtmpjazcj";
const BASE_WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/whatsapp-webhook`;

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
const TAG_COLORS = ["#c9a227", "#e4c876", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#ef4444", "#f59e0b"];
const LOCAL_WAMIDS_KEY = "wa-local-sent-wamids-v1";
const loadLocalWamids = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(LOCAL_WAMIDS_KEY) || "[]")); } catch { return new Set(); }
};
const persistLocalWamids = (s: Set<string>) => {
  try {
    const arr = Array.from(s);
    // Keep last 2000 to prevent unbounded growth
    localStorage.setItem(LOCAL_WAMIDS_KEY, JSON.stringify(arr.slice(-2000)));
  } catch { /* ignore */ }
};
const SESSION_START_KEY = "wa-session-started-at-v1";
const getSessionStart = (): number => {
  try {
    const v = localStorage.getItem(SESSION_START_KEY);
    if (v) return parseInt(v);
    const now = Date.now();
    localStorage.setItem(SESSION_START_KEY, String(now));
    return now;
  } catch { return Date.now(); }
};

type WhatsAppChatProps = {
  tenantId?: string | null;
  tenantSlug?: string | null;
  tenantName?: string | null;
  masterMode?: boolean;
};

const WhatsAppChat = ({ tenantId = null, tenantSlug = null, tenantName = null, masterMode = false }: WhatsAppChatProps) => {
  const webhookUrl = tenantSlug ? `${BASE_WEBHOOK_URL}?tenant=${encodeURIComponent(tenantSlug)}` : BASE_WEBHOOK_URL;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [leadNamesById, setLeadNamesById] = useState<Record<string, string>>({});
  const [tenantsMap, setTenantsMap] = useState<Record<string, { nome: string; slug: string }>>({});
  const [confirmDelete, setConfirmDelete] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [convTags, setConvTags] = useState<Record<string, TagRow[]>>({});
  const [allTags, setAllTags] = useState<TagRow[]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const onlyWithLeadKey = `wa-only-with-lead-${tenantId ?? "master"}`;
  const [onlyWithLead, setOnlyWithLead] = useState<boolean>(() => {
    try { return localStorage.getItem(onlyWithLeadKey) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(onlyWithLeadKey, onlyWithLead ? "1" : "0"); } catch { /* ignore */ }
  }, [onlyWithLead, onlyWithLeadKey]);
  const [lidReviewOpen, setLidReviewOpen] = useState(false);
  const [lidPendingCount, setLidPendingCount] = useState(0);
  const [leadPanelId, setLeadPanelId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [reassignMessage, setReassignMessage] = useState<Message | null>(null);


  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reply / reactions / audio recorder
  const [reactions, setReactions] = useState<Record<string, MessageReaction[]>>({});
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const [recordStart, setRecordStart] = useState<number | null>(null);
  const [recordTick, setRecordTick] = useState(0);

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
  const localWamidsRef = useRef<Set<string>>(loadLocalWamids());
  const sessionStartRef = useRef<number>(getSessionStart());
  const pendingLocalSendRef = useRef<number | null>(null);

  // ============ Loads ============
  const loadConversations = useCallback(async () => {
    // Strict isolation: master mode = somente conversas sem tenant (instância master);
    // tenant mode = somente conversas do próprio tenant.
    let query = supabase.from("conversations").select("*");
    query = masterMode
      ? query.is("tenant_id", null)
      : (tenantId ? query.eq("tenant_id", tenantId) : query.is("tenant_id", null));
    const { data, error } = await query.order("ultima_interacao", { ascending: false });
    if (error) toast.error("Falha ao carregar conversas", { description: error.message });
    const list = (data as Conversation[]) || [];
    setConversations(list);
    setLidPendingCount(list.filter((c: any) => (c as any).needs_lid_review === true).length);
    setLoading(false);
    // Carrega nomes dos leads vinculados às conversas (usado como fallback de exibição
    // quando a conversa está com @lid não resolvido ou sem pushName).
    const leadIds = Array.from(new Set(list.map(c => c.lead_id).filter((x): x is string => !!x)));
    if (leadIds.length > 0) {
      const { data: leadsData } = await supabase
        .from("leads")
        .select("id, nome_completo")
        .in("id", leadIds);
      const map: Record<string, string> = {};
      (leadsData || []).forEach((l: any) => {
        if (l?.id && l?.nome_completo) map[l.id] = l.nome_completo;
      });
      setLeadNamesById(map);
    } else {
      setLeadNamesById({});
    }
  }, [tenantId, masterMode]);

  const loadTenantsMap = useCallback(async () => {
    if (!masterMode) return;
    const { data } = await supabase.from("tenants").select("id, nome, slug");
    const map: Record<string, { nome: string; slug: string }> = {};
    (data || []).forEach((t: any) => { map[t.id] = { nome: t.nome, slug: t.slug }; });
    setTenantsMap(map);
  }, [masterMode]);

  const loadTags = useCallback(async () => {
    let tagsQuery = supabase.from("conversation_tags").select("*");
    if (!masterMode) {
      tagsQuery = tenantId ? tagsQuery.eq("tenant_id", tenantId) : tagsQuery.is("tenant_id", null);
    }
    const { data: tags, error: tagsErr } = await tagsQuery.order("nome");
    if (tagsErr) toast.error("Falha ao carregar tags", { description: tagsErr.message });
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
  }, [tenantId, masterMode]);

  const syncedConversationsRef = useRef<Set<string>>(new Set());
  const loadMessages = useCallback(async (conversationId: string) => {
    const { data } = await supabase
      .from("messages").select("*").eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    let msgs = (data as Message[]) || [];
    // If we just sent locally, claim outbound wamids that appeared at/after that timestamp
    const claimTs = pendingLocalSendRef.current;
    if (claimTs) {
      let changed = false;
      for (const m of msgs) {
        if (m.sender === "usuario" && m.wamid && new Date(m.created_at).getTime() >= claimTs - 5000) {
          if (!localWamidsRef.current.has(m.wamid)) { localWamidsRef.current.add(m.wamid); changed = true; }
        }
      }
      if (changed) persistLocalWamids(localWamidsRef.current);
      pendingLocalSendRef.current = null;
    }
    setMessages(msgs);
    // Auto-pull history from Evolution when the conversation has no messages yet
    // (e.g. messages sent directly from the phone before the webhook was active).
    if (msgs.length === 0 && !syncedConversationsRef.current.has(conversationId)) {
      syncedConversationsRef.current.add(conversationId);
      try {
        const { data: res } = await supabase.functions.invoke("evolution-sync-messages", {
          body: { conversation_id: conversationId, limit: 200 },
        });
        if ((res as any)?.replayed > 0) {
          const { data: after } = await supabase
            .from("messages").select("*").eq("conversation_id", conversationId)
            .order("created_at", { ascending: true });
          msgs = (after as Message[]) || [];
          setMessages(msgs);
        }
      } catch (e) {
        console.warn("[sync-messages] failed", e);
      }
    }
    // Load reactions for this conversation
    const { data: reactRows } = await supabase
      .from("message_reactions").select("*").eq("conversation_id", conversationId);
    const map: Record<string, MessageReaction[]> = {};
    (reactRows || []).forEach((r: any) => {
      (map[r.message_wamid] ||= []).push(r as MessageReaction);
    });
    setReactions(map);
  }, []);

  // ============ Reactions & Reply helpers ============
  const sendReaction = useCallback(async (msg: Message, emoji: string) => {
    if (!msg.wamid || !selectedConversation) return;
    // Toggle: if already reacted with same emoji, remove
    const existing = (reactions[msg.wamid] || []).find(r => r.from_me);
    const targetEmoji = existing?.emoji === emoji ? "" : emoji;
    const { error } = await supabase.functions.invoke("evolution-send", {
      body: {
        conversation_id: selectedConversation.id,
        reaction_wamid: msg.wamid,
        reaction_emoji: targetEmoji,
      },
    });
    if (error) toast.error("Falha ao reagir", { description: error.message });
    else loadMessages(selectedConversation.id);
  }, [reactions, selectedConversation, loadMessages]);

  // ============ Audio recorder ============
  const startRecording = useCallback(async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recordChunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && recordChunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recordChunksRef.current, { type: "audio/webm" });
        await uploadAndSendAudio(blob);
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecordStart(Date.now());
    } catch (e: any) {
      toast.error("Microfone bloqueado", { description: e?.message || "Permita o acesso ao microfone" });
    }
  }, [recording]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
    setRecordStart(null);
  }, []);

  const uploadAndSendAudio = useCallback(async (blob: Blob) => {
    if (!selectedConversation) return;
    setUploading(true);
    try {
      const path = `${tenantId || "master"}/outgoing/${selectedConversation.id}/${Date.now()}_voice.webm`;
      const { error: upErr } = await supabase.storage.from("whatsapp-media").upload(path, blob, {
        contentType: "audio/webm", upsert: false,
      });
      if (upErr) { toast.error("Falha ao subir áudio", { description: upErr.message }); return; }
      const { data: signed } = await supabase.storage.from("whatsapp-media").createSignedUrl(path, 60 * 60 * 24 * 7);
      const url = signed?.signedUrl;
      if (!url) { toast.error("URL não gerada"); return; }
      pendingLocalSendRef.current = Date.now();
      const { data, error } = await supabase.functions.invoke("evolution-send", {
        body: {
          conversation_id: selectedConversation.id,
          media_url: url,
          media_type: "audio",
          reply_to_wamid: replyTo?.wamid ?? null,
          reply_preview: replyTo?.conteudo?.slice(0, 80) ?? null,
        },
      });
      if (error || (data as any)?.error) {
        toast.error("Falha ao enviar áudio", { description: (data as any)?.error || error?.message });
      } else {
        setReplyTo(null);
        loadMessages(selectedConversation.id);
      }
    } finally { setUploading(false); }
  }, [selectedConversation, tenantId, replyTo, loadMessages]);

  // Tick recording timer
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecordTick(x => x + 1), 500);
    return () => clearInterval(t);
  }, [recording]);


  const loadConn = useCallback(async () => {
    let query = supabase.from("zapi_connections")
      .select("id, instance_url, instance_name, api_key, status")
      .eq("provider", "evolution");
    if (masterMode) {
      // master view: show first available connection (read-only context for inbox)
    } else {
      query = tenantId ? query.eq("tenant_id", tenantId) : query.is("tenant_id", null);
    }
    const { data, error } = await query.order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) toast.error("Falha ao carregar conexão", { description: error.message });
    if (data) setConn({
      id: data.id, instance_url: data.instance_url || "", api_key: data.api_key || "",
      instance_name: data.instance_name || "", status: data.status || "disconnected",
    });
    else setConn({ instance_url: "", api_key: "", instance_name: "", status: "disconnected" });
  }, [tenantId, masterMode]);

  const loadWelcome = useCallback(async () => {
    if (masterMode) { setWelcome(DEFAULT_WELCOME); return; }
    let query = supabase.from("whatsapp_welcome_config").select("*");
    query = tenantId ? query.eq("tenant_id", tenantId) : query.is("tenant_id", null);
    const { data, error } = await query.maybeSingle();
    if (error) toast.error("Falha ao carregar automação", { description: error.message });
    if (data) setWelcome({
      id: data.id, enabled: data.enabled, message_template: data.message_template,
      delay_seconds: data.delay_seconds, trigger_form: data.trigger_form,
      trigger_facebook: data.trigger_facebook, trigger_kanban_status: data.trigger_kanban_status,
    });
    else setWelcome(DEFAULT_WELCOME);
  }, [tenantId, masterMode]);

  useEffect(() => {
    loadConversations(); loadConn(); loadTags(); loadWelcome(); loadTenantsMap();
  }, [loadConversations, loadConn, loadTags, loadWelcome, loadTenantsMap]);

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
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (payload) => {
        const row: any = payload.new ?? payload.old;
        if (row?.conversation_id && selectedConversation && row.conversation_id === selectedConversation.id) {
          loadMessages(selectedConversation.id);
        }
      })
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

  // 15s polling fallback (refresh list + selected thread)
  useEffect(() => {
    const t = setInterval(() => {
      loadConversations();
      if (selectedConversation) loadMessages(selectedConversation.id);
    }, 15000);
    return () => clearInterval(t);
  }, [selectedConversation, loadConversations, loadMessages]);

  const [syncing, setSyncing] = useState(false);
  const handleSyncChats = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("evolution-sync-chats", {
        body: { tenant_id: tenantId, with_pictures: true },
      });
      if (error || (data as any)?.error) {
        toast.error("Falha ao sincronizar", { description: (data as any)?.error || error?.message });
      } else {
        toast.success(`Sincronizado: ${(data as any)?.upserted ?? 0} conversa(s)`);
        loadConversations();
      }
    } finally { setSyncing(false); }
  };

  const [resubscribing, setResubscribing] = useState(false);
  const handleResubscribe = async () => {
    if (resubscribing) return;
    setResubscribing(true);
    try {
      const body: any = {};
      if (tenantId) body.tenant_id = tenantId;
      const { data, error } = await supabase.functions.invoke("evolution-resubscribe", { body });
      if (error) {
        toast.error("Falha ao reassinar webhook", { description: error.message });
        return;
      }
      const results = (data as any)?.results ?? [];
      const ok = results.some((r: any) => r.ok);
      if (!ok) {
        toast.error("Evolution rejeitou a reassinatura", { description: JSON.stringify(results?.[0]?.debug ?? results).slice(0, 200) });
        return;
      }
      toast.success("Webhook reassinado — puxando mensagens perdidas…");
      // Backfill after resubscribing so missed messages appear.
      try {
        const { data: syncData } = await supabase.functions.invoke("evolution-sync-chats", {
          body: { tenant_id: tenantId, with_pictures: true },
        });
        toast.success(`Sincronizado: ${(syncData as any)?.upserted ?? 0} conversa(s)`);
      } catch (e: any) {
        toast.error("Reassinado, mas falhou o sync", { description: e?.message ?? String(e) });
      }
      loadConversations();
    } finally {
      setResubscribing(false);
    }
  };

  // Detect stale ingest: if connection is "connected" but no inbound message
  // arrived in the last 6h, the Evolution instance is probably calling the
  // webhook with a stale/invalid secret (401) and needs a resubscribe.
  const hoursSinceLastInbound = useMemo(() => {
    let latest = 0;
    for (const c of conversations) {
      const t = c.ultima_interacao ? new Date(c.ultima_interacao).getTime() : 0;
      if (t > latest) latest = t;
    }
    if (!latest) return null;
    return (Date.now() - latest) / 3600000;
  }, [conversations]);
  const showStaleBanner = conn.status === "connected"
    && conversations.length > 0
    && (hoursSinceLastInbound ?? 0) >= 6;



  // ============ Send ============
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || sending) return;
    const body = newMessage.trim();
    const currentReply = replyTo;
    const tempId = `tmp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      conversation_id: selectedConversation.id,
      sender: "usuario",
      conteudo: body,
      tipo: "text",
      media_type: null,
      media_url: null,
      media_mime: null,
      direction: "outbound",
      status: "sending",
      wamid: null,
      lida: true,
      tipo_disparo: null,
      tenant_id: tenantId ?? null,
      created_at: new Date().toISOString(),
      reply_to_wamid: currentReply?.wamid ?? null,
      reply_preview: currentReply?.conteudo?.slice(0, 80) ?? null,
    } as Message;
    setMessages(prev => [...prev, optimistic]);
    setNewMessage(""); setReplyTo(null); setSending(true);
    try {
      pendingLocalSendRef.current = Date.now();
      const { data, error } = await supabase.functions.invoke("evolution-send", {
        body: {
          conversation_id: selectedConversation.id,
          body,
          reply_to_wamid: currentReply?.wamid ?? null,
          reply_preview: currentReply?.conteudo?.slice(0, 80) ?? null,
        },
      });
      if (error || (data as any)?.error) {
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "failed" } : m));
        toast.error("Falha ao enviar", { description: (data as any)?.error || error?.message });
        setNewMessage(body);
      } else {
        loadMessages(selectedConversation.id);
        loadConversations();
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
      const path = `${tenantId || "master"}/outgoing/${selectedConversation.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
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
      pendingLocalSendRef.current = Date.now();
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
        body: { instance_url: url, api_key: conn.api_key, instance_name: conn.instance_name, tenant_id: tenantId },
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
      const { data, error } = await supabase.functions.invoke("evolution-status", { body: { connection_id: conn.id, instance_name: conn.instance_name, tenant_id: tenantId } });
      const status = (data as any)?.status || "disconnected";
      setConn(c => ({ ...c, status }));
      if (status === "connected") {
        setQr(null);
        toast.success("Conexão ativa");
      } else {
        toast.warning("Evolution indisponível", { description: (data as any)?.error || error?.message || `Status: ${status}` });
      }
    } catch (e: any) {
      setConn(c => ({ ...c, status: "disconnected" }));
      toast.warning("Evolution indisponível", { description: e?.message || "Falha ao consultar status" });
    } finally { setCheckingStatus(false); }
  };
  const copyWebhook = () => { navigator.clipboard.writeText(webhookUrl); toast.success("Webhook copiado"); };

  // ============ Welcome ============
  const saveWelcome = async () => {
    setSavingWelcome(true);
    try {
      const payload = {
        tenant_id: tenantId,
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

  // ============ Delete conversation ============
  const handleDeleteConversation = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("conversations").delete().eq("id", confirmDelete.id);
      if (error) { toast.error("Falha ao excluir", { description: error.message }); return; }
      toast.success("Conversa excluída");
      if (selectedConversation?.id === confirmDelete.id) setSelectedConversation(null);
      setConfirmDelete(null);
      loadConversations();
    } finally { setDeleting(false); }
  };

  // ============ Tags ============
  const createTag = async () => {
    if (!newTagName.trim()) return;
    const { error } = await supabase.from("conversation_tags").insert({ tenant_id: tenantId, nome: newTagName.trim(), cor: newTagColor });
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
  // Uma conversa @lid é um contato cujo número real ainda não foi resolvido pela Evolution.
  // Antes escondíamos essas conversas — agora elas aparecem normalmente na lista com um
  // selo "não identificado", e o LidReviewDialog continua disponível para revisão manual.
  const isUnresolvedLid = useCallback((c: Conversation): boolean => {
    const anyC = c as any;
    const jid: string = anyC.remote_jid || "";
    return anyC.needs_lid_review === true || jid.endsWith("@lid");
  }, []);

  const getDisplayName = useCallback((c: Conversation): string => {
    const anyC = c as any;
    const jid: string = anyC.remote_jid || "";
    const lidDigits = jid.endsWith("@lid") ? jid.replace(/@lid$/, "") : "";
    const rawName = (c.nome_contato || "").trim();
    // Nome válido = não vazio, não é o próprio lid, e não são só dígitos idênticos ao telefone.
    const isNameJustDigits = rawName.length > 0 && /^\d+$/.test(rawName);
    const nameLooksLikeLid = rawName === lidDigits || rawName === c.telefone;
    if (rawName && !isNameJustDigits && !nameLooksLikeLid) return rawName;
    if (c.lead_id && leadNamesById[c.lead_id]) return leadNamesById[c.lead_id];
    if (isUnresolvedLid(c)) {
      const digits = lidDigits || c.telefone || "";
      const tail = digits.slice(-4);
      return tail ? `Contato não identificado ·${tail}` : "Contato não identificado";
    }
    return rawName || c.telefone || "Sem número";
  }, [leadNamesById, isUnresolvedLid]);

  const filteredConversations = useMemo(() => conversations.filter(c => {
    if (q) {
      const hay = `${getDisplayName(c)} ${c.nome_contato || ""} ${c.telefone} ${c.ultima_mensagem || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (tagFilter && !(convTags[c.id] || []).some(t => t.id === tagFilter)) return false;
    if (onlyWithLead && !c.lead_id) return false;
    return true;
  }), [conversations, q, tagFilter, convTags, onlyWithLead, getDisplayName]);

  const linkedCount = useMemo(() => conversations.filter(c => c.lead_id).length, [conversations]);


  const formatListTime = (dateStr: string | null) => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      if (isToday(d)) return format(d, "HH:mm");
      const days = differenceInCalendarDays(new Date(), d);
      if (days === 1) return "Ontem";
      if (isThisWeek(d, { weekStartsOn: 1 })) return format(d, "EEE", { locale: ptBR }).replace(".", "");
      return format(d, "dd/MM");
    } catch { return ""; }
  };
  const formatMessageTime = (dateStr: string) => {
    try { return format(new Date(dateStr), "HH:mm"); } catch { return ""; }
  };

  const typedPreview = (text: string | null) => {
    if (!text) return "Sem mensagens";
    const t = text.toLowerCase();
    if (t.startsWith("🎤") || t.includes("[audio") || t === "audio") return "🎤 Áudio";
    if (t.startsWith("📷") || t.includes("[image") || t === "image") return "📷 Imagem";
    if (t.startsWith("🎬") || t.includes("[video") || t === "video") return "🎬 Vídeo";
    if (t.startsWith("📎") || t.startsWith("📄") || t.includes("[document") || t === "document") return "📎 Documento";
    if (t.includes("[sticker") || t === "sticker") return "😊 Figurinha";
    return text.length > 40 ? text.slice(0, 40) + "…" : text;
  };

  const highlight = (text: string) => {
    if (!q || !text) return text;
    const idx = text.toLowerCase().indexOf(q);
    if (idx < 0) return text;
    return <>{text.slice(0, idx)}<mark className="bg-accent/30 text-foreground rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
  };

  const statusBadge = () => {
    if (conn.status === "connected") return <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 gap-1"><Wifi className="w-3 h-3" />Conectado</Badge>;
    if (conn.status === "connecting") return <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 gap-1"><Loader2 className="w-3 h-3 animate-spin" />Pareando</Badge>;
    return <Badge variant="outline" className="border-rose-500/30 text-rose-300 gap-1"><WifiOff className="w-3 h-3" />Desconectado</Badge>;
  };

  const renderMessageBody = (msg: Message) => {
    if (msg.deleted_at) {
      return <p className="text-sm italic opacity-60">🚫 Mensagem apagada</p>;
    }
    const tipo = msg.media_type || msg.tipo;
    if (msg.location?.lat && msg.location?.lng) {
      const { lat, lng, name, address } = msg.location;
      return (
        <a href={`https://maps.google.com/?q=${lat},${lng}`} target="_blank" rel="noreferrer"
           className="flex items-start gap-2 underline decoration-dotted">
          <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="text-sm">
            <span className="block font-medium">{name || "Localização"}</span>
            {address && <span className="block text-xs opacity-80">{address}</span>}
            <span className="block text-[10px] opacity-60">{lat?.toFixed(5)}, {lng?.toFixed(5)}</span>
          </span>
        </a>
      );
    }
    if (msg.contact_card?.name || msg.contact_card?.vcard) {
      const phone = /TEL[^:]*:([^\r\n]+)/i.exec(msg.contact_card?.vcard || "")?.[1]?.trim();
      return (
        <div className="flex items-start gap-2 bg-black/10 rounded-lg px-2 py-1.5">
          <UserIcon className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-medium">{msg.contact_card.name || "Contato"}</div>
            {phone && <div className="text-xs opacity-80">{phone}</div>}
          </div>
        </div>
      );
    }
    if (msg.media_url) {
      if (tipo === "image") return <img src={msg.media_url} alt="" className="rounded-lg max-w-full max-h-72 object-cover mb-1" />;
      if (tipo === "sticker") return <img src={msg.media_url} alt="" className="max-w-[120px] max-h-[120px] mb-1" />;
      if (tipo === "audio") return <WhatsAppAudioPlayer src={msg.media_url} />;
      if (tipo === "video") return <video controls src={msg.media_url} className="rounded-lg max-w-full max-h-72" />;
      if (tipo === "document") return (
        <a href={msg.media_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline">
          <FileText className="w-4 h-4" /> {msg.conteudo || "documento"}
        </a>
      );
    }
    return (
      <p className="text-sm whitespace-pre-wrap break-words">
        {msg.conteudo}
        {msg.edited_at && <span className="ml-1 text-[10px] opacity-60">(editada)</span>}
      </p>
    );
  };

  const renderQuoted = (msg: Message) => {
    if (!msg.reply_preview && !msg.reply_to_wamid) return null;
    return (
      <div className="mb-1 pl-2 border-l-2 border-current/40 opacity-80 text-[11px] rounded bg-black/10 px-2 py-1 flex items-start gap-1">
        <CornerDownRight className="w-3 h-3 mt-0.5 shrink-0" />
        <span className="line-clamp-2">{msg.reply_preview || "Mensagem citada"}</span>
      </div>
    );
  };

  const renderReactions = (msg: Message) => {
    if (!msg.wamid) return null;
    const list = reactions[msg.wamid] || [];
    if (list.length === 0) return null;
    const groups = list.reduce<Record<string, number>>((acc, r) => {
      acc[r.emoji] = (acc[r.emoji] || 0) + 1;
      return acc;
    }, {});
    return (
      <div className="flex flex-wrap gap-1 mt-1 -mb-1">
        {Object.entries(groups).map(([emoji, n]) => (
          <span key={emoji} className="text-[11px] px-1.5 py-0.5 rounded-full bg-black/30 border border-white/10">
            {emoji}{n > 1 && <span className="ml-0.5 opacity-80">{n}</span>}
          </span>
        ))}
      </div>
    );
  };

  const isFromOtherDevice = (msg: Message): boolean => {
    if (msg.sender !== "usuario") return false;
    if (!msg.wamid) return false;                        // optimistic local send
    if (msg.tipo_disparo) return false;                  // system auto (welcome etc)
    const ts = msg.created_at ? new Date(msg.created_at).getTime() : 0;
    if (ts < sessionStartRef.current) return false;      // pre-session unknown, don't accuse
    if (localWamidsRef.current.has(msg.wamid)) return false;
    return true;
  };

  const renderStatus = (msg: Message) => {
    if (msg.sender !== "usuario") return null;
    const s = msg.status || "sent";
    if (s === "sending") return <Loader2 className="w-3 h-3 inline animate-spin opacity-70" />;
    if (s === "failed") return <AlertTriangle className="w-3 h-3 inline text-rose-400" />;
    if (s === "read") return <CheckCheck className="w-3 h-3 text-sky-400 inline" />;
    if (s === "delivered") return <CheckCheck className="w-3 h-3 inline" />;
    return <Check className="w-3 h-3 inline" />;
  };

  // ============ JSX ============
  return (
    <div className="wa-shell flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-[340px] wa-panel flex flex-col shrink-0">
        <div className="wa-header-bar px-3 py-2 flex items-center justify-between gap-2">
          {statusBadge()}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Sincronizar conversas" onClick={handleSyncChats} disabled={syncing}>
              <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Reassinar webhook (recuperar recebimento)" onClick={handleResubscribe} disabled={resubscribing}>
              <Wifi className={`w-4 h-4 ${resubscribing ? "animate-pulse" : ""}`} />
            </Button>
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
        <div className="wa-panel-2 p-3 space-y-2">
          {showStaleBanner && (
            <button
              onClick={handleResubscribe}
              disabled={resubscribing}
              className="w-full text-[11px] flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 transition"
              style={{ borderColor: "rgba(250,204,21,0.45)", background: "rgba(250,204,21,0.10)", color: "#facc15" }}
              title="A conexão está conectada, mas o webhook não recebe mensagens novas há horas. Clique para reassinar."
            >
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" />
                Sem mensagens há {Math.floor(hoursSinceLastInbound ?? 0)}h — reassinar webhook
              </span>
              {resubscribing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "hsl(var(--wa-gold-soft))" }} />
            <Input placeholder="Pesquisar conversas..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="wa-input pl-9 h-9 text-sm placeholder:text-[#667781]" />
          </div>
          <button
            onClick={() => setOnlyWithLead(v => !v)}
            data-active={onlyWithLead ? "true" : undefined}
            className="wa-tag-chip w-full !justify-between !py-1.5 !text-[11px]"
            style={onlyWithLead ? { "--wa-tag-color": "hsl(44 55% 47%)" } as React.CSSProperties : undefined}
            title="Filtro local: oculta conversas de números que ainda não viraram lead. Não altera o que o sistema recebe."
          >
            <span className="flex items-center gap-1.5"><Target className="w-3 h-3" /> Filtrar: somente com lead vinculado</span>
            <span className="wa-mono">{linkedCount}/{conversations.length}</span>
          </button>
          {lidPendingCount > 0 && (
            <button
              onClick={() => setLidReviewOpen(true)}
              className="w-full text-[11px] flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 transition"
              style={{ borderColor: "rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.08)", color: "#F87171" }}
              title="Conversas com identificador provisório (@lid) aguardando confirmação"
            >
              <span className="flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" /> Revisar conversas @lid</span>
              <span className="wa-mono">{lidPendingCount}</span>
            </button>
          )}
        </div>



        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(var(--wa-gold-soft))" }} /></div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(201,162,39,0.06)", border: "1px solid var(--wa-hairline)" }}>
                <MessageCircle className="w-8 h-8" style={{ color: "hsl(var(--wa-gold-soft))" }} />
              </div>
              <p className="text-sm" style={{ color: "#8696a0" }}>Nenhuma conversa</p>
            </div>
          ) : (
            filteredConversations.map(conv => {
              const tags = convTags[conv.id] || [];
              const selected = selectedConversation?.id === conv.id;
              return (
                <div key={conv.id} onClick={() => setSelectedConversation(conv)}
                  data-selected={selected ? "true" : undefined}
                  className="wa-card group relative flex items-start gap-3 px-3 py-3 cursor-pointer">
                  <ContactAvatar name={conv.nome_contato || conv.telefone} photoUrl={conv.foto_url} size={44} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className="wa-name text-[15px] font-semibold truncate" style={{ color: "#e9edef" }}>
                        {highlight(conv.nome_contato || conv.telefone)}
                      </h4>
                      <span className="wa-mono text-[10px] shrink-0 ml-2" style={{ color: "#8696a0" }}>{formatListTime(conv.ultima_interacao)}</span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5 gap-2">
                      <p className="wa-body text-xs truncate flex-1" style={{ color: "#8696a0" }}>
                        {highlight(typedPreview(conv.ultima_mensagem))}
                      </p>
                      {conv.nao_lidas > 0 && (
                        <span className="wa-unread shrink-0">
                          {conv.nao_lidas > 99 ? "99+" : conv.nao_lidas}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2 items-center">
                      {conv.lead_id && (
                        <span className="wa-badge-lead">
                          <Target className="w-2.5 h-2.5" /> Lead
                        </span>
                      )}
                      {tags.slice(0, 3).map(t => (
                        <span key={t.id} className="wa-tag-chip" data-active="true"
                          style={{ "--wa-tag-color": t.cor } as React.CSSProperties}>{t.nome}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(conv); }}
                    title="Excluir conversa"
                    className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md"
                    style={{ background: "#2a3942", border: "1px solid var(--wa-hairline)", color: "#f15c6d" }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Chat */}
      {selectedConversation ? (
        <div className="flex-1 flex flex-col">
          <div className="wa-header-bar h-16 flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-3">
              <ContactAvatar name={selectedConversation.nome_contato || selectedConversation.telefone} photoUrl={selectedConversation.foto_url} size={40} />
              <div>
                <h3 className="wa-name text-[16px] font-semibold flex items-center gap-2" style={{ color: "#e9edef" }}>
                  {selectedConversation.nome_contato || selectedConversation.telefone}
                  {selectedConversation.lead_id && (
                    <button
                      onClick={() => setLeadPanelId(selectedConversation.lead_id!)}
                      className="wa-badge-lead"
                      title="Abrir painel do lead"
                    >
                      <Target className="w-3 h-3" /> Lead vinculado <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  <p className="wa-mono text-xs" style={{ color: "#8696a0" }}>{selectedConversation.telefone}</p>
                  {(convTags[selectedConversation.id] || []).map(t => (
                    <span key={t.id} className="wa-tag-chip" data-active="true"
                      style={{ "--wa-tag-color": t.cor } as React.CSSProperties}>{t.nome}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Popover>
                <PopoverTrigger asChild>
                  <button className="wa-icon-btn" title="Tags"><TagIcon className="w-4 h-4" /></button>
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
              <button className="wa-icon-btn" title="Excluir conversa"
                onClick={() => setConfirmDelete(selectedConversation)}>
                <Trash2 className="w-4 h-4" style={{ color: "#f15c6d" }} />
              </button>
              <button className="wa-icon-btn" title="Ligar"><Phone className="w-4 h-4" /></button>
              <button className="wa-icon-btn" title="Mais opções"><MoreVertical className="w-4 h-4" /></button>
            </div>
          </div>

          {(selectedConversation as any)?.needs_lid_review && (
            <div className="px-4 py-2 border-b border-amber-500/40 bg-amber-500/10 text-amber-200 text-[11px] flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold">Possível mistura de mensagens de outro contato</div>
                <div className="text-amber-200/80">
                  {(selectedConversation as any)?.lid_review_notes || "Revise as mensagens deste intervalo manualmente antes de responder. Use o botão \u201cMover\u201d na mensagem para reatribuí-la à conversa correta."}
                </div>
              </div>
            </div>
          )}

          <div className="wa-chat-bg flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(201,162,39,0.05)", border: "1px solid var(--wa-hairline)" }}>
                    <MessageCircle className="w-10 h-10" style={{ color: "hsl(var(--wa-gold-deep))" }} />
                  </div>
                  <p className="wa-body text-sm" style={{ color: "#8696a0" }}>Nenhuma mensagem nesta conversa</p>
                </div>
              </div>
            ) : (
              messages.map(msg => {
                const isOut = msg.sender === "usuario";
                const otherDevice = isOut && isFromOtherDevice(msg);
                return (
                  <div key={msg.id} className={`group flex ${isOut ? "justify-end" : "justify-start"} gap-2`}>
                    {!isOut && (
                      <ContactAvatar
                        name={selectedConversation.nome_contato || selectedConversation.telefone}
                        photoUrl={selectedConversation.foto_url}
                        size={28}
                        className="mt-1 self-end"
                      />
                    )}
                    <div className="relative max-w-[70%]">
                      <div className={`wa-bubble ${isOut ? "wa-bubble-out" : "wa-bubble-in"}`}>
                        {msg.tipo_disparo === "boas_vindas" && (
                          <div className="flex items-center gap-1 text-[10px] opacity-70 mb-1">
                            <Sparkles className="w-3 h-3" /> Boas-vindas automática
                          </div>
                        )}
                        {otherDevice && (
                          <div className="mb-1">
                            <span className="wa-otherdev" title="Esta mensagem foi enviada de outro dispositivo (celular ou outra sessão do WhatsApp)">
                              <Phone className="w-2.5 h-2.5" /> outro dispositivo
                            </span>
                          </div>
                        )}
                        {renderQuoted(msg)}
                        {renderMessageBody(msg)}
                        <p className="wa-mono text-[10px] mt-1 flex items-center justify-end gap-1"
                           style={{ color: isOut ? "rgba(233,237,239,0.6)" : "#8696a0" }}>

                          {formatMessageTime(msg.created_at)} {renderStatus(msg)}
                        </p>
                        {renderReactions(msg)}
                      </div>
                      {/* Hover actions: reply + react */}
                      {!msg.deleted_at && (
                        <div className={`absolute top-0 ${isOut ? "left-0 -translate-x-full pr-1" : "right-0 translate-x-full pl-1"} opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5`}>
                          <button
                            onClick={() => setReplyTo(msg)}
                            title="Responder"
                            className="p-1 rounded-full"
                            style={{ background: "#2a3942", border: "1px solid var(--wa-hairline)", color: "hsl(var(--wa-gold-soft))" }}>
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                title="Reagir"
                                className="p-1 rounded-full"
                                style={{ background: "#2a3942", border: "1px solid var(--wa-hairline)", color: "hsl(var(--wa-gold-soft))" }}>
                                <Smile className="w-3.5 h-3.5" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-1 flex gap-1" side="top">
                              {["👍","❤️","😂","😮","😢","🙏","🔥"].map(e => (
                                <button key={e} onClick={() => sendReaction(msg, e)}
                                  className="text-lg hover:scale-125 transition-transform px-1">
                                  {e}
                                </button>
                              ))}
                            </PopoverContent>
                          </Popover>
                          <button
                            onClick={() => setReassignMessage(msg)}
                            title="Mover para outra conversa"
                            className="p-1 rounded-full"
                            style={{ background: "#2a3942", border: "1px solid var(--wa-hairline)", color: "hsl(var(--wa-gold-soft))" }}>
                            <Move className="w-3.5 h-3.5" />
                          </button>
                        </div>

                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply chip */}
          {replyTo && (
            <div className="wa-panel-2 px-3 pt-2 shrink-0">
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg" style={{ background: "#2a3942", borderLeft: "2px solid hsl(var(--wa-gold))" }}>
                <CornerDownRight className="w-4 h-4 mt-0.5" style={{ color: "hsl(var(--wa-gold-soft))" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "hsl(var(--wa-gold-soft))" }}>Respondendo</div>
                  <div className="text-xs truncate" style={{ color: "#8696a0" }}>{replyTo.conteudo || "mídia"}</div>
                </div>
                <button onClick={() => setReplyTo(null)} className="wa-icon-btn !h-7 !w-7">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          <div className="wa-header-bar p-3 shrink-0" style={{ borderTop: "1px solid var(--wa-hairline)", borderBottom: "none" }}>
            {recording ? (
              <div className="flex items-center gap-3 h-10 px-3 rounded-full bg-rose-500/10 border border-rose-500/30">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-sm text-rose-300 flex-1">
                  Gravando… {recordStart ? Math.floor((Date.now() - recordStart) / 1000) : 0}s
                </span>
                <Button onClick={stopRecording} size="icon" className="h-9 w-9 rounded-full bg-rose-500 hover:bg-rose-600">
                  <StopCircle className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button className="wa-icon-btn !h-10 !w-10 shrink-0"><Smile className="w-5 h-5" /></button>
                <button className="wa-icon-btn !h-10 !w-10 shrink-0" onClick={handleAttach} disabled={uploading}>
                  {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
                </button>
                <input ref={fileInputRef} type="file" hidden onChange={handleFileSelected}
                  accept="image/*,video/*,audio/*,application/pdf" />
                <Input placeholder="Digite uma mensagem..." value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)} onKeyDown={handleKeyPress}
                  disabled={sending} className="wa-input flex-1 h-10 placeholder:text-[#667781]" />
                {newMessage.trim() ? (
                  <button onClick={handleSendMessage} disabled={sending}
                    className="wa-send-btn h-10 w-10 shrink-0 flex items-center justify-center disabled:opacity-50">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                ) : (
                  <button onClick={startRecording} title="Gravar áudio"
                    className="wa-send-btn h-10 w-10 shrink-0 flex items-center justify-center">
                    <Mic className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="wa-chat-bg flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <div className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: "rgba(201,162,39,0.05)", border: "1px solid var(--wa-hairline)" }}>
              <MessageCircle className="w-12 h-12" style={{ color: "hsl(var(--wa-gold-deep))" }} />
            </div>
            <h2 className="wa-name text-2xl font-semibold mb-2" style={{ color: "#e9edef" }}>WhatsApp Inbox</h2>
            <p className="wa-body text-sm mb-4" style={{ color: "#8696a0" }}>Selecione uma conversa ou configure a Evolution API.</p>
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
                  <code className="flex-1 text-xs bg-background/60 border border-border rounded px-2 py-2 font-mono break-all">{webhookUrl}</code>
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
              <div className="border border-border rounded-lg p-3 space-y-3">
                <Label className="text-xs">Nova tag</Label>
                <div className="flex gap-2 items-center flex-wrap">
                  <Input placeholder="ex: VIP, Aguardando, Quente..." value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)} className="flex-1 min-w-[180px]" />
                  <Button size="icon" onClick={createTag} className="h-9 w-9"><Plus className="w-4 h-4" /></Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-muted-foreground">Cor:</span>
                  <div className="flex gap-1">
                    {TAG_COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setNewTagColor(c)}
                        title={c}
                        className={`w-6 h-6 rounded-full border-2 ${newTagColor.toLowerCase() === c.toLowerCase() ? "border-foreground" : "border-transparent"}`}
                        style={{ background: c }} />
                    ))}
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <input
                      type="color"
                      value={newTagColor}
                      onChange={(e) => setNewTagColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer bg-transparent border border-border"
                      title="Escolher cor personalizada"
                    />
                    <Input
                      value={newTagColor}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) {
                          setNewTagColor(v.startsWith("#") ? v : `#${v}`);
                        }
                      }}
                      maxLength={7}
                      className="w-24 h-8 font-mono text-xs uppercase"
                      placeholder="#RRGGBB"
                    />
                  </div>
                  <span className="wa-tag-chip ml-auto" data-active={newTagName ? "true" : undefined}
                    style={{ "--wa-tag-color": newTagColor } as React.CSSProperties}>
                    <span className="wa-tag-dot" />
                    {newTagName || "Prévia"}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                {allTags.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhuma tag criada.</p>}
                {allTags.map(t => (
                  <div key={t.id} className="flex items-center justify-between border border-border rounded p-2">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ background: t.cor, boxShadow: `0 0 8px ${t.cor}66` }} />
                      <span className="text-sm">{t.nome}</span>
                      <span className="wa-mono text-[10px] opacity-60">{t.cor}</span>
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

      {/* Delete confirmation */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove permanentemente a conversa com{" "}
              <span className="font-semibold text-foreground">
                {confirmDelete?.nome_contato || confirmDelete?.telefone}
              </span>{" "}
              e todas as mensagens vinculadas. Não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteConversation(); }}
              disabled={deleting}
              className="bg-rose-600 hover:bg-rose-700 text-white">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UnifiedLeadPanel
        source={leadPanelId ? "lead" : null}
        leadId={leadPanelId}
        open={!!leadPanelId}
        onClose={() => setLeadPanelId(null)}
        onUpdated={loadConversations}
      />

      <LidReviewDialog
        open={lidReviewOpen}
        onOpenChange={setLidReviewOpen}
        tenantId={masterMode ? null : (tenantId ?? null)}
        onDone={loadConversations}
      />

      <ReassignMessageDialog
        open={!!reassignMessage}
        onClose={() => setReassignMessage(null)}
        message={reassignMessage as any}
        currentConversationId={selectedConversation?.id || ""}
        tenantId={masterMode ? null : (tenantId ?? null)}
        onMoved={() => { if (selectedConversation) loadMessages(selectedConversation.id); }}
      />

    </div>
  );

};

export default WhatsAppChat;
