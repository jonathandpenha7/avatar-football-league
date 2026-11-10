import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Plus, Sparkles, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { TournamentStatusBadge } from "@/components/app/status-badge";
import { getMyTournaments, requireSession } from "@/lib/data/session";
import { FORMAT_LABELS, formatDate } from "@/lib/domain";
import { ROLE_LABELS } from "@/lib/permissions";

export const metadata: Metadata = { title: "Tournaments" };

export default async function TournamentsPage() {
  const [{ profile }, tournaments] = await Promise.all([requireSession(), getMyTournaments()]);
  const canCreate = profile.is_super_admin || profile.can_create_tournaments;
  const current = tournaments.filter((t) => !t.archived_at);
  const previous = tournaments.filter((t) => t.archived_at);

  return (
    <>
      <PageHeader
        title="Tournaments"
        description="Current and previous tournaments you have access to."
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/tournaments/new"><Plus /> Create tournament</Link>
            </Button>
          ) : null
        }
      />
      {tournaments.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No tournaments yet"
          description={
            canCreate
              ? "Create your first tournament. The Avatar Football League template comes with its rulebook and open decisions already set up."
              : "Ask a tournament organiser to invite you. Invitations arrive by email or as a link."
          }
          action={
            canCreate ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild>
                  <Link href="/tournaments/new?template=avatar-football-league"><Sparkles /> Avatar Football League template</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/tournaments/new">Blank tournament</Link>
                </Button>
              </div>
            ) : null
          }
        />
      ) : null}
      {current.length ? <TournamentGrid title="Current" list={current} /> : null}
      {previous.length ? <TournamentGrid title="Previous (archived)" list={previous} /> : null}
    </>
  );
}

function TournamentGrid({ title, list }: { title: string; list: Awaited<ReturnType<typeof getMyTournaments>> }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((t) => (
          <Link key={t.id} href={`/tournaments/${t.id}`}>
            <Card className="h-full gap-3 px-4 transition-shadow hover:shadow-md hover:ring-primary/30">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {t.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.logo_url} alt="" className="size-10 rounded-lg object-cover" />
                  ) : (
                    <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <Trophy className="size-5" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{t.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{FORMAT_LABELS[t.format]}</div>
                  </div>
                </div>
                <TournamentStatusBadge status={t.status} />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" /> {formatDate(t.start_date)}</span>
                <span>{t.role ? ROLE_LABELS[t.role] : "Super Admin"}</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
