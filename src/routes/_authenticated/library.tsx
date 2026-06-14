import { useEffect, useMemo, useRef, useState, useCallback, memo, forwardRef } from "react";
import { useVirtualizer, useWindowVirtualizer } from "@tanstack/react-virtual";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Search, Pin, RefreshCw, Trash2, LogOut, Settings, Sparkles,
  LayoutGrid, List, Hash, CheckSquare, Activity, Compass, Network,
  BarChart3, Newspaper, Library as LibraryIcon, ChevronLeft, ChevronRight,
  X, ExternalLink, Star, RotateCcw, MoreHorizontal, Filter, FileText,
  Video, Github, BookOpen, Wrench, MessagesSquare, HelpCircle, Inbox,
  Upload, Download, Tag, Keyboard, AlertCircle, Loader2, Menu,
  Rows3, Columns3, Table as TableIcon, GalleryThumbnails, GalleryHorizontal, ChevronDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Wordmark, Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { PageTabs } from "@/components/PageTabs";
import { useLocalStorage } from "@/lib/local-storage";
import { faviconFor, getDomain, normalizeUrl } from "@/lib/url";
import {
  fetchLinks, addLinks, updateLink, softDeleteLink, softDeleteMany,
  togglePin, retryAnalysis, retryPendingAnalysis, restoreLink, permanentlyDelete, emptyTrash, bulkAddTag,
} from "@/lib/api/links";
import { fetchCollections, createCollection, deleteCollection } from "@/lib/api/collections";
import type { LinkRow, FilterState, ContentType, LinkStatus } from "@/lib/types";
import { DEFAULT_FILTERS } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({
    meta: [
      { title: "Library — Knowledgemaster" },
      { name: "description", content: "Browse, search, filter, and manage your AI-tagged link library. Bulk actions, collections, and smart organization for every saved link." },
      { property: "og:title", content: "Library — Knowledgemaster" },
    ],
    links: [{ rel: "canonical", href: "/library" }],
  }),
  component: LibraryPage,
});

const TYPE_ICON: Record<ContentType, typeof FileText> = {
  article: FileText, video: Video, repo: Github, docs: BookOpen,
  tool: Wrench, thread: MessagesSquare, other: LibraryIcon,
};

type LayoutMode = "list" | "compact" | "grid" | "thumbnails" | "masonry" | "table" | "cover";

const LAYOUTS: { id: LayoutMode; label: string; icon: typeof List; desc: string }[] = [
  { id: "list",       label: "List",        icon: List,              desc: "Detailed single-line rows" },
  { id: "compact",    label: "Compact",     icon: Rows3,             desc: "Dense title-only rows" },
  { id: "grid",       label: "Grid",        icon: LayoutGrid,        desc: "Uniform card grid" },
  { id: "thumbnails", label: "Thumbnails",  icon: GalleryThumbnails, desc: "Large preview cards" },
  { id: "masonry",    label: "Masonry",     icon: Columns3,          desc: "Pinterest-style columns" },
  { id: "table",      label: "Table",       icon: TableIcon,         desc: "Tabular columns" },
  { id: "cover",      label: "Cover flow",  icon: GalleryHorizontal, desc: "Horizontal carousel" },
];
const PRIMARY_LAYOUTS: LayoutMode[] = ["list", "grid", "masonry", "table"];

const isVirtualLayout = (v: LayoutMode) => v === "list" || v === "compact" || v === "grid" || v === "thumbnails";
const isMultiColLayout = (v: LayoutMode) => v === "grid" || v === "thumbnails";
const cycleLayout = (v: LayoutMode): LayoutMode => {
  const i = LAYOUTS.findIndex((l) => l.id === v);
  return LAYOUTS[(i + 1) % LAYOUTS.length].id;
};

const TYPE_DESCRIPTION: Record<ContentType, string> = {
  article: "Article — written post, blog, or news story",
  video: "Video — video content from YouTube, Vimeo, etc.",
  repo: "Repo — code repository on GitHub or similar",
  docs: "Docs — documentation, guide, or reference",
  tool: "Tool — app, service, or utility",
  thread: "Thread — discussion on Twitter, Reddit, HN, etc.",
  other: "Other — uncategorized link",
};

function TypeIcon({ type, className }: { type: ContentType; className?: string }) {
  const Icon = TYPE_ICON[type];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          onClick={(e) => e.stopPropagation()}
          className="inline-flex shrink-0"
          aria-label={TYPE_DESCRIPTION[type]}
        >
          <Icon className={className} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{TYPE_DESCRIPTION[type]}</TooltipContent>
    </Tooltip>
  );
}

const NAV = [
  { to: "/library", label: "Library", icon: LibraryIcon },
  { to: "/dashboard", label: "Dashboard", icon: Activity },
  { to: "/discover", label: "Discover", icon: Compass },
  
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/digest", label: "Digest", icon: Newspaper },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function LibraryPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const desktopScrollRef = useRef<HTMLDivElement | null>(null);
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [collapsed, setCollapsed] = useLocalStorage("xn:sidebar-collapsed", false);
  const [view, setView] = useLocalStorage<LayoutMode>("xn:view", "list");
  const [showNumbers, setShowNumbers] = useLocalStorage("xn:numbers", false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [smartOpen, setSmartOpen] = useState(false);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  type LibraryTab = "all" | "pinned" | "failed" | "trash";
  const tab: LibraryTab = filters.showDeleted
    ? "trash"
    : filters.status === "failed"
      ? "failed"
      : filters.pinnedOnly
        ? "pinned"
        : "all";
  const setTab = (t: LibraryTab) => {
    if (t === "trash") setFilters({ ...filters, showDeleted: true, pinnedOnly: false, status: "all", showDuplicates: false });
    else if (t === "pinned") setFilters({ ...filters, showDeleted: false, pinnedOnly: true, status: "all", showDuplicates: false });
    else if (t === "failed") setFilters({ ...filters, showDeleted: false, pinnedOnly: false, status: "failed", showDuplicates: false });
    else setFilters({ ...filters, showDeleted: false, pinnedOnly: false, status: "all", showDuplicates: false });
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const linksQuery = useQuery({ queryKey: ["links"], queryFn: fetchLinks, staleTime: 60_000, refetchOnWindowFocus: false });
  const collectionsQuery = useQuery({ queryKey: ["collections-list"], queryFn: fetchCollections, staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  const allLinks = linksQuery.data ?? [];

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("links-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "links" }, (payload) => {
        qc.invalidateQueries({ queryKey: ["links"] });
        if (payload.eventType === "INSERT") toast.success("New link added");
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  // Track status transitions (pending → ready / failed) for inline feedback
  const prevStatusRef = useRef<Map<string, LinkStatus>>(new Map());
  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = new Map<string, LinkStatus>();
    for (const l of allLinks) {
      next.set(l.id, l.status);
      const before = prev.get(l.id);
      if (before === "pending" && l.status === "ready") {
        toast.success(`Analyzed: ${l.title || l.domain || l.url}`);
      } else if (before === "pending" && l.status === "failed") {
        toast.error(`Analysis failed: ${l.domain || l.url}`);
      }
    }
    prevStatusRef.current = next;
  }, [allLinks]);

  const stats = useMemo(() => {
    const active = allLinks.filter((l) => !l.deleted_at);
    const seen = new Map<string, number>();
    active.forEach((l) => {
      const k = l.normalized_url ?? l.url;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    });
    const duplicates = Array.from(seen.values()).filter((n) => n > 1).length;
    const byType: Record<ContentType, number> = {
      article: 0, video: 0, repo: 0, docs: 0, tool: 0, thread: 0, other: 0,
    };
    active.forEach((l) => { byType[l.content_type] = (byType[l.content_type] ?? 0) + 1; });
    return {
      all: active.length,
      pending: active.filter((l) => l.status === "pending").length,
      ready: active.filter((l) => l.status === "ready").length,
      failed: active.filter((l) => l.status === "failed").length,
      duplicates,
      deleted: allLinks.filter((l) => l.deleted_at).length,
      byType,
    };
  }, [allLinks]);

  const visible = useMemo(() => {
    let list = allLinks.filter((l) => (filters.showDeleted ? !!l.deleted_at : !l.deleted_at));
    if (filters.contentType !== "all") list = list.filter((l) => l.content_type === filters.contentType);
    if (filters.status !== "all") list = list.filter((l) => l.status === filters.status);
    if (filters.pinnedOnly) list = list.filter((l) => l.pinned);
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      list = list.filter((l) =>
        (l.title ?? "").toLowerCase().includes(q) ||
        (l.summary ?? "").toLowerCase().includes(q) ||
        (l.url ?? "").toLowerCase().includes(q) ||
        (l.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    }
    if (filters.showDuplicates) {
      const seen = new Map<string, LinkRow[]>();
      list.forEach((l) => {
        const k = l.normalized_url ?? l.url;
        const arr = seen.get(k) ?? []; arr.push(l); seen.set(k, arr);
      });
      list = Array.from(seen.values()).filter((arr) => arr.length > 1).flat();
    }
    list.sort((a, b) => {
      switch (filters.sort) {
        case "oldest": return a.created_at.localeCompare(b.created_at);
        case "title-asc": return (a.title ?? "").localeCompare(b.title ?? "");
        case "title-desc": return (b.title ?? "").localeCompare(a.title ?? "");
        case "domain-asc": return (a.domain ?? "").localeCompare(b.domain ?? "");
        default: return b.created_at.localeCompare(a.created_at);
      }
    });
    // pinned first
    list.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    return list;
  }, [allLinks, filters, debouncedQuery]);

  const groups = useMemo(() => ({
    ready: visible.filter((l) => l.status === "ready"),
    pending: visible.filter((l) => l.status === "pending"),
    failed: visible.filter((l) => l.status === "failed"),
  }), [visible]);

  const selectedLink = useMemo(() => allLinks.find((l) => l.id === selected) ?? null, [allLinks, selected]);

  // Mutations
  const addMut = useMutation({
    mutationFn: addLinks,
    onSuccess: (rows) => {
      qc.invalidateQueries({ queryKey: ["links"] });
      const n = Array.isArray(rows) ? rows.length : 1;
      toast.success(n > 1 ? `Added ${n} links` : "Link saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: softDeleteLink,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["links"] }); setSelected(null); toast.success("Moved to trash"); },
  });
  const pinMut = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => togglePin(id, pinned),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["links"] }),
  });
  const retryMut = useMutation({
    mutationFn: retryAnalysis,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["links"] });
      toast.success("Analysis restarted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingIds = useMemo(() => allLinks.filter((l) => !l.deleted_at && l.status === "pending").map((l) => l.id), [allLinks]);

  const retryPendingMut = useMutation({
    mutationFn: () => retryPendingAnalysis(pendingIds),
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["links"] });
      toast.success(`Re-analyzing ${count} pending link${count === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleAdd = useCallback((raw: string) => {
    const urls = Array.from(new Set(
      raw.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s))
    ));
    if (!urls.length) return toast.error("Enter one or more valid URLs");
    const existing = new Set(
      allLinks.flatMap((l) => [l.normalized_url, l.url].filter(Boolean) as string[])
    );
    const seen = new Set<string>();
    const fresh: string[] = [];
    const dupes: string[] = [];
    for (const u of urls) {
      const key = normalizeUrl(u);
      if (existing.has(key) || existing.has(u) || seen.has(key)) {
        dupes.push(u);
      } else {
        seen.add(key);
        fresh.push(u);
      }
    }
    if (dupes.length) {
      toast.message(`Skipped ${dupes.length} duplicate${dupes.length === 1 ? "" : "s"}`, {
        description: dupes.slice(0, 3).map((d) => getDomain(d) || d).join(", ") + (dupes.length > 3 ? "…" : ""),
      });
    }
    if (!fresh.length) return;
    addMut.mutate(fresh);
  }, [allLinks, addMut]);

  const handleExport = useCallback((format: "json" | "csv" | "txt") => {
    const rows = visible;
    if (!rows.length) return toast.error("Nothing to export");
    let blob: Blob;
    let filename: string;
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
      filename = `knowledgemaster-${stamp}.json`;
    } else if (format === "csv") {
      const esc = (v: unknown) => {
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ["url", "title", "domain", "content_type", "status", "tags", "pinned", "summary", "created_at"];
      const lines = [header.join(",")];
      for (const l of rows) {
        lines.push([
          l.url, l.title ?? "", l.domain ?? "", l.content_type, l.status,
          (l.tags ?? []).join("|"), l.pinned, l.summary ?? "", l.created_at,
        ].map(esc).join(","));
      }
      blob = new Blob([lines.join("\n")], { type: "text/csv" });
      filename = `knowledgemaster-${stamp}.csv`;
    } else {
      blob = new Blob([rows.map((l) => l.url).join("\n")], { type: "text/plain" });
      filename = `knowledgemaster-${stamp}.txt`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} links as ${format.toUpperCase()}`);
  }, [visible]);


  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const handleSelectLink = (id: string) => {
    setSelected(id);
    if (window.innerWidth < 1024) setMobileDetailOpen(true);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "?") { e.preventDefault(); setShortcutsOpen(true); }
      else if (e.key === "g") { e.preventDefault(); setView(cycleLayout(view)); }
      else if (e.key === "Escape") { setSelected(null); setMobileDetailOpen(false); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = visible.findIndex((l) => l.id === selected);
        const next = e.key === "ArrowDown" ? Math.min(visible.length - 1, idx + 1) : Math.max(0, idx - 1);
        if (visible[next]) setSelected(visible[next].id);
      } else if (e.key === "Enter" && selected && selectedLink) {
        window.open(selectedLink.url, "_blank");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selected, selectedLink, view, setView]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const openSmart = useCallback(() => setSmartOpen(true), []);
  const openImport = useCallback(() => setImportOpen(true), []);
  const openFilters = useCallback(() => setFiltersOpen(true), []);
  const refreshLinks = useCallback(() => { linksQuery.refetch(); }, [linksQuery]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="lib-morph min-h-screen bg-background text-foreground">
        {/* Mobile header */}
        <MobileHeader
          email={user?.email}
          onAdd={handleAdd}
          onSignOut={handleSignOut}
        />

        <div className={`hidden lg:grid ${collapsed ? "lg:grid-cols-[64px_1fr]" : "lg:grid-cols-[280px_1fr]"} min-h-screen transition-[grid-template-columns] duration-300 ease-in-out motion-reduce:transition-none`}>
          {/* Left sidebar */}
          <aside className="border-r border-border/50 bg-sidebar text-sidebar-foreground flex flex-col h-screen sticky top-0">
            <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} p-3 border-b border-border/50 min-h-[57px]`}>
              {!collapsed && <Wordmark collapsed={false} />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCollapsed(!collapsed)}>
                    {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{collapsed ? "Expand" : "Collapse"}</TooltipContent>
              </Tooltip>
            </div>
            {!collapsed && user?.email && (
              <div className="px-4 py-2 text-[11px] font-mono text-muted-foreground truncate border-b border-border/50">
                {user.email}
              </div>
            )}
            <nav className="px-2 py-3 space-y-0.5">
              {NAV.map((item) => {
                const link = (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex items-center ${collapsed ? "justify-center px-0" : "gap-3 px-3"} rounded-xl py-2 text-sm hover:bg-primary/10 hover:text-primary transition-colors font-medium`}
                    activeProps={{ className: "bg-primary/10 text-primary" }}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
                return collapsed ? (
                  <Tooltip key={item.to}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : link;
              })}
            </nav>

            {!collapsed && (
              <div className="px-4 py-3 border-t border-border/50 grid grid-cols-3 gap-1.5">
                <MiniPill label="All" value={stats.all} />
                <MiniPill label="Pin" value={allLinks.filter((l) => !l.deleted_at && l.pinned).length} />
                <MiniPill label="Fail" value={stats.failed} destructive={stats.failed > 0} />
              </div>
            )}

            {!collapsed && (
              <CollectionsBlock
                collections={collectionsQuery.data ?? []}
                activeId={filters.collectionId}
                onSelect={(id) => setFilters({ ...filters, collectionId: id })}
              />
            )}

            <div className={`mt-auto p-3 border-t border-border/50 ${collapsed ? "flex flex-col items-center gap-1" : "flex items-center gap-1"}`}>
              <ThemeToggle />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-primary/10 hover:text-primary" onClick={() => setShortcutsOpen(true)}>
                    <Keyboard className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Shortcuts (?)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link to="/settings">
                    <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-primary/10 hover:text-primary">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">Settings</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className={`h-9 w-9 hover:bg-destructive/10 hover:text-destructive ${collapsed ? "" : "ml-auto"}`} onClick={handleSignOut}>
                    <LogOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign out</TooltipContent>
              </Tooltip>
            </div>
          </aside>

          {/* Center */}
          <main className="flex flex-col min-h-screen">
            <CenterToolbar
              ref={searchRef}
              query={searchInput}
              onQueryChange={setSearchInput}
              view={view}
              setView={setView}
              showNumbers={showNumbers}
              setShowNumbers={setShowNumbers}
              selectMode={selectMode}
              setSelectMode={setSelectMode}
              onAdd={handleAdd}
              addPending={addMut.isPending}
              onSmartSearch={openSmart}
              onImport={openImport}
              onExport={handleExport}
              onRefresh={refreshLinks}
              onOpenFilters={openFilters}
              pendingCount={pendingIds.length}
              onRetryPending={() => retryPendingMut.mutate()}
              retryPendingPending={retryPendingMut.isPending}
            />

            <div className="sticky top-[120px] z-10 bg-background/80 backdrop-blur border-b border-border/50 px-6">
              <PageTabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: "all", label: "All", icon: Inbox, badge: stats.all },
                  { id: "pinned", label: "Pinned", icon: Pin, badge: allLinks.filter((l) => !l.deleted_at && l.pinned).length },
                  { id: "failed", label: "Failed", icon: AlertCircle, badge: stats.failed },
                  { id: "trash", label: "Trash", icon: Trash2, badge: stats.deleted },
                ]}
              />
            </div>
            {selectMode && selectedIds.size > 0 && (
              <div className="sticky top-[120px] z-20 px-6 py-2 bg-primary/10 border-b border-primary/20 flex items-center gap-2 animate-fade-in">
                <span className="font-mono text-xs">{selectedIds.size} selected</span>
                <Button size="sm" variant="ghost" className="h-7 font-mono text-xs" onClick={() => setBulkTagOpen(true)}>
                  <Tag className="h-3 w-3 mr-1" />Add tag
                </Button>
                <Button size="sm" variant="ghost" className="h-7 font-mono text-xs text-destructive" onClick={async () => {
                  await softDeleteMany(Array.from(selectedIds));
                  qc.invalidateQueries({ queryKey: ["links"] });
                  setSelectedIds(new Set());
                  setSelectMode(false);
                  toast.success("Deleted");
                }}>
                  <Trash2 className="h-3 w-3 mr-1" />Delete
                </Button>
                <Button size="sm" variant="ghost" className="h-7 font-mono text-xs ml-auto" onClick={() => { setSelectedIds(new Set()); setSelectMode(false); }}>
                  Cancel
                </Button>
              </div>
            )}

            <div ref={desktopScrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
              {linksQuery.isLoading ? (
                <SkeletonList view={view} />
              ) : visible.length === 0 ? (
                <EmptyState />
              ) : isVirtualLayout(view) ? (
                <VirtualLinkList
                  scrollParentRef={desktopScrollRef}
                  groups={groups}
                  view={view}
                  showNumbers={showNumbers}
                  selectMode={selectMode}
                  selectedIds={selectedIds}
                  toggleSelected={toggleSelected}
                  selected={selected}
                  onSelect={handleSelectLink}
                  onPin={(id, p) => pinMut.mutate({ id, pinned: !p })}
                  onRetry={(id) => retryMut.mutate(id)}
                />
              ) : (
                <NonVirtualLinkList
                  links={visible}
                  view={view}
                  showNumbers={showNumbers}
                  selectMode={selectMode}
                  selectedIds={selectedIds}
                  toggleSelected={toggleSelected}
                  selected={selected}
                  onSelect={handleSelectLink}
                  onPin={(id, p) => pinMut.mutate({ id, pinned: !p })}
                  onRetry={(id) => retryMut.mutate(id)}
                />
              )}
            </div>
          </main>

        </div>

        {/* Mobile body */}
        <div className="lg:hidden">
          <div className="px-4 py-3 space-y-3">
            <AddLinkInput onAdd={handleAdd} loading={addMut.isPending} />
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search links... (press /)"
                  className="h-9 pl-9 font-mono text-sm"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => linksQuery.refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <StatCard label="All" value={stats.all} />
              <StatCard label="Ready" value={stats.ready} tone="primary" />
              <StatCard label="Pending" value={stats.pending} tone="muted" />
            </div>
            {pendingIds.length > 0 && (
              <Button variant="outline" size="sm" className="w-full h-9 font-mono text-xs gap-1.5" onClick={() => retryPendingMut.mutate()} disabled={retryPendingMut.isPending}>
                {retryPendingMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Analyze {pendingIds.length} pending
              </Button>
            )}
            {linksQuery.isLoading ? <SkeletonList /> : visible.length === 0 ? <EmptyState /> : (
            <VirtualFlatList
                links={visible}
                selected={selected}
                onSelect={handleSelectLink}
                onPin={(id, p) => pinMut.mutate({ id, pinned: !p })}
                onRetry={(id: string) => retryMut.mutate(id)}
              />
            )}
          </div>
          <Sheet open={mobileDetailOpen} onOpenChange={setMobileDetailOpen}>
            <SheetContent side="right" className="w-full sm:max-w-md p-0">
              {selectedLink && (
                <DetailPanel
                  link={selectedLink}
                  onClose={() => setMobileDetailOpen(false)}
                  onDelete={(id) => { deleteMut.mutate(id); setMobileDetailOpen(false); }}
                  onPin={(id, p) => pinMut.mutate({ id, pinned: !p })}
                  onRetry={(id) => retryAnalysis(id).then(() => qc.invalidateQueries({ queryKey: ["links"] }))}
                  onUpdate={async (id, patch) => { await updateLink(id, patch); qc.invalidateQueries({ queryKey: ["links"] }); }}
                  allLinks={allLinks}
                />
              )}
            </SheetContent>
          </Sheet>
        </div>

        <RecycleBinDialog open={recycleOpen} onOpenChange={setRecycleOpen} links={allLinks.filter((l) => l.deleted_at)} onRefresh={() => qc.invalidateQueries({ queryKey: ["links"] })} />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImport={handleAdd} />
        <SmartSearchDialog open={smartOpen} onOpenChange={setSmartOpen} links={allLinks} onPick={(id) => { setSelected(id); setSmartOpen(false); }} />
        <BulkTagDialog open={bulkTagOpen} onOpenChange={setBulkTagOpen} onApply={async (tag) => {
          await bulkAddTag(Array.from(selectedIds), tag);
          qc.invalidateQueries({ queryKey: ["links"] });
          setBulkTagOpen(false); setSelectMode(false); setSelectedIds(new Set());
          toast.success(`Added "${tag}" to ${selectedIds.size} links`);
        }} />
      </div>
    </TooltipProvider>
  );
}

function MobileNav({ onClose }: { onClose: () => void }) {
  return (
    <nav className="px-2 py-3 space-y-0.5">
      {NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={onClose}
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-primary/10 hover:text-primary transition-colors font-medium text-muted-foreground"
          activeProps={{ className: "bg-primary/10 text-primary" }}
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function MobileHeader({ email, onAdd, onSignOut }: { email?: string; onAdd: (raw: string) => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="lg:hidden glass sticky top-0 z-30 border-b border-border/50 px-3 sm:px-4 py-2.5 flex items-center gap-1.5 sm:gap-2">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 -ml-1 shrink-0">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64">
          <div className="p-4 border-b border-border/50"><Wordmark collapsed={false} /></div>
          <MobileNav onClose={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <Logo />
      <div className="flex flex-col leading-tight min-w-0 flex-1">
        <span className="font-mono text-sm font-semibold truncate">Knowledgemaster</span>
        {email && <span className="hidden sm:block text-[10px] text-muted-foreground truncate">{email}</span>}
      </div>
      <ThemeToggle />
      <Link to="/settings" className="hidden xs:inline-flex"><Button variant="ghost" size="icon" className="h-9 w-9 shrink-0"><Settings className="h-4 w-4" /></Button></Link>
      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive" onClick={onSignOut}><LogOut className="h-4 w-4" /></Button>
    </header>
  );
}

type CenterToolbarProps = {
  query: string;
  onQueryChange: (v: string) => void;
  view: LayoutMode;
  setView: (v: LayoutMode) => void;
  showNumbers: boolean;
  setShowNumbers: (v: boolean) => void;
  selectMode: boolean;
  setSelectMode: (v: boolean) => void;
  onAdd: (raw: string) => void;
  addPending: boolean;
  onSmartSearch: () => void;
  onImport: () => void;
  onExport: (format: "json" | "csv" | "txt") => void;
  onRefresh: () => void;
  onOpenFilters: () => void;
  pendingCount: number;
  onRetryPending: () => void;
  retryPendingPending: boolean;
};



const CenterToolbar = memo(forwardRef<HTMLInputElement, CenterToolbarProps>(function CenterToolbar(
  {
    query, onQueryChange, view, setView, showNumbers, setShowNumbers,
    selectMode, setSelectMode, onAdd, addPending, onSmartSearch, onImport, onExport, onRefresh, onOpenFilters,
    pendingCount, onRetryPending, retryPendingPending,
  },
  ref,
) {
  return (
    <div data-toolbar className="glass sticky top-0 z-20 border-b border-border/50 px-6 py-3 space-y-3">
      <AddLinkInput onAdd={onAdd} loading={addPending} />
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={ref}
            placeholder="Search links... (press /)"
            className="h-9 pl-9 font-mono text-sm bg-background/60"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <div className="flex items-center rounded-xl border border-border/50 bg-background/40 p-0.5">
            {LAYOUTS.filter((l) => PRIMARY_LAYOUTS.includes(l.id)).map((l) => {
              const Icon = l.icon;
              return (
                <Tooltip key={l.id}>
                  <TooltipTrigger asChild>
                    <Button
                      variant={view === l.id ? "secondary" : "ghost"}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setView(l.id)}
                      aria-label={l.label}
                      aria-pressed={view === l.id}
                    >
                      <Icon className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{l.label} — {l.desc}</TooltipContent>
                </Tooltip>
              );
            })}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More layouts">
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>All layouts (g cycles)</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-56">
                {LAYOUTS.map((l) => {
                  const Icon = l.icon;
                  return (
                    <DropdownMenuItem
                      key={l.id}
                      onClick={() => setView(l.id)}
                      className={view === l.id ? "bg-accent/60" : ""}
                    >
                      <Icon className="h-4 w-4 mr-2 text-primary/80" />
                      <div className="flex flex-col">
                        <span className="font-medium">{l.label}</span>
                        <span className="text-[10px] text-muted-foreground">{l.desc}</span>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={showNumbers ? "secondary" : "ghost"} size="icon" className="h-9 w-9" onClick={() => setShowNumbers(!showNumbers)}>
                <Hash className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle numbers</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={selectMode ? "secondary" : "ghost"} size="icon" className="h-9 w-9" onClick={() => setSelectMode(!selectMode)}>
                <CheckSquare className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Select mode</TooltipContent>
          </Tooltip>
          <div className="w-px h-5 bg-border mx-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-primary/10 hover:text-primary" onClick={onSmartSearch}>
                <Sparkles className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Smart search</TooltipContent>
          </Tooltip>
          <Link to="/discover">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-primary/10 hover:text-primary">
                  <Compass className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Discover</TooltipContent>
            </Tooltip>
          </Link>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-primary/10 hover:text-primary" onClick={() => toast.success("All links healthy")}>
                <Activity className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Link health</TooltipContent>
          </Tooltip>
          {pendingCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 font-mono text-xs gap-1.5" onClick={onRetryPending} disabled={retryPendingPending}>
                  {retryPendingPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Analyze {pendingCount}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Re-analyze all pending links</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-primary/10 hover:text-primary" onClick={onRefresh}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-primary/10 hover:text-primary" onClick={onImport}>
                <Upload className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-primary/10 hover:text-primary">
                    <Download className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Export</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="font-mono text-xs">
              <DropdownMenuItem onClick={() => onExport("json")}>Export as JSON</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("csv")}>Export as CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("txt")}>Export as TXT (URLs)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-primary/10 hover:text-primary" onClick={onOpenFilters}>
                <Filter className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Filters</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}));

function AddLinkInput({ onAdd, loading }: { onAdd: (raw: string) => void; loading: boolean }) {
  const [val, setVal] = useState("");
  const detected = useMemo(
    () => Array.from(new Set(val.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s)))),
    [val]
  );
  const isMulti = val.includes("\n") || detected.length > 1;
  const submit = () => { if (val.trim()) { onAdd(val); setVal(""); } };
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="flex items-start gap-2 rounded-2xl border border-border/50 bg-card px-3 py-1.5 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition"
    >
      <Plus className="h-4 w-4 text-primary shrink-0 mt-1.5" />
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/\n|,/.test(text) || (text.match(/https?:\/\//g)?.length ?? 0) > 1) {
            e.preventDefault();
            setVal((prev) => (prev ? prev + "\n" : "") + text);
          }
        }}
        rows={isMulti ? Math.min(6, Math.max(2, val.split("\n").length)) : 1}
        placeholder="Paste one URL or many (newlines or commas). Enter to add, Shift+Enter for newline."
        className="flex-1 bg-transparent outline-none font-mono text-sm placeholder:text-muted-foreground/60 resize-none py-1 leading-5"
      />
      <div className="flex items-center gap-2 mt-0.5">
        {detected.length > 1 && (
          <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">{detected.length} URLs</span>
        )}
        <Button type="submit" size="sm" className="h-7 font-mono text-[11px]" disabled={loading || !detected.length}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : detected.length > 1 ? `Add ${detected.length}` : "Add"}
        </Button>
      </div>
    </form>
  );
}

function StatCard({
  label, value, tone, active, onClick,
}: { label: string; value: number; tone?: "primary" | "muted" | "destructive"; active?: boolean; onClick?: () => void }) {
  const toneClass =
    tone === "primary" ? "text-primary" :
    tone === "destructive" ? "text-destructive" :
    tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border border-border/50 bg-card px-2.5 py-2 text-left transition hover:border-primary/40 hover:bg-primary/5 ${active ? "border-primary/40 bg-primary/5" : ""}`}
    >
      <div className={`font-mono text-[10px] uppercase tracking-widest text-muted-foreground`}>{label}</div>
      <div className={`font-mono text-base font-semibold ${toneClass}`}>{value}</div>
    </button>
  );
}

function CollectionsBlock({
  collections, activeId, onSelect,
}: { collections: { id: string; name: string }[]; activeId: string | null; onSelect: (id: string | null) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const list = collections;
  return (
    <div className="px-4 py-3 border-t border-border/50">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Collections</div>
      <div className="space-y-0.5 max-h-40 overflow-auto scrollbar-thin">
        <button
          onClick={() => onSelect(null)}
          className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-mono hover:bg-primary/10 hover:text-primary ${activeId === null ? "bg-primary/10 text-primary" : ""}`}
        >
          # All links
        </button>
        {list.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-mono hover:bg-primary/10 hover:text-primary truncate ${activeId === c.id ? "bg-primary/10 text-primary" : ""}`}
          >
            # {c.name}
          </button>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await createCollection(name.trim());
          setName("");
          qc.invalidateQueries({ queryKey: ["collections-list"] });
          toast.success("Collection created");
        }}
        className="mt-2 flex gap-1"
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection" className="h-7 text-xs font-mono" />
        <Button type="submit" size="icon" variant="ghost" className="h-7 w-7"><Plus className="h-3 w-3" /></Button>
      </form>
    </div>
  );
}

function Section({ title, count, icon: Icon, iconClass, children }: { title: string; count: number; icon: typeof FileText; iconClass?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="animate-fade-in">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 mb-2 group">
        <Icon className={`h-3.5 w-3.5 text-primary ${iconClass ?? ""}`} />
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground group-hover:text-primary">{title}</span>
        <span className="font-mono text-[11px] text-muted-foreground/70">({count})</span>
      </button>
      {open && children}
    </section>
  );
}

type Groups = { ready: LinkRow[]; pending: LinkRow[]; failed: LinkRow[] };

function useGridColCount(view: LayoutMode) {
  const compute = useCallback(() => {
    if (!isMultiColLayout(view)) return 1;
    if (typeof window === "undefined") return 3;
    const w = window.innerWidth;
    if (view === "thumbnails") {
      return w >= 1536 ? 3 : w >= 900 ? 2 : 1;
    }
    return w >= 1280 ? 3 : w >= 768 ? 2 : 1;
  }, [view]);
  const [cols, setCols] = useState(compute);
  useEffect(() => {
    const update = () => setCols(compute());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [compute]);
  return cols;
}

type VRow =
  | { kind: "header"; key: string; title: string; count: number; section: "ready" | "pending" | "failed" }
  | { kind: "row"; key: string; items: LinkRow[]; offset: number };
function NonVirtualLinkList({
  links, view, showNumbers, selectMode, selectedIds, toggleSelected, selected, onSelect, onPin, onRetry,
}: {
  links: LinkRow[]; view: LayoutMode; showNumbers: boolean;
  selectMode: boolean; selectedIds: Set<string>; toggleSelected: (id: string) => void;
  selected: string | null; onSelect: (id: string) => void;
  onPin: (id: string, p: boolean) => void; onRetry: (id: string) => void;
}) {
  const card = (l: LinkRow, i: number) => (
    <LinkCard
      key={l.id}
      link={l}
      index={i + 1}
      view={view}
      showNumbers={showNumbers}
      selected={selected === l.id}
      onSelect={() => onSelect(l.id)}
      onPin={(p) => onPin(l.id, p)}
      onRetry={() => onRetry(l.id)}
      selectMode={selectMode}
      isChecked={selectedIds.has(l.id)}
      onCheck={() => toggleSelected(l.id)}
    />
  );

  if (view === "masonry") {
    return (
      <div className="columns-1 md:columns-2 xl:columns-3 gap-4 [column-fill:_balance]">
        {links.map((l, i) => card(l, i))}
      </div>
    );
  }
  if (view === "table") {
    return (
      <div className="space-y-1.5">
        <div className="grid grid-cols-[auto_minmax(0,2.4fr)_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-3 h-8 font-mono text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/50">
          <span></span>
          <span>Title</span>
          <span>Domain</span>
          <span>Type</span>
          <span className="hidden md:block">Status</span>
          <span className="hidden lg:block">Saved</span>
        </div>
        {links.map((l, i) => card(l, i))}
      </div>
    );
  }
  if (view === "cover") {
    return (
      <div className="overflow-x-auto scrollbar-thin pb-4 -mx-6 px-6 snap-x snap-mandatory">
        <div className="flex gap-4">
          {links.map((l, i) => (
            <div key={l.id} className="snap-start">
              {card(l, i)}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return <div className="space-y-2">{links.map((l, i) => card(l, i))}</div>;
}

function VirtualLinkList({
  scrollParentRef, groups, view, showNumbers, selectMode, selectedIds, toggleSelected, selected, onSelect, onPin, onRetry,
}: {
  scrollParentRef: React.RefObject<HTMLDivElement | null>;
  groups: Groups;
  view: LayoutMode;
  showNumbers: boolean;
  selectMode: boolean;
  selectedIds: Set<string>;
  toggleSelected: (id: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  onPin: (id: string, p: boolean) => void;
  onRetry: (id: string) => void;
}) {
  const cols = useGridColCount(view);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem("library:collapsedSections");
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("library:collapsedSections", JSON.stringify(collapsed));
    } catch {
      // ignore quota/serialization errors
    }
  }, [collapsed]);
  const toggleSection = useCallback((s: string) => setCollapsed((c) => ({ ...c, [s]: !c[s] })), []);

  const vrows = useMemo<VRow[]>(() => {
    const rows: VRow[] = [];
    let offset = 0;
    const sections: Array<{ key: "ready" | "pending" | "failed"; title: string; links: LinkRow[] }> = [
      { key: "ready", title: "Ready", links: groups.ready },
      { key: "pending", title: "Pending", links: groups.pending },
      { key: "failed", title: "Failed", links: groups.failed },
    ];
    for (const s of sections) {
      if (!s.links.length) continue;
      rows.push({ kind: "header", key: `h:${s.key}`, title: s.title, count: s.links.length, section: s.key });
      if (!collapsed[s.key]) {
        for (let i = 0; i < s.links.length; i += cols) {
          const chunk = s.links.slice(i, i + cols);
          rows.push({ kind: "row", key: `r:${s.key}:${i}:${chunk.map((l) => l.id).join(",")}`, items: chunk, offset: offset + i });
        }
      }
      offset += s.links.length;
    }
    return rows;
  }, [groups, cols, collapsed]);

  // Stable refs so estimateSize/getItemKey identity never changes — prevents
  // the virtualizer from invalidating cached measurements on every render.
  const vrowsRef = useRef(vrows);
  vrowsRef.current = vrows;
  const viewRef = useRef(view);
  viewRef.current = view;

  const ROW_HEIGHTS: Record<LayoutMode, number> = {
    list: 80, compact: 52, grid: 208, thumbnails: 312,
    masonry: 80, table: 56, cover: 240,
  };
  const HEADER_HEIGHT = 40;

  const estimateSize = useCallback((i: number) => {
    const r = vrowsRef.current[i];
    if (!r) return ROW_HEIGHTS[viewRef.current];
    if (r.kind === "header") return HEADER_HEIGHT;
    return ROW_HEIGHTS[viewRef.current];
  }, []);

  const getItemKey = useCallback((i: number) => vrowsRef.current[i].key, []);

  const virtualizer = useVirtualizer({
    count: vrows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize,
    overscan: 6,
    getItemKey,
  });

  // Keep the selected link in view, even when its row is unmounted by the
  // virtualizer (selection change, filter change, view toggle).
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (!selected) { wasVisibleRef.current = false; return; }
    const idx = vrows.findIndex((r) => r.kind === "row" && r.items.some((l) => l.id === selected));
    if (idx < 0) { wasVisibleRef.current = false; return; }
    const reappeared = !wasVisibleRef.current;
    wasVisibleRef.current = true;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      virtualizer.scrollToIndex(idx, {
        align: reappeared ? "center" : "auto",
        behavior: reduced ? "auto" : "smooth",
      });
    }, 80);
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [selected, vrows, virtualizer]);

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
      {virtualizer.getVirtualItems().map((vi) => {
        const row = vrows[vi.index];
        return (
          <div
            key={row.key}
            data-index={vi.index}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vi.size, transform: `translateY(${vi.start}px)` }}
          >
            {row.kind === "header" ? (
              <div className={vi.index === 0 ? "pb-2" : "pt-4 pb-2"}>
                <button onClick={() => toggleSection(row.section)} className="flex items-center gap-2 group">
                  {row.section === "ready" && <Sparkles className="h-3.5 w-3.5 text-primary" />}
                  {row.section === "pending" && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />}
                  {row.section === "failed" && <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
                  <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground group-hover:text-primary">{row.title}</span>
                  <span className="font-mono text-[11px] text-muted-foreground/70">({row.count})</span>
                </button>
              </div>
            ) : (
              <div
                className={isMultiColLayout(view) ? "grid gap-4 pb-4" : "pb-2"}
                style={isMultiColLayout(view) ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
              >
                {row.items.map((l, ix) => (
                  <LinkCard
                    key={l.id}
                    link={l}
                    index={row.offset + ix + 1}
                    view={view}
                    showNumbers={showNumbers}
                    selected={selected === l.id}
                    onSelect={() => onSelect(l.id)}
                    onPin={(p) => onPin(l.id, p)}
                    onRetry={() => onRetry(l.id)}
                    selectMode={selectMode}
                    isChecked={selectedIds.has(l.id)}
                    onCheck={() => toggleSelected(l.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VirtualFlatList({
  links, selected, onSelect, onPin, onRetry,
}: {
  links: LinkRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onPin: (id: string, p: boolean) => void;
  onRetry: (id: string) => void;
}) {
  const linksRef = useRef(links);
  linksRef.current = links;
  const estimateSize = useCallback(() => 80, []);
  const getItemKey = useCallback((i: number) => linksRef.current[i].id, []);
  const virtualizer = useWindowVirtualizer({
    count: links.length,
    estimateSize,
    overscan: 6,
    getItemKey,
  });

  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (!selected) { wasVisibleRef.current = false; return; }
    const idx = links.findIndex((l) => l.id === selected);
    if (idx < 0) { wasVisibleRef.current = false; return; }
    const reappeared = !wasVisibleRef.current;
    wasVisibleRef.current = true;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      virtualizer.scrollToIndex(idx, {
        align: reappeared ? "center" : "auto",
        behavior: reduced ? "auto" : "smooth",
      });
    }, 80);
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [selected, links, virtualizer]);
  return (
    <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
      {virtualizer.getVirtualItems().map((vi) => {
        const l = links[vi.index];
        return (
          <div
            key={l.id}
            data-index={vi.index}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vi.size, transform: `translateY(${vi.start}px)`, paddingBottom: 8 }}
          >
            <LinkCard
              link={l}
              index={vi.index}
              view="list"
              showNumbers={false}
              selected={selected === l.id}
              onSelect={() => onSelect(l.id)}
              onPin={(p) => onPin(l.id, p)}
              onRetry={() => {}}
              selectMode={false}
              isChecked={false}
              onCheck={() => {}}
            />
          </div>
        );
      })}
    </div>
  );
}

function LinkGrid({
  links, view, showNumbers, numberOffset, selectMode, selectedIds, toggleSelected, selected, onSelect, onPin, onRetry,
}: {
  links: LinkRow[]; view: LayoutMode; showNumbers: boolean; numberOffset: number;
  selectMode: boolean; selectedIds: Set<string>; toggleSelected: (id: string) => void;
  selected: string | null; onSelect: (id: string) => void; onPin: (id: string, p: boolean) => void;
  onRetry: (id: string) => void;
}) {
  return (
    <div className={view === "grid" ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" : "space-y-2"}>
      {links.map((l, i) => (
        <LinkCard
          key={l.id}
          link={l}
          index={numberOffset + i + 1}
          view={view}
          showNumbers={showNumbers}
          selected={selected === l.id}
              onSelect={() => onSelect(l.id)}
              onPin={(p) => onPin(l.id, p)}
              onRetry={() => {}}
              selectMode={selectMode}
              isChecked={selectedIds.has(l.id)}
              onCheck={() => toggleSelected(l.id)}
            />
      ))}
    </div>
  );
}

type LinkCardProps = {
  link: LinkRow; index: number; view: LayoutMode; showNumbers: boolean;
  selected: boolean; onSelect: () => void; onPin: (p: boolean) => void;
  onRetry: () => void;
  selectMode: boolean; isChecked: boolean; onCheck: () => void;
};

const MORPHS = ["glass", "neu", "clay", "skeu", "aurora", "holo", "paper", "metal"] as const;
function hashStr(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function deriveMorph(id: string, index: number) {
  const h = hashStr(id || String(index));
  // index*3 offset guarantees adjacent items with similar hashes still diverge
  const style = MORPHS[(h + index * 3) % MORPHS.length];
  // Lightness step 0..4 → mapped to a narrow dark-grey band in CSS (no hue, no chroma)
  const shade = (h >> 5) % 5;
  return { style, shade };
}

const LinkCard = memo(function LinkCard({
  link, index, view, showNumbers, selected, onSelect, onPin, onRetry, selectMode, isChecked, onCheck,
}: LinkCardProps) {
  const morph = useMemo(() => deriveMorph(link.id, index), [link.id, index]);
  const morphStyle = {
    ["--card-shade" as string]: String(morph.shade),
  } as React.CSSProperties;
  const Icon = TYPE_ICON[link.content_type];
  const domain = link.domain || getDomain(link.url);
  const ago = link.created_at ? formatDistanceToNow(new Date(link.created_at), { addSuffix: true }) : "";
  const ref = useRef<HTMLElement | null>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (selected && ref.current) {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setFlash(false);
      const raf = requestAnimationFrame(() => setFlash(true));
      const t = setTimeout(() => setFlash(false), 950);
      return () => { cancelAnimationFrame(raf); clearTimeout(t); };
    }
  }, [selected]);
  const flashClass = flash ? "xn-flash" : "";

  // Compact row — single dense line, title only
  if (view === "compact") {
    return (
      <div
        ref={ref as React.RefObject<HTMLDivElement>}
        data-link-row
        data-morph={morph.style}
        style={morphStyle}
        onClick={selectMode ? onCheck : onSelect}
        role="button"
        tabIndex={0}
        aria-selected={selected}
        data-selected={selected ? "true" : undefined}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (selectMode ? onCheck : onSelect)(); } }}
        className={`group relative overflow-hidden flex items-center gap-2.5 border px-3 h-11 cursor-pointer transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${selected ? "ring-2 ring-primary/40" : "border-border/50"} ${flashClass}`}
      >
        {selectMode && <Checkbox checked={isChecked} />}
        {showNumbers && <span className="font-mono text-[10px] text-muted-foreground w-6 text-right shrink-0">{index}.</span>}
        <img src={faviconFor(link.url)} alt="" className="h-4 w-4 rounded shrink-0" loading="lazy" />
        <a
          href={link.url} target="_blank" rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-sm truncate hover:underline flex-1 min-w-0"
        >{link.title || link.url}</a>
        {link.pinned && <Pin className="h-3 w-3 text-primary fill-primary shrink-0" />}
        <span className="font-mono text-[10px] text-muted-foreground/60 hidden sm:block shrink-0">{domain}</span>
        <TypeIcon type={link.content_type} className="h-3.5 w-3.5 text-primary/70 shrink-0" />
      </div>
    );
  }

  // Table row — semantic columns
  if (view === "table") {
    return (
      <div
        ref={ref as React.RefObject<HTMLDivElement>}
        data-link-row
        data-morph={morph.style}
        style={morphStyle}
        onClick={selectMode ? onCheck : onSelect}
        role="button"
        tabIndex={0}
        aria-selected={selected}
        data-selected={selected ? "true" : undefined}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (selectMode ? onCheck : onSelect)(); } }}
        className={`group relative overflow-hidden grid grid-cols-[auto_minmax(0,2.4fr)_minmax(0,1fr)_auto_auto_auto] items-center gap-3 border px-3 h-12 cursor-pointer transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${selected ? "ring-2 ring-primary/40" : "border-border/50"} ${flashClass}`}
      >
        <img src={faviconFor(link.url)} alt="" className="h-4 w-4 rounded shrink-0" loading="lazy" />
        <a
          href={link.url} target="_blank" rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-sm truncate hover:underline"
        >{link.title || link.url}</a>
        <span className="font-mono text-[11px] text-muted-foreground truncate">{domain}</span>
        <TypeIcon type={link.content_type} className="h-3.5 w-3.5 text-primary/70" />
        <span className="font-mono text-[10px] text-muted-foreground/70 hidden md:block">{link.status}</span>
        <span className="font-mono text-[10px] text-muted-foreground/60 hidden lg:block">{ago}</span>
      </div>
    );
  }

  // Thumbnails — big preview card
  if (view === "thumbnails") {
    return (
      <button
        ref={ref as React.RefObject<HTMLButtonElement>}
        data-link-card
        data-morph={morph.style}
        style={morphStyle}
        onClick={selectMode ? onCheck : onSelect}
        aria-pressed={selected}
        data-selected={selected ? "true" : undefined}
        className={`group relative overflow-hidden text-left border h-[296px] flex flex-col transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${selected ? "ring-2 ring-primary/40 -translate-y-0.5" : "border-border/50"} ${flashClass}`}
      >
        <div className="relative h-[150px] w-full overflow-hidden bg-gradient-to-br from-muted/40 to-muted/10 flex items-center justify-center">
          <img src={faviconFor(link.url)} alt="" className="h-14 w-14 rounded-2xl opacity-90 shadow-lg" loading="lazy" />
          <TypeIcon type={link.content_type} className="absolute top-2 right-2 h-4 w-4 text-primary/70" />
        </div>
        <div className="flex-1 p-4 flex flex-col gap-1.5 min-h-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted-foreground truncate">{domain}</span>
            {link.pinned && <Pin className="h-3 w-3 text-primary fill-primary" />}
          </div>
          <a
            href={link.url} target="_blank" rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-sm leading-tight hover:underline line-clamp-2"
          >{link.title || link.url}</a>
          {link.summary && <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{link.summary}</p>}
          <span className="font-mono text-[10px] text-muted-foreground/60 mt-auto">{ago}</span>
        </div>
      </button>
    );
  }

  // Cover flow — wide horizontal card (used inside a carousel)
  if (view === "cover") {
    return (
      <button
        ref={ref as React.RefObject<HTMLButtonElement>}
        data-link-card
        data-morph={morph.style}
        style={morphStyle}
        onClick={selectMode ? onCheck : onSelect}
        aria-pressed={selected}
        data-selected={selected ? "true" : undefined}
        className={`group relative overflow-hidden text-left border w-[260px] h-[220px] shrink-0 flex flex-col transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${selected ? "ring-2 ring-primary/40 -translate-y-1 scale-[1.02]" : "border-border/50"} ${flashClass}`}
      >
        <div className="relative h-[110px] w-full overflow-hidden bg-gradient-to-br from-muted/40 to-muted/10 flex items-center justify-center">
          <img src={faviconFor(link.url)} alt="" className="h-12 w-12 rounded-xl opacity-90" loading="lazy" />
        </div>
        <div className="flex-1 p-3 flex flex-col gap-1 min-h-0">
          <span className="font-mono text-[10px] text-muted-foreground truncate">{domain}</span>
          <span className="font-semibold text-sm leading-tight line-clamp-2">{link.title || link.url}</span>
        </div>
      </button>
    );
  }

  // Grid / masonry — card layout
  if (view === "grid" || view === "masonry") {
    return (
      <button
        ref={ref as React.RefObject<HTMLButtonElement>}
        data-link-card
        data-morph={morph.style}
        style={morphStyle}
        onClick={selectMode ? onCheck : onSelect}
        aria-pressed={selected}
        data-selected={selected ? "true" : undefined}
        className={`group relative overflow-hidden text-left border p-4 ${view === "masonry" ? "block w-full break-inside-avoid mb-4" : "h-[196px]"} transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${selected ? "ring-2 ring-primary/40 -translate-y-0.5" : "border-border/50"} ${flashClass}`}
      >
        <div className="flex items-start gap-2.5">
          {selectMode && <Checkbox checked={isChecked} className="mt-0.5" />}
          <img src={faviconFor(link.url)} alt="" className="h-5 w-5 rounded mt-0.5 shrink-0" loading="lazy" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {showNumbers && <span className="font-mono text-[10px] text-muted-foreground">{index}.</span>}
              <span className="font-mono text-[10px] text-muted-foreground truncate">{domain}</span>
              {link.pinned && <Pin className="h-3 w-3 text-primary fill-primary" />}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium text-sm truncate block mt-1 hover:underline leading-tight"
                >{link.title || link.url}</a>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <div className="text-xs break-all">{link.url}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{domain}</div>
              </TooltipContent>
            </Tooltip>
          </div>
          <TypeIcon type={link.content_type} className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
        </div>
        {link.summary && <p className={`text-xs text-muted-foreground mt-2 leading-relaxed ${view === "masonry" ? "" : "line-clamp-2"}`}>{link.summary}</p>}
        <div className="flex items-center gap-1.5 mt-3 pt-1 flex-wrap">
          {link.status === "pending" ? (
            <button
              onClick={(e) => { e.stopPropagation(); onRetry(); }}
              className="font-mono text-[10px] text-primary inline-flex items-center gap-1 hover:underline"
            >
              <RefreshCw className="h-3 w-3" /> Analyze
            </button>
          ) : link.status === "failed" ? (
            <span className="font-mono text-[10px] text-destructive inline-flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> Analysis failed
            </span>
          ) : (
            link.tags.slice(0, 4).map((t) => (
              <span key={t} data-tag className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-accent/60 text-accent-foreground">{t}</span>
            ))
          )}
          <span className="font-mono text-[10px] text-muted-foreground/60 ml-auto">{ago}</span>
        </div>
        {link.status === "pending" && <AnalysisProgressBar />}
      </button>
    );
  }

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-link-row
      data-morph={morph.style}
      style={morphStyle}
      onClick={selectMode ? onCheck : onSelect}
      role="button"
      tabIndex={0}
      aria-selected={selected}
      data-selected={selected ? "true" : undefined}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (selectMode ? onCheck : onSelect)(); } }}
      className={`group relative overflow-hidden flex items-center gap-3 border px-3.5 h-[72px] cursor-pointer transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${selected ? "ring-2 ring-primary/40 pl-4 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r-full before:bg-primary" : "border-border/50"} ${flashClass}`}
    >
      {selectMode && <Checkbox checked={isChecked} />}
      {showNumbers && <span className="font-mono text-[10px] text-muted-foreground w-6 text-right shrink-0">{index}.</span>}
      <img src={faviconFor(link.url)} alt="" className="h-5 w-5 rounded shrink-0" loading="lazy" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-sm truncate hover:underline leading-snug"
              >{link.title || link.url}</a>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <div className="text-xs break-all">{link.url}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{domain}</div>
            </TooltipContent>
          </Tooltip>
          {link.pinned && <Pin className="h-3 w-3 text-primary fill-primary shrink-0" />}
          {link.status === "pending" && <Loader2 className="h-3 w-3 text-muted-foreground animate-spin shrink-0" />}
          {link.status === "failed" && <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
        </div>
        <div className="flex items-center gap-2 mt-0.5 overflow-hidden">
          <span className="font-mono text-[10px] text-muted-foreground truncate shrink-0 max-w-[40%]">{domain}</span>
          {link.status === "pending" ? (
            <span className="font-mono text-[10px] text-muted-foreground shrink-0">Analyzing…</span>
          ) : link.status === "failed" ? (
            <span className="font-mono text-[10px] text-destructive shrink-0">Analysis failed</span>
          ) : (
            <div className="hidden sm:flex items-center gap-2 min-w-0 overflow-hidden">
              {link.tags.slice(0, 3).map((t) => (
                <span key={t} data-tag className="font-mono text-[10px] text-primary/70 truncate max-w-[110px] shrink-0">{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      <TypeIcon type={link.content_type} className="h-4 w-4 text-primary/70 shrink-0" />
      {link.status === "pending" && (
        <button
          onClick={(e) => { e.stopPropagation(); onRetry(); }}
          className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-primary shrink-0"
          title="Analyze"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onPin(link.pinned); }}
        className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-primary shrink-0"
      >
        <Pin className={`h-3.5 w-3.5 ${link.pinned ? "fill-primary text-primary" : ""}`} />
      </button>
      <span className="font-mono text-[10px] text-muted-foreground/60 hidden md:block shrink-0">{ago}</span>
      {link.status === "pending" && <AnalysisProgressBar />}
    </div>
  );
});

function AnalysisProgressBar() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden bg-primary/10"
    >
      <span className="block h-full w-1/3 rounded-full bg-primary animate-[xn-progress_1.4s_ease-in-out_infinite]" />
    </span>
  );
}

function DetailPanel({
  link, onClose, onDelete, onPin, onRetry, onUpdate, allLinks,
}: {
  link: LinkRow; onClose: () => void;
  onDelete: (id: string) => void; onPin: (id: string, p: boolean) => void;
  onRetry: (id: string) => void; onUpdate: (id: string, patch: Partial<LinkRow>) => Promise<void>;
  allLinks: LinkRow[];
}) {
  const Icon = TYPE_ICON[link.content_type];
  const [tagInput, setTagInput] = useState("");
  const similar = useMemo(() =>
    allLinks
      .filter((l) => l.id !== link.id && !l.deleted_at && (l.domain === link.domain || l.tags.some((t) => link.tags.includes(t))))
      .slice(0, 5),
    [allLinks, link]);

  const addTag = async () => {
    const t = tagInput.trim();
    if (!t) return;
    await onUpdate(link.id, { tags: Array.from(new Set([...link.tags, t])) } as Partial<LinkRow>);
    setTagInput("");
  };
  const removeTag = async (t: string) => {
    await onUpdate(link.id, { tags: link.tags.filter((x) => x !== t) } as Partial<LinkRow>);
  };

  return (
    <div className="animate-slide-in-right p-5 space-y-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Link Detail</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      <div>
        <div className="flex items-start gap-3">
          <img src={faviconFor(link.url)} alt="" className="h-8 w-8 rounded" />
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-base leading-tight">{link.title || link.url}</h2>
            <a href={link.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-primary hover:underline break-all flex items-center gap-1 mt-1">
              {link.domain || link.url} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Pill icon={Icon} label={link.content_type} />
        <Pill label={link.status} tone={link.status === "ready" ? "primary" : link.status === "failed" ? "destructive" : "muted"} />
        {link.pinned && <Pill icon={Pin} label="pinned" tone="primary" />}
      </div>

      {link.summary && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Summary</div>
          <p className="text-sm leading-relaxed text-foreground/90">{link.summary}</p>
        </div>
      )}

      <div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Tags</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {link.tags.map((t) => (
            <button key={t} onClick={() => removeTag(t)} className="group font-mono text-xs px-2 py-0.5 rounded-md bg-accent text-accent-foreground hover:bg-destructive/20 hover:text-destructive">
              #{t} <span className="opacity-0 group-hover:opacity-100">×</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())} placeholder="Add tag" className="h-7 text-xs font-mono" />
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={addTag}><Plus className="h-3 w-3" /></Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-8 font-mono text-xs" onClick={() => onPin(link.id, link.pinned)}>
          <Star className={`h-3.5 w-3.5 mr-1.5 ${link.pinned ? "fill-primary text-primary" : ""}`} />
          {link.pinned ? "Unpin" : "Pin"}
        </Button>
        {link.status !== "ready" && (
          <Button size="sm" variant="outline" className="h-8 font-mono text-xs" onClick={() => onRetry(link.id)}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />Retry
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-8 font-mono text-xs text-destructive hover:bg-destructive/10" onClick={() => onDelete(link.id)}>
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
        </Button>
      </div>

      <div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Saved</div>
        <div className="font-mono text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(link.created_at), { addSuffix: true })}
        </div>
      </div>

      {similar.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Similar</div>
          <div className="space-y-1.5">
            {similar.map((s) => (
              <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="block rounded-xl border border-border/50 px-2.5 py-1.5 hover:border-primary/40 hover:bg-accent/30 transition">
                <div className="text-xs font-medium truncate">{s.title || s.url}</div>
                <div className="font-mono text-[10px] text-muted-foreground truncate">{s.domain}</div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ icon: Icon, label, tone }: { icon?: typeof FileText; label: string; tone?: "primary" | "muted" | "destructive" }) {
  const cls = tone === "primary" ? "bg-primary/10 text-primary" :
              tone === "destructive" ? "bg-destructive/10 text-destructive" :
              tone === "muted" ? "bg-muted text-muted-foreground" : "bg-accent text-accent-foreground";
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md ${cls}`}>
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24">
      <div className="opacity-20 animate-float">
        <Logo size={96} />
      </div>
      <h3 className="mt-6 font-mono text-base font-semibold">No links yet</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-md">
        Add a link above or paste links in your Telegram channel and they'll appear here automatically.
      </p>
    </div>
  );
}

function SkeletonList({ view = "list" }: { view?: LayoutMode }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(0);
  const [cols, setCols] = useState(1);

  useEffect(() => {
    const update = () => {
      const h = wrapRef.current?.clientHeight || window.innerHeight || 800;
      const w = window.innerWidth;
      const nextCols = view === "grid" ? (w >= 1280 ? 3 : w >= 768 ? 2 : 1) : 1;
      const rowH = view === "grid" ? 188 : 56; // grid card + gap, list row + gap
      const rows = Math.ceil(h / rowH) + 1; // tiny overscan
      setCols(nextCols);
      setCount(rows * nextCols);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [view]);

  const itemClass = view === "grid" ? "h-[176px] rounded-2xl shimmer" : "h-12 rounded-2xl shimmer";
  const containerClass = view === "grid" ? "grid gap-3" : "space-y-2";
  const containerStyle =
    view === "grid" ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined;

  return (
    <div ref={wrapRef} className="h-full">
      <div className={containerClass} style={containerStyle}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={itemClass} />
        ))}
      </div>
    </div>
  );
}

function RecycleBinDialog({ open, onOpenChange, links, onRefresh }: { open: boolean; onOpenChange: (v: boolean) => void; links: LinkRow[]; onRefresh: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">Recycle bin</DialogTitle>
          <DialogDescription>Restore links or delete them permanently.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto space-y-1.5 scrollbar-thin">
          {links.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">Trash is empty.</p>}
          {links.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-xl border border-border/50 px-2 py-1.5">
              <img src={faviconFor(l.url)} alt="" className="h-4 w-4 rounded" />
              <div className="flex-1 min-w-0">
                <div className="text-xs truncate">{l.title || l.url}</div>
                <div className="font-mono text-[10px] text-muted-foreground truncate">{l.domain}</div>
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => { await restoreLink(l.id); onRefresh(); }}>Restore</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={async () => { await permanentlyDelete(l.id); onRefresh(); }}>Delete</Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={async () => { await emptyTrash(); onRefresh(); toast.success("Trash emptied"); onOpenChange(false); }} disabled={!links.length}>
            Empty trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const items = [
    ["/", "Focus search"], ["?", "This dialog"], ["g", "Toggle list/grid"],
    ["↑ ↓", "Navigate links"], ["Enter", "Open selected link"], ["Esc", "Close detail"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-mono">Keyboard shortcuts</DialogTitle></DialogHeader>
        <div className="space-y-1.5">
          {items.map(([k, l]) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{l}</span>
              <kbd className="font-mono text-[11px] px-2 py-0.5 rounded-md border border-border bg-muted">{k}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ open, onOpenChange, onImport }: { open: boolean; onOpenChange: (v: boolean) => void; onImport: (raw: string) => void }) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const extractUrls = (raw: string): string[] => {
    const matches = raw.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
    return Array.from(new Set(matches));
  };

  const handleFile = async (file: File) => {
    const content = await file.text();
    let urls: string[] = [];
    const name = file.name.toLowerCase();
    if (name.endsWith(".json")) {
      try {
        const parsed = JSON.parse(content);
        const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.links) ? parsed.links : [];
        urls = arr
          .map((x: unknown) => (typeof x === "string" ? x : (x as { url?: string })?.url ?? ""))
          .filter((s: string) => /^https?:\/\//.test(s));
      } catch {
        urls = extractUrls(content);
      }
    } else {
      // txt, csv, html bookmarks — extract any URL pattern
      urls = extractUrls(content);
    }
    if (!urls.length) return toast.error("No URLs found in file");
    setText((prev) => (prev ? prev + "\n" : "") + urls.join("\n"));
    toast.success(`Loaded ${urls.length} URLs from ${file.name}`);
  };

  const count = useMemo(() => extractUrls(text).length, [text]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono">Import links</DialogTitle>
          <DialogDescription>Paste URLs or upload a file (.txt, .csv, .json, .html bookmarks).</DialogDescription>
        </DialogHeader>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.csv,.json,.html,.htm,text/plain,text/csv,application/json,text/html"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
        <Button variant="outline" size="sm" className="font-mono text-xs w-fit" onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5 mr-2" />Choose file
        </Button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://example.com/article&#10;https://github.com/user/repo"
          className="w-full h-40 rounded-xl border border-border bg-background p-3 font-mono text-xs"
        />
        <DialogFooter className="items-center sm:justify-between">
          <span className="font-mono text-[11px] text-muted-foreground">{count} URL{count === 1 ? "" : "s"} detected</span>
          <Button
            disabled={!count}
            onClick={() => { onImport(text); setText(""); onOpenChange(false); }}
          >
            Import {count > 0 && `(${count})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SmartSearchDialog({ open, onOpenChange, links, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; links: LinkRow[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    if (!q.trim()) return links.slice(0, 8);
    const t = q.toLowerCase();
    return links.filter((l) =>
      (l.title ?? "").toLowerCase().includes(t) ||
      (l.summary ?? "").toLowerCase().includes(t) ||
      l.tags.some((x) => x.toLowerCase().includes(t))
    ).slice(0, 12);
  }, [links, q]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-mono flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Smart search</DialogTitle></DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything across your library..." className="font-mono text-sm" autoFocus />
        <div className="space-y-1 max-h-80 overflow-auto scrollbar-thin">
          {results.map((l) => (
            <button key={l.id} onClick={() => onPick(l.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-accent text-left">
              <img src={faviconFor(l.url)} alt="" className="h-4 w-4 rounded" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{l.title || l.url}</div>
                <div className="font-mono text-[10px] text-muted-foreground truncate">{l.domain}</div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BulkTagDialog({ open, onOpenChange, onApply }: { open: boolean; onOpenChange: (v: boolean) => void; onApply: (tag: string) => void }) {
  const [tag, setTag] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-mono">Add tag to selected</DialogTitle></DialogHeader>
        <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="tag-name" className="font-mono text-sm" autoFocus />
        <DialogFooter><Button onClick={() => onApply(tag)} disabled={!tag.trim()}>Apply</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MiniPill({ label, value, destructive }: { label: string; value: number; destructive?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-md border border-border/50 px-1.5 py-1 ${destructive ? "bg-destructive/10 text-destructive" : "bg-muted/30"}`}>
      <span className="font-mono text-sm leading-none">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</span>
    </div>
  );
}
