import { useMemo } from "react";
import type { LinkRow } from "@/lib/types";
import { getDomain } from "@/lib/url";

/**
 * LinksGraph — lightweight SVG constellation of saved links.
 *  - Each domain becomes a "hub" (larger node) arranged on an outer ring.
 *  - Each link in that domain becomes a satellite around its hub.
 *  - Links that share at least one tag get a faint connecting edge.
 * Pure SVG, deterministic layout, no external graph library.
 */
export function LinksGraph({ links }: { links: LinkRow[] }) {
  const { nodes, edges, width, height } = useMemo(() => buildGraph(links), [links]);

  if (nodes.length === 0) {
    return (
      <div data-card data-morph="paper" className="grid h-[360px] place-items-center rounded-2xl border border-dashed border-border/60 text-sm text-muted-foreground">
        No links yet — save a few to light up your graph.
      </div>
    );
  }

  return (
    <div data-card data-morph="aurora" className="rounded-2xl border border-border/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Link constellation · {nodes.filter((n) => n.kind === "hub").length} domains · {nodes.filter((n) => n.kind === "sat").length} links
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">edges = shared tags</div>
      </div>
      <div className="overflow-hidden rounded-xl">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height="420"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Graph of saved links connected by shared tags"
        >
          <defs>
            <radialGradient id="lg-bg" cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor="hsl(var(--primary) / 0.10)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <filter id="lg-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect x={0} y={0} width={width} height={height} fill="url(#lg-bg)" />

          {/* edges */}
          {edges.map((e, i) => (
            <line
              key={i}
              x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
              stroke={`hsl(${e.hue}, 65%, 55%)`}
              strokeOpacity={0.22}
              strokeWidth={0.8}
            />
          ))}

          {/* hub spokes */}
          {nodes.filter((n) => n.kind === "sat").map((n) => {
            const hub = nodes.find((h) => h.kind === "hub" && h.domain === n.domain)!;
            return (
              <line
                key={`spoke-${n.id}`}
                x1={hub.x} y1={hub.y} x2={n.x} y2={n.y}
                stroke={`hsl(${n.hue}, 55%, 50%)`}
                strokeOpacity={0.18}
                strokeWidth={0.6}
              />
            );
          })}

          {/* satellite nodes */}
          {nodes.filter((n) => n.kind === "sat").map((n) => (
            <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer">
              <circle
                cx={n.x} cy={n.y} r={n.r}
                fill={`hsl(${n.hue}, 65%, 55%)`}
                fillOpacity={0.85}
                stroke={`hsl(${n.hue}, 80%, 70%)`}
                strokeWidth={0.6}
                filter="url(#lg-glow)"
              >
                <title>{n.title || n.url}</title>
              </circle>
            </a>
          ))}

          {/* hub nodes */}
          {nodes.filter((n) => n.kind === "hub").map((n) => (
            <g key={n.id}>
              <circle
                cx={n.x} cy={n.y} r={n.r}
                fill={`hsl(${n.hue}, 70%, 45%)`}
                stroke="hsl(var(--background))"
                strokeWidth={1.5}
                filter="url(#lg-glow)"
              />
              <text
                x={n.x} y={n.y + n.r + 12}
                textAnchor="middle"
                fontSize={10}
                fontFamily="JetBrains Mono, monospace"
                fill="hsl(var(--foreground))"
                opacity={0.75}
              >
                {n.domain.length > 18 ? n.domain.slice(0, 16) + "…" : n.domain}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

/* ---------------- layout ---------------- */

type Node =
  | { id: string; kind: "hub"; domain: string; x: number; y: number; r: number; hue: number }
  | { id: string; kind: "sat"; domain: string; url: string; title: string; tags: string[]; x: number; y: number; r: number; hue: number };

type Edge = { x1: number; y1: number; x2: number; y2: number; hue: number };

function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function buildGraph(links: LinkRow[]) {
  const width = 720;
  const height = 420;
  const cx = width / 2;
  const cy = height / 2;

  const active = links.filter((l) => !l.deleted_at && l.status === "ready").slice(0, 80);

  // group by domain
  const byDomain = new Map<string, LinkRow[]>();
  for (const l of active) {
    const d = l.domain || getDomain(l.url) || "unknown";
    const arr = byDomain.get(d) ?? [];
    arr.push(l);
    byDomain.set(d, arr);
  }

  // top N domains by count
  const domains = [...byDomain.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);

  const hubRadius = Math.min(width, height) * 0.32;
  const nodes: Node[] = [];

  domains.forEach(([domain, items], di) => {
    const angle = (di / domains.length) * Math.PI * 2 - Math.PI / 2;
    const hx = cx + Math.cos(angle) * hubRadius;
    const hy = cy + Math.sin(angle) * hubRadius;
    const hue = hashHue(domain);
    const hubR = 6 + Math.min(items.length, 12) * 0.8;
    const hubId = `hub-${domain}`;
    nodes.push({ id: hubId, kind: "hub", domain, x: hx, y: hy, r: hubR, hue });

    const satCount = Math.min(items.length, 9);
    const satRing = 28 + Math.min(items.length, 10) * 2;
    items.slice(0, satCount).forEach((l, si) => {
      const sa = (si / satCount) * Math.PI * 2 + di;
      const sx = hx + Math.cos(sa) * satRing;
      const sy = hy + Math.sin(sa) * satRing;
      nodes.push({
        id: `sat-${l.id}`,
        kind: "sat",
        domain,
        url: l.url,
        title: l.title || l.url,
        tags: l.tags ?? [],
        x: sx,
        y: sy,
        r: 3.2,
        hue,
      });
    });
  });

  // edges between satellites that share a tag (across different domains)
  const sats = nodes.filter((n): n is Extract<Node, { kind: "sat" }> => n.kind === "sat");
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < sats.length; i++) {
    for (let j = i + 1; j < sats.length; j++) {
      const a = sats[i]; const b = sats[j];
      if (a.domain === b.domain) continue;
      const shared = a.tags.find((t) => b.tags.includes(t));
      if (!shared) continue;
      const key = `${a.id}|${b.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, hue: hashHue(shared) });
      if (edges.length > 120) break;
    }
    if (edges.length > 120) break;
  }

  return { nodes, edges, width, height };
}
