import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/app/app-sidebar";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { MobileNav, MobileTitle } from "@/components/app/mobile-nav";
import { PerfReporter } from "@/components/app/perf-reporter";
import { getMyTournaments, requireSession } from "@/lib/data/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [{ profile }, tournaments, cookieStore] = await Promise.all([requireSession(), getMyTournaments(), cookies()]);
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar profile={profile} tournaments={tournaments} />
      <SidebarInset className="min-w-0">
        <header className="no-print sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <MobileTitle tournaments={tournaments.map((t) => ({ id: t.id, name: t.name }))} />
          <div className="hidden flex-1 md:block" />
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 px-4 pt-5 pb-24 sm:px-6 md:pt-6 md:pb-6 lg:px-8">{children}</main>
        <MobileNav />
        <PerfReporter />
      </SidebarInset>
    </SidebarProvider>
  );
}
