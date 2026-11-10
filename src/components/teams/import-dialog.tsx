"use client";

import { useState } from "react";
import Papa from "papaparse";
import { FileUp, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { importPlayers, type ImportSummary } from "@/lib/actions/teams";
import { downloadCsv } from "@/lib/csv";

const TEMPLATE_COLUMNS = ["full_name", "team", "position", "jersey_number", "email", "phone", "captain"];

export function ImportDialog({ tournamentId }: { tournamentId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [createTeams, setCreateTeams] = useState(true);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const { pending, run } = useAction();

  const reset = () => {
    setRows([]);
    setFileName(null);
    setParseError(null);
    setSummary(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><FileUp /> Import CSV</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import players from CSV</DialogTitle>
          <DialogDescription>
            Use your real registration data. Columns: full_name (required), team, position, jersey_number, email, phone, captain (yes/no).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex">
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setSummary(null);
                setFileName(file.name);
                Papa.parse<Record<string, string>>(file, {
                  header: true,
                  skipEmptyLines: "greedy",
                  complete: (res) => {
                    if (res.errors.length) setParseError(`Row ${res.errors[0].row}: ${res.errors[0].message}`);
                    else setParseError(null);
                    setRows(res.data);
                  },
                });
              }}
            />
            <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-sm hover:bg-muted">
              <FileUp className="size-4" /> {fileName ?? "Choose file"}
            </span>
          </label>
          <Button variant="ghost" size="sm" onClick={() => downloadCsv("players-template.csv", [{ full_name: "Jane Doe", team: "Team 1", position: "Striker", jersey_number: "9", email: "", phone: "", captain: "no" }], TEMPLATE_COLUMNS)}>
            <Download /> Download template
          </Button>
        </div>
        {parseError ? (
          <Alert variant="destructive"><AlertDescription>{parseError}</AlertDescription></Alert>
        ) : null}
        {rows.length && !summary ? (
          <>
            <p className="text-sm text-muted-foreground">{rows.length} rows found. Preview:</p>
            <div className="max-h-56 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {Object.keys(rows[0]).slice(0, 6).map((h) => <TableHead key={h}>{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 8).map((r, i) => (
                    <TableRow key={i}>
                      {Object.keys(rows[0]).slice(0, 6).map((h) => <TableCell key={h} className="max-w-40 truncate">{r[h]}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={createTeams} onCheckedChange={(v) => setCreateTeams(!!v)} /> Create teams that do not exist yet
            </label>
          </>
        ) : null}
        {summary ? (
          <Alert>
            <AlertDescription className="space-y-2">
              <p>
                Imported {summary.created} player{summary.created === 1 ? "" : "s"}.
                {summary.createdTeams.length ? ` Created teams: ${summary.createdTeams.join(", ")}.` : ""}
              </p>
              {summary.skipped.length ? (
                <div>
                  <p className="font-medium">{summary.skipped.length} row(s) skipped:</p>
                  <ul className="max-h-40 list-disc overflow-auto pl-4 text-xs">
                    {summary.skipped.map((s) => (
                      <li key={s.row}>Row {s.row} ({s.name || "no name"}): {s.reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          {summary ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <Button
              disabled={!rows.length || pending}
              onClick={() => run(() => importPlayers(tournamentId, rows, { createMissingTeams: createTeams }), { onSuccess: (d) => d && setSummary(d) })}
            >
              {pending ? "Importing…" : `Import ${rows.length || ""} players`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
