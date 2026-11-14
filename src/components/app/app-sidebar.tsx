"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Award,
  BarChart3,
  Check,
  ChevronsUpDown,
  ClipboardList,
  FileDown,
  Gavel,
  History,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Network,
  Plus,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Trophy,
  UserCog,
  UserPlus,
  Users,
  CalendarRange,
  BookOpen,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/actions/auth";
import { ROLE_LABELS, type MemberRole } from "@/lib/permissions";
import type { Profile } from "@/lib/types";
import { LinkPending } from "./link-pending";
import type { TournamentFormat } from "@/lib/engine/types";

export interface SidebarTournament {
  id: string;
  name: string;
  status: string;
  format: TournamentFormat;
  role: MemberRole | null;
  archived_at: string | null;
}

type NavItem = { href: string; label: string; icon: typeof Trophy; adminOnly?: boolean; knockoutOnly?: boolean };

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Match day",
    items: [
      { href: "", label: "Dashboard", icon: LayoutDashboard },
      { href: "/matches", label: "Match centre", icon: Timer },
      { href: "/fixtures", label: "Fixtures and schedule", icon: CalendarRange },
      { href: "/standings", label: "Standings", icon: ListOrdered },
      { href: "/review", label: "League review", icon: ClipboardList, knockoutOnly: true },
      { href: "/knockout", label: "Knockout", icon: Network, knockoutOnly: true },
      { href: "/awards", label: "Awards and results", icon: Award },
    ],
  },
  {
    label: "Participants",
    items: [
      { href: "/teams", label: "Teams and players", icon: Users },
      { href: "/registrations", label: "Registrations", icon: UserPlus, adminOnly: true },
      { href: "/officials", label: "Organisers and officials", icon: UserCog, adminOnly: true },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/discipline", label: "Discipline", icon: ShieldAlert },
      { href: "/stats", label: "Statistics", icon: BarChart3 },
      { href: "/reports", label: "Reports and exports", icon: FileDown },
      { href: "/rules", label: "Rules and decisions", icon: BookOpen },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
      { href: "/audit", label: "Audit log", icon: History, adminOnly: true },
    ],
  },
];

export function AppSidebar({ tournaments, profile }: { tournaments: SidebarTournament[]; profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const match = /^\/tournaments\/([0-9a-f-]{36})/.exec(pathname);
  const current = match ? tournaments.find((t) => t.id === match[1]) : undefined;
  const isAdmin = profile.is_super_admin || current?.role === "tournament_admin";
  const base = current ? `/tournaments/${current.id}` : null;
  const active = tournaments.filter((t) => !t.archived_at);
  const archived = tournaments.filter((t) => t.archived_at);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <Trophy className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{current?.name ?? "Select a tournament"}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {current ? (current.role ? ROLE_LABELS[current.role] : "Super Admin") : `${tournaments.length} tournament${tournaments.length === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-64" align="start">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Current tournaments</DropdownMenuLabel>
                {active.length === 0 ? <DropdownMenuItem disabled>No active tournaments</DropdownMenuItem> : null}
                {active.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => router.push(`/tournaments/${t.id}`)}>
                    <span className="truncate">{t.name}</span>
                    {t.id === current?.id ? <Check className="ml-auto" /> : null}
                  </DropdownMenuItem>
                ))}
                {archived.length ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Previous tournaments</DropdownMenuLabel>
                    {archived.slice(0, 8).map((t) => (
                      <DropdownMenuItem key={t.id} onSelect={() => router.push(`/tournaments/${t.id}`)}>
                        <span className="truncate text-muted-foreground">{t.name}</span>
                        {t.id === current?.id ? <Check className="ml-auto" /> : null}
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => router.push("/tournaments")}>
                  <ClipboardList /> All tournaments
                </DropdownMenuItem>
                {profile.is_super_admin || profile.can_create_tournaments ? (
                  <DropdownMenuItem onSelect={() => router.push("/tournaments/new")}>
                    <Plus /> Create tournament
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {base && current ? (
          NAV.map((section) => {
            const items = section.items.filter(
              (i) => (!i.adminOnly || isAdmin) && (!i.knockoutOnly || current.format !== "round_robin"),
            );
            if (!items.length) return null;
            return (
              <SidebarGroup key={section.label}>
                <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map((item) => {
                      const href = `${base}${item.href}`;
                      const isActive = item.href === "" ? pathname === base : pathname.startsWith(href);
                      return (
                        <SidebarMenuItem key={item.label}>
                          <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                            <Link href={href} onClick={() => setOpenMobile(false)}>
                              <item.icon />
                              <span>{item.label}</span>
                              <LinkPending className="ml-auto" />
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })
        ) : (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/tournaments"} tooltip="Tournaments">
                    <Link href="/tournaments" onClick={() => setOpenMobile(false)}>
                      <Trophy />
                      <span>Tournaments</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {profile.is_super_admin ? (
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname.startsWith("/admin")} tooltip="Users">
                    <Link href="/admin/users" onClick={() => setOpenMobile(false)}>
                      <ShieldCheck />
                      <span>Users and permissions</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {(profile.full_name ?? profile.email).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{profile.full_name ?? "Your account"}</span>
                    <span className="truncate text-xs text-muted-foreground">{profile.email}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="min-w-56">
                {profile.is_super_admin ? (
                  <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Gavel className="size-3.5" /> Super Admin
                  </DropdownMenuLabel>
                ) : null}
                <DropdownMenuItem onSelect={() => router.push("/account")}>
                  <UserCog /> Account
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => signOut()}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
