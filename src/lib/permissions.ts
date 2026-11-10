/**
 * UI-side permission matrix. It mirrors the database RLS policies so buttons
 * are only shown to people who can use them. The database remains the source
 * of truth: every action is re-checked there.
 */
export type MemberRole = "tournament_admin" | "referee" | "scorekeeper" | "viewer";

export type Action =
  | "tournament.view"
  | "tournament.create"
  | "tournament.edit"
  | "tournament.delete"
  | "users.manage"
  | "members.manage"
  | "teams.manage"
  | "players.manage"
  | "players.viewContacts"
  | "registrations.review"
  | "rules.manage"
  | "fixtures.generate"
  | "schedule.edit"
  | "officials.assign"
  | "match.record"
  | "match.control"
  | "match.confirm"
  | "match.correct"
  | "discipline.manage"
  | "audit.view";

export interface Actor {
  isSuperAdmin: boolean;
  canCreateTournaments?: boolean;
  role: MemberRole | null;
}

export interface MatchContext {
  /** Is the user assigned to this match as referee or scorekeeper? */
  assignedAs?: ("referee" | "scorekeeper")[];
  refereeCanConfirm?: boolean;
}

const ADMIN_ONLY: Action[] = [
  "tournament.edit",
  "members.manage",
  "teams.manage",
  "players.manage",
  "players.viewContacts",
  "registrations.review",
  "rules.manage",
  "fixtures.generate",
  "schedule.edit",
  "officials.assign",
  "match.correct",
  "discipline.manage",
  "audit.view",
];

export function can(actor: Actor, action: Action, ctx: MatchContext = {}): boolean {
  if (actor.isSuperAdmin) return true;
  switch (action) {
    case "tournament.create":
      return !!actor.canCreateTournaments;
    case "tournament.delete":
    case "users.manage":
      return false;
    case "tournament.view":
      return actor.role !== null;
  }
  const isAdmin = actor.role === "tournament_admin";
  if (ADMIN_ONLY.includes(action)) return isAdmin;

  const assigned = ctx.assignedAs ?? [];
  const isOfficialRole = actor.role === "referee" || actor.role === "scorekeeper";
  switch (action) {
    case "match.record":
    case "match.control":
      return isAdmin || (isOfficialRole && assigned.length > 0);
    case "match.confirm":
      return isAdmin || (!!ctx.refereeCanConfirm && actor.role === "referee" && assigned.includes("referee"));
    default:
      return false;
  }
}

export const ROLE_LABELS: Record<MemberRole | "super_admin", string> = {
  super_admin: "Super Admin",
  tournament_admin: "Tournament Admin",
  referee: "Referee",
  scorekeeper: "Scorekeeper",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  tournament_admin: "Manage teams, players, fixtures, schedule, rules and results.",
  referee: "Record events, cards and results for assigned matches.",
  scorekeeper: "Enter scores and match events for assigned matches.",
  viewer: "Read-only access to tournament information.",
};
