"use client";

import { useState } from "react";
import { CalendarRange, DatabaseBackup, FileSpreadsheet, FileText, ListOrdered, ScrollText, ShieldAlert, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/app/field";
import { downloadCsv, downloadText, slugify } from "@/lib/csv";

export interface ReportData {
  tournament: { name: string; venue: string | null; date: string | null; format: string; slug: string };
  fixtures: {
    id: string; code: string; round: string; date: string; time: string; pitch: string; home: string; away: string; status: string; score: string; notes: string;
    events: { minute: string; type: string; team: string; player: string; detail: string }[];
  }[];
  teamLists: { team: string; name: string; position: string; number: number | string; captain: string; status: string }[];
  standings: { title: string; rows: { pos: string; team: string; p: number; w: number; d: number; l: number; gf: number; ga: number; gd: number; pts: number }[] }[];
  discipline: { player: string; team: string; match: string; incident: string; reason: string; time: string }[];
  suspensions: { player: string; matches: number; reason: string; status: string }[];
  scorers: { player: string; team: string; goals: number; assists: number }[];
  summary: { matches: number; goals: number; teams: number; players: number; champion: string | null };
}

type Section = { title?: string; head: string[]; body: (string | number)[][] };

async function pdf(title: string, subtitle: string, sections: Section[], filename: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFontSize(16);
  doc.text(title, 40, 50);
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(subtitle, 40, 66);
  doc.setTextColor(0);
  let y = 84;
  for (const s of sections) {
    if (s.title) {
      if (y > 760) { doc.addPage(); y = 50; }
      doc.setFontSize(12);
      doc.text(s.title, 40, y + 8);
      y += 16;
    }
    autoTable(doc, {
      startY: y,
      head: [s.head],
      body: s.body.length ? s.body : [[{ content: "No data", colSpan: s.head.length }] as unknown as string[]],
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [22, 101, 70] },
      margin: { left: 40, right: 40 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(`Generated ${new Date().toLocaleString()} · page ${i} of ${pages}`, 40, 820);
  }
  doc.save(filename);
}

export function ReportsView({ data, backup }: { data: ReportData; backup: Record<string, unknown> | null }) {
  const t = data.tournament;
  const base = slugify(t.name);
  const sub = [t.format, t.venue, t.date].filter(Boolean).join(" · ");
  const played = data.fixtures.filter((f) => f.status === "confirmed");
  const [matchId, setMatchId] = useState(played[0]?.id ?? data.fixtures[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const wrap = (fn: () => Promise<void> | void) => async () => {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Export failed."); } finally { setBusy(false); }
  };

  const fixtureSection: Section = { head: ["Code", "Round", "Date", "Time", "Pitch", "Home", "Away", "Score"], body: data.fixtures.map((f) => [f.code, f.round, f.date, f.time, f.pitch, f.home, f.away, f.score]) };
  const standingsSections: Section[] = data.standings.map((s) => ({ title: s.title, head: ["#", "Team", "P", "W", "D", "L", "GF", "GA", "GD", "Pts"], body: s.rows.map((r) => [r.pos, r.team, r.p, r.w, r.d, r.l, r.gf, r.ga, r.gd, r.pts]) }));
  const disciplineSections: Section[] = [
    { title: "Incidents", head: ["Player", "Team", "Match", "Incident", "Reason", "Time"], body: data.discipline.map((d) => [d.player, d.team, d.match, d.incident, d.reason, d.time]) },
    { title: "Suspensions", head: ["Player", "Matches", "Reason", "Status"], body: data.suspensions.map((s) => [s.player, s.matches, s.reason, s.status]) },
  ];
  const teamSection: Section = { head: ["Team", "Player", "Position", "No.", "", "Status"], body: data.teamLists.map((p) => [p.team, p.name, p.position, p.number, p.captain, p.status]) };

  const reports = [
    { icon: CalendarRange, title: "Fixture list", desc: `${data.fixtures.length} fixtures with times, pitches and scores.`, csv: () => downloadCsv(`${base}-fixtures.csv`, data.fixtures.map((f) => ({ code: f.code, round: f.round, date: f.date, time: f.time, pitch: f.pitch, home: f.home, away: f.away, status: f.status, score: f.score }))), pdf: () => pdf(`${t.name}: fixtures`, sub, [fixtureSection], `${base}-fixtures.pdf`) },
    { icon: ListOrdered, title: "Standings", desc: "Current tables from confirmed results.", csv: () => downloadCsv(`${base}-standings.csv`, data.standings.flatMap((s) => s.rows.map((r) => ({ table: s.title, ...r })))), pdf: () => pdf(`${t.name}: standings`, sub, standingsSections, `${base}-standings.pdf`) },
    { icon: Users, title: "Team lists", desc: `${data.teamLists.length} players. No contact details.`, csv: () => downloadCsv(`${base}-teams.csv`, data.teamLists), pdf: () => pdf(`${t.name}: team lists`, sub, [teamSection], `${base}-teams.pdf`) },
    { icon: ShieldAlert, title: "Discipline report", desc: `${data.discipline.length} incidents, ${data.suspensions.length} suspensions.`, csv: () => downloadCsv(`${base}-discipline.csv`, data.discipline), pdf: () => pdf(`${t.name}: discipline`, sub, disciplineSections, `${base}-discipline.pdf`) },
    {
      icon: Trophy,
      title: "Tournament summary",
      desc: "Headline numbers, standings, top scorers and discipline.",
      csv: () => downloadCsv(`${base}-top-scorers.csv`, data.scorers),
      pdf: () =>
        pdf(`${t.name}: tournament summary`, sub, [
          { head: ["Teams", "Players", "Matches played", "Goals", "Champion"], body: [[data.summary.teams, data.summary.players, data.summary.matches, data.summary.goals, data.summary.champion ?? "Not decided"]] },
          ...standingsSections,
          { title: "Top scorers", head: ["Player", "Team", "Goals", "Assists"], body: data.scorers.slice(0, 20).map((s) => [s.player, s.team, s.goals, s.assists]) },
          ...disciplineSections,
        ], `${base}-summary.pdf`),
    },
  ];
  const match = data.fixtures.find((f) => f.id === matchId);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <Card key={r.title} className="gap-3 px-4">
            <div className="flex items-center gap-2 font-semibold"><r.icon className="size-4 text-primary" /> {r.title}</div>
            <p className="flex-1 text-sm text-muted-foreground">{r.desc}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={wrap(r.pdf)}><FileText /> PDF</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={wrap(r.csv)}><FileSpreadsheet /> CSV</Button>
            </div>
          </Card>
        ))}
        <Card className="gap-3 px-4">
          <div className="flex items-center gap-2 font-semibold"><ScrollText className="size-4 text-primary" /> Match report</div>
          <NativeSelect aria-label="Match" value={matchId} onChange={(e) => setMatchId(e.target.value)} disabled={!data.fixtures.length}>
            {data.fixtures.map((f) => <option key={f.id} value={f.id}>{f.code}: {f.home} v {f.away}</option>)}
          </NativeSelect>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !match}
              onClick={wrap(() =>
                pdf(`${match!.code}: ${match!.home} v ${match!.away}`, `${t.name} · ${[match!.round, match!.date, match!.time, match!.pitch].filter(Boolean).join(" · ")} · ${match!.score || "not played"} (${match!.status})`, [
                  { head: ["Min", "Event", "Team", "Player", "Detail"], body: match!.events.map((e) => [e.minute, e.type, e.team, e.player, e.detail]) },
                  ...(match!.notes ? [{ title: "Notes", head: ["Notes"], body: [[match!.notes]] }] : []),
                ], `${base}-${match!.code}.pdf`),
              )}
            >
              <FileText /> PDF
            </Button>
            <Button size="sm" variant="outline" disabled={busy || !match} onClick={wrap(() => downloadCsv(`${base}-${match!.code}-events.csv`, match!.events))}><FileSpreadsheet /> CSV</Button>
          </div>
        </Card>
      </div>
      {backup ? (
        <Card className="gap-3 px-4">
          <div className="flex items-center gap-2 font-semibold"><DatabaseBackup className="size-4 text-primary" /> Full backup</div>
          <p className="text-sm text-muted-foreground">
            Everything in this tournament as JSON, including private contact details. Store it securely.
          </p>
          <div>
            <Button size="sm" variant="outline" onClick={() => downloadText(`${base}-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), "application/json")}>
              <DatabaseBackup /> Download backup
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
