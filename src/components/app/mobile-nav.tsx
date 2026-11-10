"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarRange, LayoutDashboard, ListOrdered, Menu, Timer } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

function currentTournamentId(pathname: string) {
  return /^\/tournaments\/([0-9a-f-]{36})/.exec(pathname)?.[1] ?? null;
}

/** Tournament name in the top bar on phones, where the sidebar is hidden. */
export function MobileTitle({ tournaments }: { tournaments: { id: string; name: string }[] }) {
  const pathname = usePathname();
  const id = currentTournamentId(pathname);
  const name = id ? tournaments.find((t) => t.id === id)?.name : null;
  return <div className="min-w-0 flex-1 truncate text-sm font-semibold md:hidden">{name ?? "Church Tournament Manager"}</div>;
}

/** Thumb-reachable navigation for match day on phones. */
export function MobileNav() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const id = currentTournamentId(pathname);
  if (!id) return null;
  const base = `/tournaments/${id}`;
  const items = [
    { href: base, label: "Home", icon: LayoutDashboard, active: pathname === base },
    { href: `${base}/matches`, label: "Matches", icon: Timer, active: pathname.startsWith(`${base}/matches`) },
    { href: `${base}/fixtures`, label: "Fixtures", icon: CalendarRange, active: pathname.startsWith(`${base}/fixtures`) },
    { href: `${base}/standings`, label: "Table", icon: ListOrdered, active: pathname.startsWith(`${base}/standings`) },
  ];
  return (
    <nav
      aria-label="Tournament"
      className="no-print fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
    >
      <div className="grid grid-cols-5">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", i.active ? "text-primary" : "text-muted-foreground")}
            aria-current={i.active ? "page" : undefined}
          >
            <i.icon className="size-5" />
            {i.label}
          </Link>
        ))}
        <button type="button" onClick={() => setOpenMobile(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground">
          <Menu className="size-5" />
          More
        </button>
      </div>
    </nav>
  );
}
