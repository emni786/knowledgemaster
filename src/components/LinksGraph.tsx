import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import type { LinkRow } from "@/lib/types";
import { getDomain } from "@/lib/url";

// react-force-graph-2d touches `window` at module scope — load only on the client.
const ForceGraph2D = lazy(() =>
  import("react-force-graph-2d").then((m) => ({ default: m.default })),
);

type GNode = {
  id: string;
  kind: "hub" | "sat";
  domain: string;
  label: string;
  url?: string;
  tags?: string[];
  val: number;
  hue: number;
};
type GLink = { source: string; target: string; kind: "spoke" | "tag"; hue: number };

function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function buildGraph(links: LinkRow[]): { nodes: GNode[]; links: GLink[] } {
  const active = links.filter((l) => !l.deleted_at && l.status === "ready").slice(0, 120);
  const byDomain = new Map<string, LinkRow[]>();
  for (const l of active) {
    const d = l.domain || getDomain(l.url) || "unknown";
    const arr = byDomain.get(d) ?? [];
    arr.push(l);
    byDomain.set(d, arr);
  }
  const domains = [...byDomain.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 14);

  const nodes: GNode[] = [];
  const gLinks: GLink[] = [];
  const sats: { id: string; tags: string[]; domain: string }[] = [];

  for (const [domain, items] of domains) {
    const hue = hashHue(domain);
    const hubId = `hub:${domain}`;
    nodes.push({
      id: hubId,
      kind: "hub",
      domain,
      label: domain,
      val: 6 + Math.min(items.length, 20) * 1.2,
      hue,
    });
    for (const l of items.slice(0, 12)) {
      const id = `sat:${l.id}`;
      nodes.push({
        id,
        kind: "sat",
        domain,
        label: l.title || l.url,
        url: l.url,
        tags: l.tags ?? [],
        val: 2,
        hue,
      });
      gLinks.push({ source: hubId, target: id, kind: "spoke", hue });
      sats.push({ id, tags: l.tags ?? [], domain });
    }
  }

  const seen = new Set<string>();
  outer: for (let i = 0; i < sats.length; i++) {
    for (let j = i + 1; j < sats.length; j++) {
      const a = sats[i], b = sats[j];
      if (a.domain === b.domain) continue;
      const shared = a.tags.find((t) => b.tags.includes(t));
      if (!shared) continue;
      const key = `${a.id}|${b.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      gLinks.push({ source: a.id, target: b.id, kind: "tag", hue: hashHue(shared) });
      if (gLinks.length > 400) break outer;
    }
  }

  return { nodes, links: gLinks };
}

export function LinksGraph({ links }: { links: LinkRow[] }) {
  const data = useMemo(() => buildGraph(links), [links]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<unknown>(null);
  const [size, setSize] = useState({ w: 720, h: 420 });
  const [hover, setHover] = useState<GNode | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setSize({ w: Math.max(320, cr.width), h: 420 });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fg = fgRef.current as { d3Force?: (n: string) => { strength: (v: number) => void } | undefined } | null;
    if (!fg?.d3Force) return;
    fg.d3Force("charge")?.strength(-90);
    fg.d3Force("link")?.strength(0.35 as unknown as number);
  }, [data]);

  if (data.nodes.length === 0) {
    return (
      <div
        data-card
        data-morph="paper"
        className="grid h-[420px] place-items-center rounded-2xl border border-dashed border-border/60 text-sm text-muted-foreground"
      >
        No links yet — save a few to light up your graph.
      </div>
    );
  }

  const hubs = data.nodes.filter((n) => n.kind === "hub").length;
  const sats = data.nodes.length - hubs;

  return (
    <div data-card data-morph="aurora" className="rounded-2xl border border-border/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Link constellation · {hubs} domains · {sats} links · live physics
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {hover ? (hover.kind === "hub" ? `★ ${hover.label}` : `→ ${hover.label.slice(0, 60)}`) : "drag · scroll · click"}
        </div>
      </div>
      <div ref={wrapRef} className="relative overflow-hidden rounded-xl bg-[radial-gradient(circle_at_50%_50%,hsl(var(--primary)/0.08),transparent_70%)]">
        <Suspense fallback={<div className="h-[420px] grid place-items-center text-xs text-muted-foreground">Loading graph…</div>}>
          <ForceGraph2D
            ref={fgRef as never}
            width={size.w}
            height={size.h}
            graphData={data as never}
            backgroundColor="rgba(0,0,0,0)"
            cooldownTicks={120}
            d3VelocityDecay={0.3}
            nodeRelSize={4}
            nodeVal={((n: unknown) => (n as GNode).val) as never}
            nodeLabel={((n: unknown) => (n as GNode).label) as never}
            linkColor={((l: unknown) => {
              const k = l as GLink;
              return k.kind === "spoke"
                ? `hsla(${k.hue},55%,55%,0.22)`
                : `hsla(${k.hue},70%,60%,0.45)`;
            }) as never}
            linkWidth={((l: unknown) => ((l as GLink).kind === "tag" ? 1.1 : 0.6)) as never}
            linkDirectionalParticles={((l: unknown) => ((l as GLink).kind === "tag" ? 2 : 0)) as never}
            linkDirectionalParticleSpeed={0.008}
            linkDirectionalParticleWidth={1.6}
            onNodeHover={(n) => setHover((n as GNode) ?? null)}
            onNodeClick={(n) => {
              const node = n as GNode;
              if (node.kind === "sat" && node.url) window.open(node.url, "_blank", "noopener,noreferrer");
            }}
            nodeCanvasObject={((nodeIn: unknown, ctx: CanvasRenderingContext2D, scale: number) => {
              const node = nodeIn as GNode & { x?: number; y?: number };
              const x = node.x ?? 0;
              const y = node.y ?? 0;
              const r = node.kind === "hub" ? Math.sqrt(node.val) * 2.6 : 3.2;
              // glow
              const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
              grad.addColorStop(0, `hsla(${node.hue},80%,60%,0.55)`);
              grad.addColorStop(1, `hsla(${node.hue},80%,60%,0)`);
              ctx.fillStyle = grad;
              ctx.beginPath();
              ctx.arc(x, y, r * 3, 0, Math.PI * 2);
              ctx.fill();
              // core
              ctx.fillStyle =
                node.kind === "hub"
                  ? `hsl(${node.hue},70%,48%)`
                  : `hsl(${node.hue},65%,58%)`;
              ctx.strokeStyle = node.kind === "hub" ? "rgba(255,255,255,0.85)" : `hsla(${node.hue},85%,75%,0.9)`;
              ctx.lineWidth = node.kind === "hub" ? 1.4 : 0.8;
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
              // hub label
              if (node.kind === "hub" && scale > 0.8) {
                const label = node.label.length > 18 ? node.label.slice(0, 16) + "…" : node.label;
                ctx.font = `${10 / Math.max(scale, 1) * scale}px "JetBrains Mono", monospace`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillStyle = "hsl(var(--foreground) / 0.85)";
                ctx.fillText(label, x, y + r + 3);
              }
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}
