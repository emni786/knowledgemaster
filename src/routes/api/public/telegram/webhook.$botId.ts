import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const TG_API = "https://api.telegram.org";

function getAdmin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

function extractUrls(text: string | undefined | null): string[] {
  if (!text) return [];
  const matches = text.match(URL_RE) ?? [];
  return Array.from(new Set(matches.map((u) => u.replace(/[)\].,;!?]+$/, ""))));
}

function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

function detectType(url: string): string {
  const d = domainOf(url) ?? "";
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(d)) return "video";
  if (/github\.com|gitlab\.com/.test(d)) return "repo";
  if (/docs\.google|notion\.so|hackmd/.test(d)) return "doc";
  if (/twitter\.com|x\.com|reddit\.com|news\.ycombinator/.test(d)) return "social";
  return "article";
}

function youtubeVideoId(u: string): string | null {
  try {
    const url = new URL(u);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
    if (host.endsWith("youtube.com") || host === "m.youtube.com") {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
      if (m) return m[2];
    }
    return null;
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function extractMeta(html: string): { title: string; description: string; siteName: string } {
  const pick = (re: RegExp) => html.match(re)?.[1]?.trim() ?? "";
  const title =
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<title[^>]*>([^<]+)<\/title>/i);
  const description =
    pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const siteName = pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  return { title: decodeEntities(title), description: decodeEntities(description), siteName: decodeEntities(siteName) };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; KnowledgemasterBot/1.0; +https://knowledgemaster.lovable.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("xml")) return "";
    const text = await res.text();
    return text.slice(0, 200_000);
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

async function fetchYoutubeOEmbed(url: string): Promise<{ title: string; author: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const j = (await res.json()) as { title?: string; author_name?: string };
    if (!j.title) return null;
    return { title: j.title, author: j.author_name ?? "" };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function summarize(url: string): Promise<{ title: string | null; summary: string | null; tags: string[]; content_type: string | null }> {
  const apiKey = process.env.LOVABLE_API_KEY;

  const ytId = youtubeVideoId(url);
  let meta = { title: "", description: "", siteName: "" };
  let bodyText = "";

  if (ytId) {
    const oe = await fetchYoutubeOEmbed(url);
    if (oe) {
      meta = {
        title: oe.title,
        description: oe.author ? `YouTube video by ${oe.author}.` : "",
        siteName: "YouTube",
      };
      bodyText = `YouTube video. Title: ${oe.title}. Channel: ${oe.author}. Video ID: ${ytId}.`;
    }
  } else {
    const html = await fetchPage(url);
    if (html) {
      meta = extractMeta(html);
      bodyText = stripHtml(html).slice(0, 4000);
    }
  }

  if (!apiKey) {
    return {
      title: meta.title || null,
      summary: meta.description || null,
      tags: ytId ? ["youtube", "video"] : [],
      content_type: ytId ? "video" : null,
    };
  }

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You analyze URLs for a knowledge library. Reply with strict JSON only: {\"title\":\"...\",\"summary\":\"...\",\"tags\":[\"kebab-case\",\"3 to 6\"]}. Title <= 120 chars (specific, no marketing fluff). Summary 1-2 neutral sentences <= 280 chars covering what it is and why it matters. Tags are conceptual, reusable, lowercase kebab-case.",
          },
          {
            role: "user",
            content: JSON.stringify({
              url,
              og_title: meta.title.slice(0, 240),
              og_description: meta.description.slice(0, 600),
              site: meta.siteName.slice(0, 80),
              body_excerpt: bodyText.slice(0, 3000),
            }),
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      return {
        title: meta.title || null,
        summary: meta.description || null,
        tags: ytId ? ["youtube", "video"] : [],
        content_type: ytId ? "video" : null,
      };
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { title?: string; summary?: string; tags?: string[] };
    const tags = Array.from(
      new Set((parsed.tags ?? []).map((t) => t.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")).filter(Boolean))
    ).slice(0, 6);
    return {
      title: parsed.title?.slice(0, 200) ?? meta.title ?? null,
      summary: parsed.summary?.slice(0, 1000) ?? meta.description ?? null,
      tags: tags.length ? tags : ytId ? ["youtube", "video"] : [],
      content_type: ytId ? "video" : null,
    };
  } catch {
    return {
      title: meta.title || null,
      summary: meta.description || null,
      tags: ytId ? ["youtube", "video"] : [],
      content_type: ytId ? "video" : null,
    };
  }
}

export const Route = createFileRoute("/api/public/telegram/webhook/$botId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const admin = getAdmin();
        const { data: bot } = await admin
          .from("telegram_bots")
          .select("id, owner_id, bot_token, webhook_secret, active")
          .eq("id", params.botId)
          .maybeSingle();

        if (!bot || !bot.active) return new Response("Not found", { status: 404 });

        const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (provided !== bot.webhook_secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const update = await request.json().catch(() => null) as
          | Record<string, unknown>
          | null;
        const msg = (update?.message ?? update?.channel_post ?? update?.edited_message ?? update?.edited_channel_post) as
          | { chat?: { id: number; title?: string }; text?: string; caption?: string; entities?: Array<{ type: string; url?: string }>; caption_entities?: Array<{ type: string; url?: string }> }
          | undefined;
        if (!msg) return Response.json({ ok: true });

        const text = `${msg.text ?? ""} ${msg.caption ?? ""}`.trim();
        const entityUrls = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])]
          .filter((e) => e.type === "url" || e.type === "text_link")
          .map((e) => e.url)
          .filter((u): u is string => Boolean(u));
        const urls = Array.from(new Set([...extractUrls(text), ...entityUrls]));

        const chatId = msg.chat?.id;
        const botToken = bot.bot_token;

        // Remember most recent chat for forwarding website-saved links back to Telegram
        if (chatId) {
          await admin
            .from("telegram_bots")
            .update({ default_chat_id: chatId })
            .eq("id", bot.id)
            .then(() => undefined, () => undefined);
        }

        async function reply(textBody: string) {
          if (!chatId) return;
          await fetch(`${TG_API}/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: textBody, disable_web_page_preview: true }),
          }).catch(() => {});
        }

        if (!urls.length) {
          await reply("Send me a link and I'll save it to your Knowledgemaster library.");
          return Response.json({ ok: true });
        }

        let saved = 0;
        for (const url of urls) {
          const norm = normalize(url);
          const dom = domainOf(norm);
          const ai = await summarize(url);
          const { error } = await admin.from("links").insert({
            owner_id: bot.owner_id,
            url,
            normalized_url: norm,
            domain: dom,
            content_type: detectType(url),
            status: "ready",
            source: "telegram",
            title: ai.title ?? dom ?? url,
            summary: ai.summary ?? `Saved from Telegram (${dom ?? "link"}).`,
            tags: [],
            fetched_at: new Date().toISOString(),
          });
          if (!error) saved++;
        }

        await reply(saved === urls.length
          ? `Saved ${saved} link${saved === 1 ? "" : "s"} to your library.`
          : `Saved ${saved} of ${urls.length} links.`);

        return Response.json({ ok: true, saved });
      },
    },
  },
});
