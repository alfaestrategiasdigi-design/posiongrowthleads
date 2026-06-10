// Dispara lembretes de agendamento via Z-API conforme reminder_hours_before
// Roda a cada 15 minutos via pg_cron
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Pega a conexão Z-API ativa
    const { data: conn } = await supabase
      .from("zapi_connections")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conn) {
      return new Response(JSON.stringify({ ok: true, skipped: "no zapi connection" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();

    // Busca agendamentos pendentes de lembrete cuja janela já chegou
    const { data: pending, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("send_reminder", true)
      .eq("reminder_sent", false)
      .in("status", ["agendado", "em_andamento"])
      .gt("date_time", now.toISOString());

    if (error) throw error;

    const toSend = (pending || []).filter((a) => {
      const apptTime = new Date(a.date_time).getTime();
      const sendAt = apptTime - a.reminder_hours_before * 60 * 60 * 1000;
      return sendAt <= now.getTime();
    });

    const results: any[] = [];

    for (const appt of toSend) {
      const dt = new Date(appt.date_time);
      const horario = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const data = dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const phone = String(appt.client_phone).replace(/\D/g, "");
      const phoneFmt = phone.startsWith("55") ? phone : `55${phone}`;

      const message =
        `Olá, ${appt.client_name}! 👋\n\n` +
        `Passando para confirmar seu agendamento em ${data} às ${horario}.\n\n` +
        `Você confirma sua presença?`;

      const url = `https://api.z-api.io/instances/${conn.instance_id}/token/${conn.token}/send-button-list`;

      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Client-Token": conn.client_token,
          },
          body: JSON.stringify({
            phone: phoneFmt,
            message,
            buttonList: {
              buttons: [
                { id: "confirma", label: "✅ Confirmo presença" },
                { id: "remarca", label: "❌ Preciso remarcar" },
              ],
            },
          }),
        });
        const body = await resp.text();
        const ok = resp.ok;

        if (ok) {
          await supabase
            .from("appointments")
            .update({ reminder_sent: true, reminder_sent_at: new Date().toISOString() })
            .eq("id", appt.id);
        }
        results.push({ id: appt.id, ok, status: resp.status, body: body.slice(0, 200) });
      } catch (e) {
        results.push({ id: appt.id, ok: false, error: String(e) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, checked: pending?.length || 0, sent: results.filter(r => r.ok).length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("reminder error", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
