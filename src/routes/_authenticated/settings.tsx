import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Bot, Loader2, Trash2, ExternalLink, Copy, Check, Activity, Chrome, Download, Plus, KeyRound, Lock, Upload, FileJson } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  addTelegramBot,
  deleteTelegramBot,
  listTelegramBots,
  testTelegramWebhook,
  importTelegramLinks,
} from "@/lib/telegram.functions";
import { createApiToken, listApiTokens, revokeApiToken } from "@/lib/api-tokens.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Knowledgemaster" },
      { name: "description", content: "Manage your Knowledgemaster account, integrations, and preferences." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/50 bg-background/80 px-4 backdrop-blur">
        <Link to="/library">
          <Button variant="ghost" size="icon" className="h-9 w-9"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-sm font-semibold tracking-tight">Settings</h1>
      </header>
      <main className="mx-auto max-w-3xl space-y-10 px-6 py-10">
        <section>
          <h2 className="font-display text-3xl font-semibold">Settings</h2>
          <p className="mt-2 text-sm text-muted-foreground">Manage your Knowledgemaster account, integrations, and preferences.</p>
        </section>
        <BrowserExtension />
        <TelegramBots />
        <ChangePassword />
      </main>
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 6) return toast.error("Password must be at least 6 characters");
    if (next !== confirm) return toast.error("Passwords don't match");
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email;
    if (!email) {
      setLoading(false);
      return toast.error("Not signed in");
    }
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: current });
    if (signInErr) {
      setLoading(false);
      return toast.error("Current password is incorrect");
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    setCurrent(""); setNext(""); setConfirm("");
  };

  return (
    <section data-card className="rounded-xl border border-border/60 p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Lock className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-lg font-semibold">Change password</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Update the password you use to sign in with email.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-6 space-y-3 max-w-sm">
        <div className="space-y-1.5">
          <Label htmlFor="current_pw" className="text-xs uppercase tracking-wide text-muted-foreground">Current password</Label>
          <Input id="current_pw" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new_pw" className="text-xs uppercase tracking-wide text-muted-foreground">New password</Label>
          <Input id="new_pw" type="password" autoComplete="new-password" minLength={6} value={next} onChange={(e) => setNext(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm_pw" className="text-xs uppercase tracking-wide text-muted-foreground">Confirm new password</Label>
          <Input id="confirm_pw" type="password" autoComplete="new-password" minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        <Button type="submit" disabled={loading || !current || !next || !confirm}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
        </Button>
      </form>
    </section>
  );
}

function TelegramBots() {
  const qc = useQueryClient();
  const list = useServerFn(listTelegramBots);
  const add = useServerFn(addTelegramBot);
  const remove = useServerFn(deleteTelegramBot);
  const test = useServerFn(testTelegramWebhook);
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["telegram-bots"],
    queryFn: () => list(),
  });

  const addMut = useMutation({
    mutationFn: (bot_token: string) => add({ data: { bot_token } }),
    onSuccess: (res) => {
      toast.success(`Connected @${res.username ?? "bot"} — send it a link to save.`);
      setToken("");
      qc.invalidateQueries({ queryKey: ["telegram-bots"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Bot disconnected");
      qc.invalidateQueries({ queryKey: ["telegram-bots"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => test({ data: { id } }),
    onSuccess: (res) => {
      if (res.repaired) {
        toast.success("Webhook URL was wrong — re-registered with Telegram.");
      } else if (res.lastErrorMessage) {
        toast.warning(`Webhook OK, but Telegram reports: ${res.lastErrorMessage}`);
      } else {
        toast.success(`Webhook OK · ${res.pendingUpdates} pending update${res.pendingUpdates === 1 ? "" : "s"}.`);
      }
      qc.invalidateQueries({ queryKey: ["telegram-bots"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bots = data?.bots ?? [];

  return (
    <section data-card className="rounded-xl border border-border/60 p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Bot className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-lg font-semibold">Telegram bot</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a bot with{" "}
            <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              @BotFather <ExternalLink className="h-3 w-3" />
            </a>{" "}
            and paste the token below. DM the bot a link and it gets saved.
            For channels and groups, <strong>add the bot as an admin</strong> (groups need "read all
            messages" or admin rights, channels need posting/admin). Every new message is then scanned
            and links are auto-saved to your library.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Telegram does not let bots read history from before they joined — use the JSON backfill
            below to import older messages from a chat.
          </p>
        </div>
      </div>

      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!token.trim()) return;
          addMut.mutate(token.trim());
        }}
      >
        <Label htmlFor="bot_token" className="text-xs uppercase tracking-wide text-muted-foreground">
          Bot token
        </Label>
        <div className="flex gap-2">
          <Input
            id="bot_token"
            placeholder="123456789:ABCdefGhIJKlmNoPQRstuVWxyz0123456789"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" disabled={addMut.isPending || !token.trim()}>
            {addMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Stored encrypted-at-rest in your private library. Only used to receive link messages and reply to you.
        </p>
      </form>

      <div className="mt-8 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connected bots</h4>
        {isLoading ? (
          <div data-card data-morph="paper" className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : bots.length === 0 ? (
          <div data-card data-morph="paper" className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            No bot connected yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {bots.map((b) => {
              const handle = b.bot_username ? `@${b.bot_username}` : "Telegram bot";
              const link = b.bot_username ? `https://t.me/${b.bot_username}` : null;
              return (
                <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/60 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Bot className="h-4 w-4 text-primary" />
                      {link ? (
                        <a href={link} target="_blank" rel="noreferrer" className="hover:underline">{handle}</a>
                      ) : (
                        <span>{handle}</span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${b.active ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
                        {b.active ? "active" : "paused"}
                      </span>
                    </div>
                    {b.last_error ? (
                      <p className="mt-1 truncate text-xs text-destructive">{b.last_error}</p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">Send the bot any link to save it.</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {link && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          navigator.clipboard.writeText(link);
                          setCopied(b.id);
                          setTimeout(() => setCopied((c) => (c === b.id ? null : c)), 1500);
                        }}
                        title="Copy bot link"
                      >
                        {copied === b.id ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={testMut.isPending && testMut.variables === b.id}
                      onClick={() => testMut.mutate(b.id)}
                      title="Test webhook"
                    >
                      {testMut.isPending && testMut.variables === b.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Activity className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      disabled={delMut.isPending}
                      onClick={() => {
                        if (confirm(`Disconnect ${handle}?`)) delMut.mutate(b.id);
                      }}
                      title="Disconnect"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <TelegramBackfill />
    </section>
  );
}

function TelegramBackfill() {
  const importFn = useServerFn(importTelegramLinks);
  const qc = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ urls: string[]; chatTitle?: string } | null>(null);

  const mut = useMutation({
    mutationFn: (p: { urls: string[]; chat_title?: string }) =>
      importFn({ data: { urls: p.urls, chat_title: p.chat_title } }),
    onSuccess: (res) => {
      toast.success(`Imported ${res.imported} new links${res.skipped ? ` (skipped ${res.skipped} duplicates)` : ""}`);
      qc.invalidateQueries({ queryKey: ["links"] });
      setPreview(null);
      setFileName(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleFile(file: File) {
    setFileName(file.name);
    if (file.size > 200 * 1024 * 1024) {
      toast.error("File too large (max 200MB). Trim the export first.");
      return;
    }
    try {
      const text = await file.text();
      const json = JSON.parse(text) as {
        name?: string;
        messages?: Array<{
          text_entities?: Array<{ type: string; text: string; href?: string }>;
          text?: string | Array<string | { type: string; text: string; href?: string }>;
        }>;
      };
      const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
      const urls = new Set<string>();
      for (const m of json.messages ?? []) {
        for (const ent of m.text_entities ?? []) {
          if (ent.type === "link") {
            (ent.text.match(URL_RE) ?? []).forEach((u) => urls.add(u.replace(/[)\].,;!?]+$/, "")));
          } else if (ent.type === "text_link" && ent.href) {
            urls.add(ent.href);
          }
        }
        if (typeof m.text === "string") {
          (m.text.match(URL_RE) ?? []).forEach((u) => urls.add(u.replace(/[)\].,;!?]+$/, "")));
        } else if (Array.isArray(m.text)) {
          for (const part of m.text) {
            if (typeof part === "string") {
              (part.match(URL_RE) ?? []).forEach((u) => urls.add(u.replace(/[)\].,;!?]+$/, "")));
            } else if (part?.type === "text_link" && part.href) {
              urls.add(part.href);
            } else if (part?.type === "link" && part.text) {
              (part.text.match(URL_RE) ?? []).forEach((u) => urls.add(u.replace(/[)\].,;!?]+$/, "")));
            }
          }
        }
      }
      const list = Array.from(urls);
      if (list.length === 0) {
        toast.error("No links found in this export.");
        return;
      }
      setPreview({ urls: list, chatTitle: json.name });
    } catch (e) {
      toast.error("Could not parse JSON. Use Telegram Desktop → Export chat history → JSON.");
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-dashed border-border/60 p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <FileJson className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-semibold">Backfill from chat export</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Open Telegram <strong>Desktop</strong> → the channel/group → ⋮ menu → <em>Export chat history</em> →
            format <strong>JSON</strong>. Upload the resulting <code>result.json</code> below and every link in
            that history will be added to your library.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="inline-flex">
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <span className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-1.5 text-xs font-medium hover:bg-background">
            <Upload className="h-3.5 w-3.5" />
            Choose result.json
          </span>
        </label>
        {fileName && (
          <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[40%]">{fileName}</span>
        )}
      </div>

      {preview && (
        <div className="mt-4 rounded-md border border-border/60 bg-background/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              Found <strong>{preview.urls.length}</strong> link{preview.urls.length === 1 ? "" : "s"}
              {preview.chatTitle && <> in <strong>{preview.chatTitle}</strong></>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setPreview(null); setFileName(null); }} disabled={mut.isPending}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={mut.isPending}
                onClick={() => mut.mutate({ urls: preview.urls, chat_title: preview.chatTitle })}
              >
                {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Import {preview.urls.length}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BrowserExtension() {
  const qc = useQueryClient();
  const list = useServerFn(listApiTokens);
  const create = useServerFn(createApiToken);
  const revoke = useServerFn(revokeApiToken);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => list(),
  });

  const createMut = useMutation({
    mutationFn: () => create({ data: { label: "Browser extension" } }),
    onSuccess: (res) => {
      setJustCreated(res.token);
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: () => {
      toast.success("Token revoked");
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const downloadExtension = () => {
    fetch("/knowledgemaster-extension.zip")
      .then((r) => {
        if (!r.ok) throw new Error(`Download failed: ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "knowledgemaster-extension.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => toast.error(err.message));
  };

  const tokens = data?.tokens ?? [];

  return (
    <section data-card className="rounded-xl border border-border/60 p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Chrome className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-lg font-semibold">Browser extension</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Save the page you're on to Knowledgemaster with one click. Install the Chrome extension,
            then paste an API token below to connect it to your account.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Button onClick={downloadExtension} variant="outline" className="justify-start gap-2">
          <Download className="h-4 w-4" /> Download extension (.zip)
        </Button>
        <Button onClick={() => createMut.mutate()} disabled={createMut.isPending} className="justify-start gap-2">
          {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Generate API token
        </Button>
      </div>

      {justCreated && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Your new token — copy it now</p>
          <p className="mt-1 text-xs text-muted-foreground">This is shown once. Paste it into the extension popup.</p>
          <div className="mt-3 flex gap-2">
            <Input readOnly value={justCreated} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              size="icon"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(justCreated);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" onClick={() => setJustCreated(null)}>Done</Button>
          </div>
        </div>
      )}

      <details className="mt-6 rounded-lg border border-border/60 bg-background/60 p-4 text-sm">
        <summary className="cursor-pointer font-medium">Install instructions</summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted-foreground">
          <li>Download and unzip the extension.</li>
          <li>Open <code className="rounded bg-muted px-1">chrome://extensions</code> in Chrome (or any Chromium browser).</li>
          <li>Enable <strong>Developer mode</strong> (top-right toggle).</li>
          <li>Click <strong>Load unpacked</strong> and select the unzipped folder.</li>
          <li>Click the extension icon, paste your API token, then save any page.</li>
        </ol>
      </details>

      <div className="mt-8 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">API tokens</h4>
        {isLoading ? (
          <div data-card data-morph="paper" className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : tokens.length === 0 ? (
          <div data-card data-morph="paper" className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            No tokens yet. Generate one to connect the extension.
          </div>
        ) : (
          <ul className="space-y-2">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/60 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <KeyRound className="h-4 w-4 text-primary" />
                    <span>{t.label}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{t.token_prefix}…</code>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {new Date(t.created_at).toLocaleDateString()}
                    {t.last_used_at ? ` · Last used ${new Date(t.last_used_at).toLocaleDateString()}` : " · Never used"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  disabled={revokeMut.isPending}
                  onClick={() => {
                    if (confirm("Revoke this token? The extension using it will stop working.")) revokeMut.mutate(t.id);
                  }}
                  title="Revoke"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
