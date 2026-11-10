import type { RuleCategory, TournamentSettings } from "@/lib/types";
import type { TournamentFormat } from "@/lib/engine/types";

export interface TemplateRule {
  category: RuleCategory;
  title: string;
  body: string;
  needs_decision?: boolean;
}

export interface TemplateDecision {
  key: string;
  question: string;
  context: string;
  options: string[];
}

export interface TournamentTemplate {
  key: string;
  name: string;
  description: string;
  format: TournamentFormat;
  dailyStart: string;
  dailyEnd: string;
  pitches: string[];
  /** Allowed team counts offered in the wizard; the organiser picks one. */
  teamCountOptions: number[];
  settings: Partial<TournamentSettings>;
  rules: TemplateRule[];
  decisions: TemplateDecision[];
}

/**
 * Avatar Football League. Rules are transcribed from the organisers'
 * rulebook ("Game Rules.pdf"). Where the rulebook is contradictory or
 * silent, the item is left unset and added to the decision checklist.
 */
export const avatarFootballLeague: TournamentTemplate = {
  key: "avatar-football-league",
  name: "Avatar Football League",
  description: "Five-a-side church football league: round-robin league (7 + 2 + 7), then semi-finals, a third-place match and a final (10 + 2 + 10).",
  format: "league_playoff",
  dailyStart: "17:00",
  dailyEnd: "21:00",
  pitches: ["Pitch 1", "Pitch 2"],
  teamCountOptions: [6, 7],
  settings: {
    max_squad_size: 6,
    players_on_pitch: 5,
    substitutes: 1,
    min_players_to_start: null,
    qualifiers: 4,
    third_place_match: true,
    points_win: 3,
    points_draw: 1,
    points_loss: 0,
    tiebreakers: ["goal_difference", "goals_for", "head_to_head", "organiser_decision"],
    tiebreakers_confirmed: false,
    // League: 7 + 2 + 7. Knockouts: 10 + 2 + 10. 5-minute changeover.
    match_duration_min: 14,
    periods: 2,
    half_time_min: 2,
    knockout_match_duration_min: 20,
    knockout_half_time_min: 2,
    transition_min: 5,
    penalties_enabled: true,
    second_yellow_is_red: true,
    red_card_suspension_matches: null,
    yellow_accumulation_threshold: null,
    yellow_accumulation_suspension_matches: null,
    forfeit_goals: null,
    blocked_periods: [{ start: "17:00", end: "17:10", label: "Rules announcement (length to be confirmed)" }],
  },
  rules: [
    { category: "general", title: "Fair play", body: "Let's ensure that all matches are played with sportsmanship and respect for one another." },
    { category: "match", title: "Scoring", body: "Goals can only be scored after the ball has crossed the half line." },
    {
      category: "match",
      title: "Out of bounds (kick-in)",
      body: "Once the ball has crossed the sideline, the opposing team is awarded a kick-in, taken from the point where the ball crossed the line.\nOpponents must stand back from the point of the kick-in. The rulebook states 3 metres; the distance (2 or 3 metres) is awaiting confirmation.\nGoals cannot be scored directly from a kick-in.",
      needs_decision: true,
    },
    {
      category: "match",
      title: "Corner kicks",
      body: "A corner kick is awarded when the ball crosses the goal line after last being touched by a player from the defending team.\nThe corner kick is taken from the corner arc nearest to where the ball went out of play.\nWhether a goal can be scored directly from a corner is awaiting confirmation.",
      needs_decision: true,
    },
    {
      category: "match",
      title: "Free kicks",
      body: "Awarded for fouls and dangerous play (at the discretion of the referee), and for non-penal offences such as the goalkeeper handling a back-pass.\nAll players must be at least 3 metres from the ball when the kick is taken.\nGoals cannot be scored directly from a free kick.",
    },
    {
      category: "match",
      title: "Penalties",
      body: "Awarded for fouls committed by the defending team within their penalty area.\nPenalty kicks are taken goal to goal, either as one lob or directly into the opposition's goal.",
    },
    {
      category: "substitution",
      title: "Rolling substitutions",
      body: "There is no limit to the number of rolling substitutions. Be generous and give everyone a chance to be part of the fun.\nThere is no stoppage time for substitutions, so plan them well.",
    },
    {
      category: "fouls_cards",
      title: "Yellow card offences",
      body: "Aggressive tackles.\nMisbehaving with players.\nArguing with the referees.\nAbusive language towards players.",
    },
    {
      category: "fouls_cards",
      title: "Red card offences",
      body: "Life- or career-threatening fouls.\nDeliberate handball interfering with a goal-scoring opportunity.\nTwo yellow cards.\nGoalkeeper using their hands to disrupt play outside the box: the sanction is awaiting confirmation (see the decision checklist).",
      needs_decision: true,
    },
    {
      category: "fouls_cards",
      title: "Fouls",
      body: "Kicking an opponent: intentional or reckless kicking results in a free kick for the opposing team.\nTripping: tripping or attempting to trip an opponent results in a free kick.\nPushing: pushing an opponent results in a direct free kick.\nHolding: after one warning, holding or pulling an opponent results in a direct free kick.",
    },
    {
      category: "fouls_cards",
      title: "Handball",
      body: "Intentional handball by a player (other than the goalkeeper within their penalty area) results in a goal-to-goal penalty.\nIntentional handball by a player outside the D results in a yellow card.\nAccidental handball by a player or the keeper (outside the D) is a foul.\nIntentional handball by the keeper outside the D: awaiting confirmation (the rulebook lists both a goal-to-goal penalty and a red card).",
      needs_decision: true,
    },
    {
      category: "fouls_cards",
      title: "Back-pass",
      body: "If a teammate deliberately passes the ball back with their feet and the goalkeeper handles it, a goal-to-goal penalty is awarded.\nAllowed: the ball is headed, chest-trapped or deflected unintentionally by a teammate.",
    },
    {
      category: "fouls_cards",
      title: "High foot, sliding tackles and aggressive behaviour",
      body: "High foot: raising a foot dangerously close to an opponent's head or upper body results in a direct free kick.\nSliding tackles are not allowed and result in a direct free kick and a 2-minute suspension from the game, with no option to use a substitute.\nAggressive behaviour such as hitting, elbowing or spitting results in a direct free kick and possibly further sanctions (yellow or red card).",
    },
    {
      category: "referee",
      title: "Respect for referees",
      body: "We will ensure fair and unbiased refereeing during the game. However, any aggression towards the referee will result in a 4-minute timeout for the player.\nWe do not have VAR and the referee is human. Please be understanding.",
    },
    {
      category: "suspensions",
      title: "Suspensions after cards",
      body: "Whether a red card (or accumulated yellow cards) carries a suspension for following matches is awaiting confirmation. Until the organisers decide, no automatic suspensions are applied.",
      needs_decision: true,
    },
    {
      category: "knockout",
      title: "Knockout stage",
      body: "The top four teams in the league qualify.\nSemi-final 1: 1st v 4th. Semi-final 2: 2nd v 3rd.\nThe semi-final winners play the final and the losers play for third place.\nKnockout matches are 10 + 2 + 10 minutes.\nA drawn knockout match is decided by a penalty shootout (format awaiting confirmation).",
      needs_decision: true,
    },
  ],
  decisions: [
    {
      key: "gk_handball_outside_area",
      question: "Goalkeeper handball outside the penalty area: red card or goal-to-goal penalty?",
      context: "The rulebook's Cards page lists it as a red card offence, while its Fouls page says it results in a goal-to-goal penalty.",
      options: ["Red card", "Goal-to-goal penalty", "Both red card and goal-to-goal penalty"],
    },
    {
      key: "kick_in_distance",
      question: "Sideline kick-in: must opponents be 2 metres or 3 metres away?",
      context: "The rulebook's Out of bounds page says 3 metres; the organisers flagged this as unresolved.",
      options: ["2 metres", "3 metres"],
    },
    {
      key: "corner_direct_goal",
      question: "Can a goal be scored directly from a corner kick?",
      context: "The Corner kicks page repeats \"Goals cannot be scored directly from a kick-in\", which may be a copy error.",
      options: ["Yes, direct goals from corners count", "No, another player must touch the ball first"],
    },
    {
      key: "tiebreaker_order",
      question: "Confirm the tie-breaker order for teams level on points.",
      context: "Proposed: goal difference, goals scored, head-to-head, then organiser decision. Until confirmed, tied teams share a position and knockout seeding is blocked.",
      options: [],
    },
    {
      key: "suspension_rules",
      question: "Confirm suspension rules (red card and yellow card accumulation).",
      context: "The rulebook defines in-match timeouts (2 minutes for a sliding tackle, 4 minutes for aggression to referees) but not whether cards carry a ban for later matches.",
      options: ["No suspensions beyond the match", "Red card: miss the next match", "Custom"],
    },
    {
      key: "team_count",
      question: "Confirm the final number of teams (6 or 7).",
      context: "Placeholder teams were created so fixtures can be planned. Rename them, or add or remove teams, once registration closes.",
      options: ["6 teams", "7 teams"],
    },
    {
      key: "announcement_length",
      question: "How long is the opening rules announcement?",
      context: "A provisional 10-minute block (5:00 to 5:10 PM) is reserved in settings. Adjust it once confirmed.",
      options: [],
    },
    {
      key: "knockout_tiebreak",
      question: "How are drawn knockout matches decided (penalty shootout kicks per team, sudden death)?",
      context: "The rulebook describes goal-to-goal penalties during play but not shootouts.",
      options: [],
    },
    {
      key: "min_players_to_start",
      question: "What is the minimum number of players a team needs to start a match?",
      context: "Not stated in the rulebook. Also decide the forfeit score if a team cannot field enough players.",
      options: [],
    },
  ],
};

export const TEMPLATES: TournamentTemplate[] = [avatarFootballLeague];

export function getTemplate(key: string | null | undefined) {
  return TEMPLATES.find((t) => t.key === key) ?? null;
}
