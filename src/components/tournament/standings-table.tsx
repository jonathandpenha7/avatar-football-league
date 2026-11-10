import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TeamName, type TeamLike } from "@/components/app/team-name";
import type { StandingsResult } from "@/lib/engine";
import { cn } from "@/lib/utils";

export function StandingsTable({
  standings,
  teams,
  qualifiers,
  compact,
}: {
  standings: StandingsResult;
  teams: Map<string, TeamLike>;
  qualifiers?: number | null;
  compact?: boolean;
}) {
  return (
    <Table className="tabular">
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 text-center">#</TableHead>
          <TableHead>Team</TableHead>
          <TableHead className="w-10 text-center" title="Played">P</TableHead>
          {!compact ? (
            <>
              <TableHead className="w-10 text-center" title="Won">W</TableHead>
              <TableHead className="w-10 text-center" title="Drawn">D</TableHead>
              <TableHead className="w-10 text-center" title="Lost">L</TableHead>
              <TableHead className="hidden w-12 text-center sm:table-cell" title="Goals for">GF</TableHead>
              <TableHead className="hidden w-12 text-center sm:table-cell" title="Goals against">GA</TableHead>
            </>
          ) : null}
          <TableHead className="w-12 text-center" title="Goal difference">GD</TableHead>
          <TableHead className="w-12 text-center font-semibold" title="Points">Pts</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {standings.rows.map((r) => {
          const nonePlayed = standings.rows.every((x) => x.played === 0);
          const qualifies = qualifiers && r.position <= qualifiers && !r.shared;
          const boundary = qualifiers && r.position <= qualifiers && r.position + (r.shared ? r.tiedWith.length : 0) > qualifiers;
          return (
            <TableRow key={r.teamId} className={cn(qualifies && "bg-success/[0.06]")}>
              <TableCell className="relative text-center font-medium">
                {qualifies ? <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-success" /> : null}
                {nonePlayed ? (
                  <span className="text-muted-foreground">–</span>
                ) : r.shared ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={cn("cursor-help underline decoration-dotted", boundary && "text-amber-600")}>={r.position}</span>
                    </TooltipTrigger>
                    <TooltipContent>Tied: the configured tie-breakers cannot separate these teams.</TooltipContent>
                  </Tooltip>
                ) : (
                  r.position
                )}
              </TableCell>
              <TableCell className="max-w-0">
                <TeamName team={teams.get(r.teamId) ?? { name: r.name }} />
              </TableCell>
              <TableCell className="text-center">{r.played}</TableCell>
              {!compact ? (
                <>
                  <TableCell className="text-center">{r.won}</TableCell>
                  <TableCell className="text-center">{r.drawn}</TableCell>
                  <TableCell className="text-center">{r.lost}</TableCell>
                  <TableCell className="hidden text-center sm:table-cell">{r.goalsFor}</TableCell>
                  <TableCell className="hidden text-center sm:table-cell">{r.goalsAgainst}</TableCell>
                </>
              ) : null}
              <TableCell className="text-center">{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</TableCell>
              <TableCell className="text-center font-semibold">{r.points}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
