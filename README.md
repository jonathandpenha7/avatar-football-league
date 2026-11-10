# Church Tournament Manager

A reusable web application for planning and running church football tournaments: setup wizard, teams and players, online registration, automatic fixtures and scheduling across pitches, live scorekeeping, standings, knockouts, discipline, statistics, exports and a public tournament page.

It ships with a template for the **Avatar Football League**, but nothing about that tournament is hard-coded. Every tournament has its own configuration, teams, players, fixtures and results.

## Contents

1. [Progress checklist](#progress-checklist)
2. [Technology](#technology)
3. [Supabase setup](#supabase-setup)
4. [Running locally](#running-locally)
5. [Create your first tournament](#create-your-first-tournament)
6. [Invite referees, scorekeepers and organisers](#invite-referees-scorekeepers-and-organisers)
7. [Deploying](#deploying)
8. [How it works](#how-it-works)
9. [Testing](#testing)
10. [Known limitations](#known-limitations)

## Progress checklist

Status key: ✅ built and covered by automated tests · 🟢 built and type-checked, compiled in the production build · ⚠️ needs configuration or a manual check on a live Supabase project.

| Phase | Item | Status |
|---|---|---|
| 1 | Repository inspected (empty apart from `Game Rules.pdf`), architecture chosen | ✅ |
| 2 | Next.js 16, TypeScript, Tailwind v4, shadcn/ui design system, light and dark mode | 🟢 |
| 2 | Database schema, constraints, indexes (5 migrations) | ✅ |
| 3 | Supabase Auth (password, magic link, password reset), session refresh in `src/proxy.ts` | 🟢 ⚠️ |
| 3 | Roles: Super Admin, Tournament Admin, Referee, Scorekeeper, Viewer, enforced by RLS | ✅ |
| 3 | Tournament setup wizard with live feasibility check, Avatar template | ✅ (template and payload) 🟢 (UI) |
| 3 | Settings for every tournament option, archive, "start the next tournament" (clone), delete | ✅ 🟢 |
| 4 | Teams (colours, logos, groups, seeds), players, captains, squad-size limit, duplicate checks | ✅ 🟢 |
| 4 | CSV import and export of players and team lists | 🟢 |
| 4 | Online registration link, organiser approval, consent and payment tracked separately | ✅ |
| 5 | Fixture engine: round robin (single/double, odd/even), single and double elimination, groups + knockout, league + play-offs | ✅ |
| 5 | Scheduler across pitches, blocked periods, pitch availability, feasibility with suggested fixes | ✅ |
| 5 | Manual schedule edits, swaps and instant conflict warnings; publish and unpublish | ✅ (engine) 🟢 (UI) |
| 6 | Match centre (today, in progress, upcoming, awaiting confirmation, completed, by pitch) | 🟢 |
| 6 | Scorekeeping: clock, goals, assists, own goals, cards, fouls, substitutions, time penalties, shootouts, notes | ✅ (database rules) 🟢 (UI) |
| 6 | Confirm and correct results, audit log entries for every correction | ✅ |
| 6 | Real-time updates across devices (Supabase Realtime) | 🟢 ⚠️ |
| 7 | Standings with configurable points and tie-breakers, organiser decisions for unresolvable ties | ✅ |
| 7 | Knockout seeding only when qualification is satisfied (optional provisional seeding), automatic advancement | ✅ |
| 7 | Discipline register, configurable suspensions, eligibility and pre-match alerts | ✅ |
| 8 | Statistics dashboard with charts | 🟢 |
| 8 | Reports: fixtures, standings, team lists, discipline, match report, tournament summary (PDF and CSV), full JSON backup | 🟢 |
| 8 | Public tournament page (read-only, no contact details), live scores | ✅ (data exposure) 🟢 (UI) |
| 9 | 128 automated tests, lint clean, production build succeeds | ✅ |
| – | End-to-end run against a real Supabase project | ⚠️ not done: no credentials were available. See [Known limitations](#known-limitations). |

### Avatar Football League: open decisions

These were **not** assumed. They are loaded as an organiser checklist (Rules and decisions page) and the related settings are left unset:

- [ ] Goalkeeper handball outside the penalty area: red card or goal-to-goal penalty? (the rulebook says both)
- [ ] Sideline kick-in distance: 2 or 3 metres? (the rulebook says 3)
- [ ] Are direct goals from corners allowed? (the corner page repeats the kick-in sentence, probably a copy error)
- [ ] Match duration (scheduling is blocked until set; the app shows the longest length that fits)
- [ ] Tie-breaker order (until confirmed, teams level on points share a position and seeding waits)
- [ ] Suspension rules (no automatic suspensions until configured)
- [ ] Final team count (6 or 7), transition time, length of the rules announcement, knockout shootout format, minimum players to start and the forfeit score

## Technology

- **Next.js 16** (App Router, Server Components, Server Actions, Turbopack) and **React 19** with the React Compiler
- **TypeScript**, **Tailwind CSS v4**, **shadcn/ui** (Radix), **Lucide** icons, **Recharts**
- **Supabase**: Postgres, Auth, Row Level Security, Realtime and Storage (team and tournament logos)
- **Zod** for validation on the server (every Server Action validates its input)
- **Vitest** and **PGlite** (Postgres compiled to WebAssembly) to run the real migrations in tests
- **jsPDF** and **PapaParse** for PDF and CSV exports

The fixture, scheduling, standings, qualification and discipline logic lives in `src/lib/engine/` as pure TypeScript with no I/O, so it is fully unit-tested and also runs in the browser for the live feasibility panel.

## Supabase setup

1. **Create a project** at [supabase.com](https://supabase.com). The free tier is enough for a church tournament.

2. **Apply the migrations** in `supabase/migrations/` in filename order. Either:
   - with the Supabase CLI (recommended):
     ```bash
     npx supabase init          # only if supabase/config.toml does not exist; keeps the migrations folder
     npx supabase login
     npx supabase link --project-ref <your-project-ref>
     npx supabase db push
     ```
   - or paste each file into **SQL Editor** and run them one at a time, in order (`…0001_schema.sql` to `…0005_storage_realtime.sql`).

   The migrations create the tables, RLS policies, database functions, a public `tournament-assets` storage bucket for logos and add `fixtures` and `match_events` to Realtime.

3. **Copy the API keys**: Project Settings → API. You need the project URL and the publishable (or anon) key. Optionally copy the service-role key for invitation emails.

4. **Configure Auth** (Authentication → URL Configuration):
   - **Site URL**: your app address, for example `https://tournaments.yourchurch.org` (use `http://localhost:3000` while developing).
   - **Redirect URLs**: add `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback`.

5. **Update the email templates** (Authentication → Email Templates) so links work on any device. Replace the link in each template with:

   | Template | Link |
   |---|---|
   | Confirm signup | `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email` |
   | Magic link | `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email` |
   | Invite user | `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite` |
   | Reset password | `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery` |

   The app always sends a redirect of the form `https://<site>/auth/callback?next=…`, so appending `&token_hash=…` produces a valid link that `src/app/auth/callback/route.ts` verifies.

6. **Optional**: for real email delivery beyond Supabase's small built-in quota, set up custom SMTP under Project Settings → Auth.

## Running locally

Requires Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local      # then fill in the values
npm run dev                     # http://localhost:3000
```

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | yes | Public client key (safe in the browser; RLS protects data) |
| `NEXT_PUBLIC_SITE_URL` | yes in production | Used in invitation, registration and email links |
| `SUPABASE_SERVICE_ROLE_KEY` | optional | Lets the app send invitation emails. Server-only; never expose it |

If the Supabase variables are missing the app shows a setup page instead of pretending to work.

Other commands:

```bash
npm test            # 128 tests: engine, permissions, database (RLS, triggers, RPCs) and an end-to-end tournament
npm run lint
npm run typecheck
npm run build
npm run db:check    # applies all migrations to an in-memory Postgres to catch SQL errors
```

## Create your first tournament

1. Open the app and **create an account**. The **first account ever created becomes the Super Admin**, so do this right after deploying.
2. Go to **Tournaments → Create tournament** and choose the **Avatar Football League** template (or Blank).
3. Work through the wizard: details and date, number of teams (6 or 7), format, points and tie-breakers, match timing and pitches, discipline. The feasibility panel shows straight away whether everything fits between 5 PM and 9 PM, and if not, what to change (shorter matches, more pitches, a longer window).
4. On the new tournament's dashboard, follow **Pending tasks**:
   - **Rules and decisions**: record each open decision, then update the related rule text or setting.
   - **Teams and players**: rename the placeholder teams, then add players or **Import CSV** with your real registration data (a template CSV is provided in the dialog). Or share the **registration link** (Settings → Registration) and approve submissions on **Registrations**.
   - **Settings → Match and schedule**: set the match duration and transition time once decided.
   - **Fixtures and schedule**: generate fixtures, check conflicts, make manual tweaks, then **Publish**.
5. On match day use the **Match centre**. After the league, the **Knockout** page seeds the semi-finals (1st v 4th, 2nd v 3rd) once every league match is confirmed and no tie affects qualification. The final fills itself as semi-finals are confirmed.
6. Turn on the **public page** in Settings → Public page and share the link.
7. Afterwards: **Reports** for PDFs and a full backup, then Settings → Archive and delete → **Create next tournament** to copy the configuration into next year's event.

## Invite referees, scorekeepers and organisers

1. Open the tournament → **Organisers and officials**.
2. Enter the person's email and pick a role:
   - **Tournament Admin**: manages everything in this tournament.
   - **Referee**: records events, cards and notes for assigned matches; can confirm results only if "Assigned referees can confirm results" is on.
   - **Scorekeeper**: enters scores and events for assigned matches.
   - **Viewer**: read-only.
3. Click **Send invitation**. With `SUPABASE_SERVICE_ROLE_KEY` set, Supabase emails them; otherwise copy the link shown and send it by WhatsApp or email. They sign in with the invited email address and accept. Invitations expire after 14 days and can be revoked.
4. Under **Match assignments**, assign people to matches individually, or in bulk (for example "Sam as scorekeeper for all matches on Pitch 1"). Officials can only record events for matches they are assigned to; this is enforced in the database.

People invited by email who have no password yet can set one under **Account** after signing in.

Super Admins can also grant "can create tournaments" or Super Admin rights, and add existing users to any tournament, under **Users and permissions**.

## Deploying

The app is a standard Next.js project and deploys well to **Vercel**:

1. Push the project to a Git repository (do not commit `.env.local`; it is ignored).
2. Import it in Vercel. The framework is detected automatically.
3. Add the environment variables from the table above for the Production environment, with `NEXT_PUBLIC_SITE_URL` set to your production URL.
4. Deploy, then add `https://<your-domain>/auth/callback` to Supabase's redirect URLs and set the Site URL (see [Supabase setup](#supabase-setup)).
5. Sign up immediately to claim the Super Admin account.

Any Node.js host works too: `npm run build && npm start`. `NEXT_PUBLIC_*` variables are embedded at build time, so set them before building.

## How it works

### Data and permissions

- Every tournament-specific table has a `tournament_id`. RLS policies in `supabase/migrations/…0003_rls.sql` decide who can read or write each row, using helper functions in a non-exposed `private` schema.
- Player contact details live in a separate `player_contacts` table that only tournament admins can read. The public page uses a `get_public_tournament()` function that returns only safe fields.
- Multi-row operations run as single database transactions in Postgres functions (`…0004_rpc.sql`): creating or cloning a tournament, replacing fixtures, confirming and correcting results, knockout advancement, forfeits, registration approval and invitation acceptance.
- **Scores cannot be typed in directly.** They are recalculated by a trigger from goal events, so the scoreboard and the event list never disagree. Forfeits are the only exception, recorded through `record_forfeit()` with a reason.
- **Standings are never stored.** They are calculated from confirmed fixtures each time they are viewed, so a changed fixture or score cannot leave a stale table behind.
- Confirmed results are locked. A correction reopens the result with a mandatory reason (written to `audit_logs`), the events are fixed, and it is confirmed again. If a later knockout match depending on it has already started, the correction is refused until that match is corrected first.
- Card events automatically create discipline records. Suspensions are created only if the tournament has configured the corresponding rule.

### Scheduling

`src/lib/engine/schedule.ts` builds time slots from the playing window, match length, half-time, transition time, blocked periods and per-pitch availability. League or group matches are placed slot by slot with a hard rule that no team plays twice in the same slot, and a scoring function that fills pitches, avoids back-to-back matches, balances waiting time and spreads teams across pitches. Many seeded passes run and the best is kept, so the same input always gives the same schedule. Knockout matches are placed after the matches that decide their teams, keeping each round simultaneous where pitches allow. If anything does not fit, nothing is saved and the feasibility report suggests concrete changes.

### Project layout

```
supabase/migrations/       SQL schema, triggers, RLS, RPCs, storage and realtime
src/lib/engine/            pure tournament logic (fixtures, brackets, scheduling, standings, discipline, stats)
src/lib/actions/           Server Actions (validated with Zod, permissions enforced by RLS)
src/lib/data/              server-side data loading
src/lib/templates/         tournament templates (Avatar Football League rulebook and decisions)
src/app/(app)/             signed-in organiser app
src/app/t/[slug]           public tournament page
src/app/register/[token]   public registration form
src/app/invite/[token]     invitation acceptance
tests/engine               engine and permission tests
tests/db                   migrations, RLS and RPC tests in PGlite, plus an end-to-end tournament
```

## Testing

`npm test` runs:

- **Engine tests**: round robin for 2 to 16 teams (match counts from n(n−1)/2, every pair exactly once, odd team byes, home/away balance, double round robin), seeding, byes, single and double elimination, group cross-over, schedule slots, no team on two pitches at once, simultaneous semi-finals, dependency order, feasibility and suggestions, conflict detection, standings, custom points, every tie-breaker, unconfirmed tie-breakers, organiser decisions, qualification blockers and provisional seeding, suspensions and eligibility, and the permission matrix.
- **Database tests**: the real migrations are executed in PGlite with a small Supabase shim (`tests/db/supabase-shim.sql`). They check RLS for each role, squad limits, captain and duplicate constraints, score calculation from events, official-only status changes, confirmation permissions, event locking, audited corrections, knockout advancement and its reversal, shootouts, discipline automation, private contact data, the public page, registration (never marked as paid), invitations and deletion.
- **End-to-end tournament**: the Avatar template is validated and created exactly as the wizard sends it, 24 fixtures are generated and scheduled from 5:10 PM, all 21 league matches are played and confirmed, semi-finals are seeded 1st v 4th and 2nd v 3rd, and the winners advance to a final decided on penalties.

## Known limitations

- **Not yet run against a live Supabase project**, because no credentials were available while building. The SQL is executed in tests on real Postgres (PGlite), but these Supabase-specific parts have not been exercised: Auth emails and redirects, Storage upload policies, Realtime delivery, and PostgREST behaviour. Please do a quick manual pass after setup: sign up, create the Avatar tournament, upload a logo, invite a second account, score a match on two devices, and open the public page in a private window.
- The UI pages compile, type-check and render (smoke-tested without a database), but have not been clicked through end to end in a browser with live data.
- Double elimination uses a single grand final (no bracket reset).
- There is no offline mode: scorekeeping needs a connection.
- The first account created becomes Super Admin. Create it straight after deploying. Anyone can sign up, but an account sees nothing until invited.
- PDF exports are clean tables, not designed print layouts.
