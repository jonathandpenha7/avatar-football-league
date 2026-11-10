import { cn } from "@/lib/utils";

export interface TeamLike {
  id?: string;
  name: string;
  colour?: string | null;
  logo_url?: string | null;
}

export function TeamMark({ team, size = "sm" }: { team: TeamLike | null | undefined; size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? "size-12 text-base" : size === "md" ? "size-8 text-xs" : "size-5 text-[10px]";
  if (team?.logo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={team.logo_url} alt="" className={cn("shrink-0 rounded-full object-cover ring-1 ring-border", dim)} />;
  }
  const initials = (team?.name ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-1 ring-black/5", dim)}
      style={{ backgroundColor: team?.colour ?? "#64748b" }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function TeamName({
  team,
  fallback = "TBD",
  className,
  size = "sm",
}: {
  team: TeamLike | null | undefined;
  fallback?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <TeamMark team={team ?? { name: fallback }} size={size} />
      <span className={cn("truncate", !team && "text-muted-foreground italic")}>{team?.name ?? fallback}</span>
    </span>
  );
}
