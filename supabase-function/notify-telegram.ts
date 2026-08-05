import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOTAL_TASKS = 9;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { staffName, taskDate } = await req.json();
    if (!staffName || !taskDate) {
      return new Response(JSON.stringify({ error: "Missing staffName or taskDate" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatId = Deno.env.get("TELEGRAM_CHAT_ID");

    const supabase = createClient(supabaseUrl, serviceKey);

    // Re-verify completion server-side so a bare API call can't fake a submission
    const { data: rows, error: qErr } = await supabase
      .from("checklist_status")
      .select("done")
      .eq("task_date", taskDate)
      .eq("staff_name", staffName);
    if (qErr) throw qErr;

    const doneCount = (rows || []).filter((r) => r.done).length;
    if (doneCount < TOTAL_TASKS) {
      return new Response(JSON.stringify({ error: "Checklist not fully complete" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record the submission; unique constraint blocks duplicate notifications
    const { error: insertErr } = await supabase
      .from("daily_submissions")
      .insert({ task_date: taskDate, staff_name: staffName });

    if (insertErr) {
      if (insertErr.code === "23505") {
        return new Response(JSON.stringify({ ok: true, note: "already submitted" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw insertErr;
    }

    const text = `✅ Premission Power closing checklist completed for ${taskDate} by ${staffName}.`;
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const tgData = await tgRes.json();
    if (!tgData.ok) throw new Error(tgData.description || "Telegram send failed");

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
