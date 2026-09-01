/**
 * Team Agent composer DTOs (GeekClaw #72). Mirrors the Rust
 * `nomifun_api_types::team` module: a team carries a name, an optional workflow
 * template, and a roster of expert persona keys (2..=5).
 */

export interface TeamMember {
  team_member_id: string;
  team_id: string;
  /** Persona key from the UI's EXPERT_PERSONAS (e.g. "ceo"). */
  member_key: string;
  /** "lead" | "member". */
  role: string;
  created_at: number;
}

export interface Team {
  team_id: string;
  owner_user_id: string;
  name: string;
  description?: string | null;
  /** Selected workflow template key (see ui WORKFLOW_TEMPLATES). */
  workflow_template?: string | null;
  /** Expert persona keys (mirrors the Phase 1 selectedExperts set). */
  expert_keys: string[];
  /** Lifecycle: "draft" | "active" | "archived". */
  status: string;
  members: TeamMember[];
  created_at: number;
  updated_at: number;
}

export interface CreateTeamRequest {
  name: string;
  description?: string | null;
  workflow_template?: string | null;
  expert_keys: string[];
  /** Defaults to "draft" when omitted. */
  status?: string;
}

export interface UpdateTeamRequest {
  name?: string;
  description?: string | null;
  workflow_template?: string | null;
  /** Wrapped in `Some` replaces the entire roster. */
  expert_keys?: string[];
  status?: string;
}

/** A per-member system-prompt + optional display-name override sent to the
 *  consensus engine. Replaces the built-in persona lookup for that member_key. */
export interface MemberPromptOverride {
  prompt: string;
  name?: string;
}

/** #73 consensus engine request: kick off a multi-round deliberation. */
export interface StartConsensusRequest {
  topic: string;
  /** Override the loop length (defaults to 6). */
  max_rounds?: number;
  /** Optional explicit provider/model. */
  provider_id?: string;
  model?: string;
  /** Custom chairman/synthesizer system prompt (覆盖内置 SYNTHESIZER). */
  chairman_prompt?: string;
  /** Per-member system-prompt + name overrides keyed by member_key. */
  member_prompts?: Record<string, MemberPromptOverride>;
}

/** One turn in a consensus run (a member's perspective or the synthesizer). */
export interface ConsensusMessage {
  message_id: string;
  run_id: string;
  team_id: string;
  round: number;
  /** Persona key of the speaker (or "_synthesizer"). */
  speaker_member_key: string;
  /** "member" | "synthesis" | "system". */
  role: string;
  content: string;
  created_at: number;
}

/** Snapshot of a consensus run's lifecycle state. */
export interface ConsensusRun {
  run_id: string;
  team_id: string;
  /** idle | running | consensus_reached | max_rounds | cancelled | error */
  status: string;
  current_round: number;
  max_rounds: number;
  topic: string;
  provider_id?: string | null;
  model?: string | null;
  /** Final synthesizer output / error message once terminated. */
  summary?: string | null;
  started_at?: number | null;
  finished_at?: number | null;
  created_at: number;
  updated_at: number;
}

/** Pollable state for the consensus board: latest run + all messages. */
export interface ConsensusState {
  run: ConsensusRun | null;
  messages: ConsensusMessage[];
}
