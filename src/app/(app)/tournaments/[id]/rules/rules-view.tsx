"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, CircleCheck, CircleDashed, Megaphone, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/app/field";
import { ConfirmAction } from "@/components/app/confirm-action";
import { useAction } from "@/hooks/use-action";
import { addDecision, resolveDecision, setPublishing } from "@/lib/actions/tournaments";
import { deleteAnnouncement, deleteRule, moveRule, saveAnnouncement, saveRule, setAnnouncementPublished } from "@/lib/actions/rules";
import { RULE_CATEGORY_LABELS } from "@/lib/domain";
import type { Announcement, Decision, Rule, RuleCategory } from "@/lib/types";

export function RulesView({
  tournamentId,
  isAdmin,
  rules,
  decisions,
  announcements,
  rulesPublished,
  publicEnabled,
}: {
  tournamentId: string;
  isAdmin: boolean;
  rules: Rule[];
  decisions: Decision[];
  announcements: Announcement[];
  rulesPublished: boolean;
  publicEnabled: boolean;
}) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [form, setForm] = useState({ category: "general" as RuleCategory, title: "", body: "", needs_decision: false });
  const [newQuestion, setNewQuestion] = useState("");
  const [ann, setAnn] = useState({ title: "", body: "", is_published: true });
  const open = decisions.filter((d) => d.status === "open");
  const categories = Object.keys(RULE_CATEGORY_LABELS) as RuleCategory[];

  const startEdit = (r: Rule | "new") => {
    setEditing(r);
    setForm(r === "new" ? { category: "general", title: "", body: "", needs_decision: false } : { category: r.category, title: r.title, body: r.body, needs_decision: r.needs_decision });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_24rem]">
      <div className="min-w-0 space-y-6">
        {isAdmin ? (
          <Card className="gap-3 px-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Switch id="publish-rules" checked={rulesPublished} disabled={pending} onCheckedChange={(v) => run(() => setPublishing(tournamentId, { rules_published: v }), { success: v ? "Rules published." : "Rules unpublished." })} />
                <div>
                  <Label htmlFor="publish-rules">Publish rules to participants</Label>
                  <p className="text-xs text-muted-foreground">{publicEnabled ? "Shown on the public tournament page." : "Enable the public page in Settings for participants to see them."}</p>
                </div>
              </div>
              <Button size="sm" onClick={() => startEdit("new")}><Plus /> Add rule</Button>
            </div>
            {rulesPublished && rules.some((r) => r.needs_decision) ? (
              <p className="text-xs text-amber-700 dark:text-warning">Some published rules are still marked as awaiting a decision.</p>
            ) : null}
          </Card>
        ) : null}

        {categories.map((cat) => {
          const list = rules.filter((r) => r.category === cat);
          if (!list.length) return null;
          return (
            <section key={cat}>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{RULE_CATEGORY_LABELS[cat]}</h2>
              <Card className="gap-0 divide-y py-0">
                {list.map((r, i) => (
                  <article key={r.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium">
                        {r.title}
                        {r.needs_decision ? <Badge variant="outline" className="ml-2 text-amber-700 dark:text-warning">Awaiting decision</Badge> : null}
                      </h3>
                      {isAdmin ? (
                        <div className="no-print flex shrink-0 gap-0.5">
                          <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0 || pending} onClick={() => run(() => moveRule(tournamentId, r.id, "up"))}><ArrowUp /></Button>
                          <Button variant="ghost" size="icon-xs" aria-label="Move down" disabled={i === list.length - 1 || pending} onClick={() => run(() => moveRule(tournamentId, r.id, "down"))}><ArrowDown /></Button>
                          <Button variant="ghost" size="icon-xs" aria-label="Edit rule" onClick={() => startEdit(r)}><Pencil /></Button>
                          <ConfirmAction destructive trigger={<Button variant="ghost" size="icon-xs" aria-label="Delete rule"><Trash2 /></Button>} title={`Delete "${r.title}"?`} confirmLabel="Delete" action={() => deleteRule(tournamentId, r.id)} />
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-1 space-y-1 text-sm whitespace-pre-line text-muted-foreground">{r.body}</div>
                  </article>
                ))}
              </Card>
            </section>
          );
        })}
        {!rules.length ? <p className="text-sm text-muted-foreground">No rules yet.</p> : null}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Decision checklist</CardTitle>
            <CardDescription>{open.length ? `${open.length} open item${open.length > 1 ? "s" : ""}. Nothing here is assumed until you decide.` : "All decisions recorded."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {decisions.map((d) => (
              <DecisionItem key={d.id} tournamentId={tournamentId} decision={d} isAdmin={isAdmin} />
            ))}
            {isAdmin ? (
              <div className="flex gap-2 pt-1">
                <Input placeholder="Add a question to decide" value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} />
                <Button variant="outline" size="icon" aria-label="Add question" disabled={pending || newQuestion.trim().length < 5} onClick={() => run(() => addDecision(tournamentId, newQuestion, null), { onSuccess: () => setNewQuestion("") })}><Plus /></Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Megaphone className="size-4" /> Announcements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{a.title}</div>
                  {isAdmin ? (
                    <div className="flex items-center gap-1">
                      <Switch aria-label="Published" checked={a.is_published} onCheckedChange={(v) => run(() => setAnnouncementPublished(tournamentId, a.id, v))} />
                      <ConfirmAction destructive trigger={<Button variant="ghost" size="icon-xs" aria-label="Delete announcement"><Trash2 /></Button>} title="Delete announcement?" confirmLabel="Delete" action={() => deleteAnnouncement(tournamentId, a.id)} />
                    </div>
                  ) : null}
                </div>
                <p className="mt-1 whitespace-pre-line text-muted-foreground">{a.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{a.is_published ? "" : " · draft"}</p>
              </div>
            ))}
            {!announcements.length ? <p className="text-sm text-muted-foreground">No announcements.</p> : null}
            {isAdmin ? (
              <div className="space-y-2 border-t pt-3">
                <Input placeholder="Title" value={ann.title} onChange={(e) => setAnn({ ...ann, title: e.target.value })} />
                <Textarea placeholder="Message" rows={3} value={ann.body} onChange={(e) => setAnn({ ...ann, body: e.target.value })} />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={ann.is_published} onCheckedChange={(v) => setAnn({ ...ann, is_published: !!v })} /> Publish now</label>
                  <Button size="sm" disabled={pending || !ann.title.trim()} onClick={() => run(() => saveAnnouncement(tournamentId, ann), { onSuccess: () => setAnn({ title: "", body: "", is_published: true }) })}>Post</Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>{editing === "new" ? "Add rule" : "Edit rule"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Field label="Category" htmlFor="r-cat">
              <NativeSelect id="r-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as RuleCategory })}>
                {categories.map((c) => <option key={c} value={c}>{RULE_CATEGORY_LABELS[c]}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Title" htmlFor="r-title"><Input id="r-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Rule text" htmlFor="r-body" hint="Each line is shown as a separate line."><Textarea id="r-body" rows={8} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.needs_decision} onCheckedChange={(v) => setForm({ ...form, needs_decision: !!v })} /> Still awaiting a decision</label>
          </div>
          <DialogFooter>
            <Button disabled={pending || !form.title.trim()} onClick={() => run(() => saveRule(tournamentId, editing === "new" ? null : (editing as Rule).id, form), { onSuccess: () => setEditing(null) })}>Save rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DecisionItem({ tournamentId, decision: d, isAdmin }: { tournamentId: string; decision: Decision; isAdmin: boolean }) {
  const { pending, run } = useAction();
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex gap-2">
        {d.status === "resolved" ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-600" />}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{d.question}</p>
          {d.context ? <p className="text-xs text-muted-foreground">{d.context}</p> : null}
          {d.status === "resolved" ? (
            <p className="text-xs"><span className="text-muted-foreground">Decision:</span> {d.resolution}</p>
          ) : null}
        </div>
      </div>
      {isAdmin ? (
        d.status === "resolved" ? (
          <Button variant="ghost" size="xs" className="mt-1" disabled={pending} onClick={() => run(() => resolveDecision(tournamentId, d.id, null))}><RotateCcw /> Reopen</Button>
        ) : expanded ? (
          <div className="mt-2 space-y-2">
            {d.options.length ? (
              <div className="flex flex-wrap gap-1.5">
                {d.options.map((o) => <Button key={o} size="xs" variant={text === o ? "default" : "outline"} onClick={() => setText(o)}>{o}</Button>)}
              </div>
            ) : null}
            <Textarea rows={2} placeholder="Record the decision" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button size="xs" variant="ghost" onClick={() => setExpanded(false)}>Cancel</Button>
              <Button size="xs" disabled={pending || !text.trim()} onClick={() => run(() => resolveDecision(tournamentId, d.id, text))}>Save decision</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="xs" className="mt-2" onClick={() => setExpanded(true)}>Record decision</Button>
        )
      ) : null}
    </div>
  );
}
