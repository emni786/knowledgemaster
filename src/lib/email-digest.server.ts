import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

type Frequency = "weekly" | "monthly";

type LinkRow = {
  id: string;
  title: string | null;
  summary: string | null;
  url: string;
  domain: string | null;
  content_type: string;
  tags: string[] | null;
  created_at: string;
};

type Digest = {
  headline: string;
  themes: Array<{ title: string; summary: string; linkIds: string[] }>;
  takeaways: string[];
};

async function callAI(system: string, user: string): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "{}";
}

async function buildDigest(links: LinkRow[], frequency: Frequency): Promise<Digest> {
  if (!links.length) {
    return {
      headline: `Nothing new this ${frequency === "weekly" ? "week" : "month"}.`,
      themes: [{ title: "Quiet stretch", summary: "No links were saved during this window.", linkIds: [] }],
      takeaways: ["Forward links to your Telegram bot or paste them in the library to populate next digest."],
    };
  }
  const compact = links.map((l) => ({
    id: l.id,
    title: l.title?.slice(0, 140) ?? l.url,
    domain: l.domain,
    type: l.content_type,
    summary: l.summary?.slice(0, 200) ?? "",
    tags: l.tags?.slice(0, 6) ?? [],
  }));
  const system =
    "You write punchy newsletter-style digests for a personal knowledge library. " +
    'Reply with strict JSON: {"headline":"...","themes":[{"title":"...","summary":"2-3 sentences","linkIds":["..."]}],"takeaways":["...","..."]}. ' +
    "Group 3-5 themes. Each theme groups related linkIds from input. 3-5 takeaways total.";
  const user = `Saved links from the past ${frequency === "weekly" ? "7 days" : "30 days"}: ${JSON.stringify(compact)}`;
  const raw = await callAI(system, user);
  return JSON.parse(raw) as Digest;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function renderHtml(digest: Digest, links: LinkRow[], frequency: Frequency): string {
  const byId = new Map(links.map((l) => [l.id, l]));
  const period = frequency === "weekly" ? "Past 7 days" : "Past 30 days";
  const themes = digest.themes
    .map((t) => {
      const items = t.linkIds
        .slice(0, 5)
        .map((id) => byId.get(id))
        .filter((l): l is LinkRow => !!l)
        .map(
          (l) =>
            `<li style="margin:4px 0;"><a href="${esc(l.url)}" style="color:#3b82f6;text-decoration:none;">${esc(l.title ?? l.url)}</a>${l.domain ? ` <span style="color:#94a3b8;font-size:12px;">· ${esc(l.domain)}</span>` : ""}</li>`
        )
        .join("");
      return `<div style="margin:24px 0;padding:16px;border:1px solid #1f2937;border-radius:12px;background:#0b1220;">
        <h3 style="margin:0 0 8px;font-size:16px;color:#e2e8f0;">${esc(t.title)}</h3>
        <p style="margin:0 0 8px;color:#94a3b8;font-size:14px;line-height:1.5;">${esc(t.summary)}</p>
        ${items ? `<ul style="margin:8px 0 0;padding-left:18px;color:#cbd5e1;font-size:13px;">${items}</ul>` : ""}
      </div>`;
    })
    .join("");
  const takeaways = digest.takeaways
    .map((t) => `<li style="margin:6px 0;color:#cbd5e1;font-size:14px;line-height:1.5;">${esc(t)}</li>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#020617;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
      <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#3b82f6;font-family:monospace;">Knowledgemaster · ${period}</div>
      <h1 style="margin:8px 0 24px;font-size:28px;color:#f1f5f9;line-height:1.2;">${esc(digest.headline)}</h1>
      ${themes}
      <h2 style="margin:32px 0 8px;font-size:14px;letter-spacing:0.15em;text-transform:uppercase;color:#94a3b8;font-family:monospace;">Key takeaways</h2>
      <ul style="margin:0;padding-left:18px;">${takeaways}</ul>
      <p style="margin:32px 0 0;color:#64748b;font-size:12px;line-height:1.5;">You're receiving this because you enabled the ${frequency} digest in Knowledgemaster. <a href="https://knowledgemaster.lovable.app/settings" style="color:#94a3b8;">Manage preferences</a>.</p>
    </div>
  </body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const from = process.env.RESEND_FROM_EMAIL || "Knowledgemaster <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()) as { id?: string };
}

export async function sendDigestForUser(
  userId: string,
  frequency: Frequency,
  opts: { force?: boolean } = {}
): Promise<{ ok: true; sent: boolean; reason?: string; count?: number; emailId?: string }> {
  const { data: sub, error: sErr } = await supabaseAdmin
    .from("email_subscriptions")
    .select("email, frequency, last_sent_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (sErr) throw new Error(sErr.message);
  if (!sub) return { ok: true, sent: false, reason: "no_subscription" };
  if (!opts.force && sub.frequency === "off") return { ok: true, sent: false, reason: "off" };

  const days = frequency === "weekly" ? 7 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data: rows, error: lErr } = await supabaseAdmin
    .from("links")
    .select("id,title,summary,url,domain,content_type,tags,created_at")
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(60);
  if (lErr) throw new Error(lErr.message);
  const links = (rows ?? []) as LinkRow[];

  const digest = await buildDigest(links, frequency);
  const subject = `${frequency === "weekly" ? "Your week" : "Your month"} in Knowledgemaster — ${digest.headline.slice(0, 80)}`;
  const html = renderHtml(digest, links, frequency);
  const sent = await sendEmail(sub.email, subject, html);

  await supabaseAdmin
    .from("email_subscriptions")
    .update({ last_sent_at: new Date().toISOString() })
    .eq("user_id", userId);

  return { ok: true, sent: true, count: links.length, emailId: sent.id };
}

export async function runDueDigests(): Promise<{ processed: number; sent: number; errors: number }> {
  const now = Date.now();
  const weekAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  const monthAgo = new Date(now - 30 * 24 * 3600 * 1000).toISOString();

  const { data: weekly } = await supabaseAdmin
    .from("email_subscriptions")
    .select("user_id, last_sent_at")
    .eq("frequency", "weekly")
    .or(`last_sent_at.is.null,last_sent_at.lt.${weekAgo}`);
  const { data: monthly } = await supabaseAdmin
    .from("email_subscriptions")
    .select("user_id, last_sent_at")
    .eq("frequency", "monthly")
    .or(`last_sent_at.is.null,last_sent_at.lt.${monthAgo}`);

  const jobs: Array<{ userId: string; freq: Frequency }> = [
    ...(weekly ?? []).map((r) => ({ userId: r.user_id as string, freq: "weekly" as const })),
    ...(monthly ?? []).map((r) => ({ userId: r.user_id as string, freq: "monthly" as const })),
  ];

  let sent = 0;
  let errors = 0;
  for (const j of jobs) {
    try {
      const r = await sendDigestForUser(j.userId, j.freq);
      if (r.sent) sent++;
    } catch (e) {
      errors++;
      console.error("digest failed", j.userId, e);
    }
  }
  return { processed: jobs.length, sent, errors };
}
