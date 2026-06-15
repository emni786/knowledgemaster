import logoAsset from "@/assets/logo.png.asset.json";

export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={logoAsset.url}
      alt="Knowledgemaster"
      className={`rounded-2xl object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function Wordmark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Logo />
      {!collapsed && (
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-sm font-semibold tracking-tight">Knowledgemaster</span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">link librarian</span>
        </div>
      )}
    </div>
  );
}
