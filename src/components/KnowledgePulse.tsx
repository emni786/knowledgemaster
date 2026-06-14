import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, Radio, Pin, ExternalLink, Shuffle, X } from "lucide-react";
import type { LinkRow } from "@/lib/types";
import { faviconFor, getDomain } from "@/lib/url";
import { formatDistanceToNow } from "date-fns";

/**
 * KnowledgePulse — three surfaces in one:
 *  1) Marquee ticker of recent links across the top
 *  2) Floating "knowledge nugget" popup that rotates a random link
 *  3) Tweet-style scrollable feed of newest links
 */
export function KnowledgePulse({ links }: { links: LinkRow[] }) {
  const active = useMemo(
    () => links.filter((l) => !l.deleted_at && l.status === "ready"),
    [links],
  );
  const recent = useMemo(() => active.slice(0, 30), [active]);
  const feed = useMemo(() => active.slice(0, 20), [active]);

  return (
    <div className="space-y-4">
      <Ticker links={recent} />
      <Feed links={feed} />
      <NuggetPopup pool={active} />
    </div>
  );
}

/* ---------------- Ticker ---------------- */

function Ticker({ links }: { links: LinkRow[] }) {
  if (links.length === 0) return null;
  const loop = [...links, ...links];
  return (
    <div data-card data-morph="aurora" className="rounded-2xl border border-border/60 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 text-[10px] font-mono uppercase tracking-widest text-primary">
        <Radio className="h-3 w-3 animate-pulse" /> Live pulse
      </div>
      <div
        className="relative overflow-hidden py-2.5"
        style={{ maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)" }}
      >
        <div className="flex gap-6 whitespace-nowrap animate-[pulse-scroll_60s_linear_infinite] hover:[animation-play-state:paused]">
          {loop.map((l, i) => (
            <a
              key={`${l.id}-${i}`}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-foreground/80 hover:text-primary transition-colors shrink-0"
            >
              <img
                src={faviconFor(l.url)}
                alt=""
                className="h-4 w-4 rounded-sm shrink-0"
                loading="lazy"
              />
              <span className="font-medium truncate max-w-[28ch]">{l.title || l.url}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {getDomain(l.url)}
              </span>
              <span className="text-muted-foreground">·</span>
            </a>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes pulse-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

/* ---------------- Feed ---------------- */

function Feed({ links }: { links: LinkRow[] }) {
  if (links.length === 0) {
    return (
      <div data-card data-morph="paper" className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
        Your knowledge feed is waiting — save a link to light it up.
      </div>
    );
  }
  return (
    <div data-card data-morph="glass" className="rounded-2xl border border-border/60">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Knowledge feed
        </div>
        <Link
          to="/library"
          className="text-[11px] font-mono uppercase tracking-widest text-primary hover:underline"
        >
          Open library →
        </Link>
      </div>
      <ul className="max-h-[520px] overflow-y-auto divide-y divide-border/40">
        {links.map((l) => (
          <FeedItem key={l.id} link={l} />
        ))}
      </ul>
    </div>
  );
}

function FeedItem({ link }: { link: LinkRow }) {
  const domain = link.domain || getDomain(link.url);
  return (
    <li className="px-4 py-3 hover:bg-primary/5 transition-colors group">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex gap-3 min-w-0"
      >
        <img
          src={faviconFor(link.url)}
          alt=""
          className="h-9 w-9 rounded-lg border border-border/60 shrink-0 bg-background"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <span className="truncate">{domain}</span>
            <span>·</span>
            <span>
              {formatDistanceToNow(new Date(link.created_at), { addSuffix: true })}
            </span>
            {link.pinned && <Pin className="h-3 w-3 text-amber-400 fill-amber-400" />}
            <ExternalLink className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-60 transition-opacity" />
          </div>
          <div className="mt-0.5 font-medium text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {link.title || link.url}
          </div>
          {link.summary && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {link.summary}
            </p>
          )}
          {link.tags?.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {link.tags.slice(0, 4).map((t) => (
                <span
                  key={t}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/80"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      </a>
    </li>
  );
}

/* ---------------- Floating Nugget ---------------- */

function NuggetPopup({ pool }: { pool: LinkRow[] }) {
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (pool.length === 0 || dismissed) return;
    const showTimer = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(showTimer);
  }, [pool.length, dismissed]);

  useEffect(() => {
    if (pool.length === 0 || dismissed) return;
    const rotate = setInterval(() => {
      setIdx((i) => {
        if (pool.length <= 1) return 0;
        let n = Math.floor(Math.random() * pool.length);
        if (n === i) n = (n + 1) % pool.length;
        return n;
      });
    }, 9000);
    return () => clearInterval(rotate);
  }, [pool.length, dismissed]);

  if (pool.length === 0 || dismissed || !visible) return null;
  const l = pool[idx % pool.length];
  if (!l) return null;
  const domain = l.domain || getDomain(l.url);

  return (
    <div
      key={l.id}
      className="fixed bottom-6 right-6 z-40 w-[320px] max-w-[calc(100vw-2rem)] animate-fade-in"
    >
      <div className="relative rounded-2xl border border-primary/40 bg-card/95 backdrop-blur-xl shadow-2xl shadow-primary/20 p-4">
        <div className="absolute -top-2 left-4 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-mono uppercase tracking-widest flex items-center gap-1">
          <Shuffle className="h-2.5 w-2.5" /> Knowledge nugget
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-2 right-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <a
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block mt-2"
        >
          <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <img src={faviconFor(l.url)} alt="" className="h-3.5 w-3.5 rounded-sm" />
            <span className="truncate">{domain}</span>
          </div>
          <div className="mt-1 font-medium text-sm leading-snug line-clamp-3 hover:text-primary transition-colors">
            {l.title || l.url}
          </div>
          {l.summary && (
            <p className="mt-1.5 text-xs text-muted-foreground line-clamp-3">
              {l.summary}
            </p>
          )}
        </a>
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() =>
              setIdx((i) => {
                if (pool.length <= 1) return 0;
                let n = Math.floor(Math.random() * pool.length);
                if (n === i) n = (n + 1) % pool.length;
                return n;
              })
            }
            className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground hover:text-primary flex items-center gap-1"
          >
            <Shuffle className="h-3 w-3" /> Shuffle
          </button>
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono uppercase tracking-widest text-primary hover:underline flex items-center gap-1"
          >
            Open <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
