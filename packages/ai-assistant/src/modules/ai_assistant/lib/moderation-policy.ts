/**
 * Input-moderation policy resolution.
 *
 * Resolves the effective moderation policy for an agent turn using a fixed
 * precedence (first match wins):
 *
 *   1. `agentDef.untrustedInput === true` → `enforced` (tenant cannot disable).
 *   2. Per-agent tenant override (`ai_agent_runtime_overrides` row with an
 *      `agent_id`) `input_moderation` → `on` / `off`.
 *   3. Tenant-wide override (row with `agent_id = NULL`) `input_moderation` →
 *      `on` / `off`.
 *   4. Env default `OM_AI_INPUT_MODERATION` (parsed via `parseBooleanWithDefault`)
 *      → `on` / `off`.
 *   5. Default `off`.
 *
 * Steps 4 and 5 collapse into `parseBooleanWithDefault(env, false)`.
 *
 * @see .ai/specs/2026-06-04-ai-input-moderation-and-safety-identifiers.md
 */

import type { EnvLookup } from '@open-mercato/shared/lib/ai/llm-provider'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

/** Effective runtime moderation policy for a turn. */
export type ModerationPolicy = 'enforced' | 'on' | 'off'

/** The per-agent display state shown in settings (adds `inherit`). */
export type ModerationPolicyDisplay = 'enforced' | 'on' | 'off' | 'inherit'

export interface ResolveModerationPolicyInput {
  /** Whether the agent definition marks this surface as untrusted. */
  untrustedInput?: boolean
  /**
   * `input_moderation` from the agent-scoped tenant override row, or
   * `null`/`undefined` when the row is absent or leaves it unset (inherit).
   */
  perAgentOverride?: boolean | null
  /**
   * `input_moderation` from the tenant-wide override row (`agent_id = NULL`),
   * or `null`/`undefined` when absent/unset (inherit).
   */
  tenantWideOverride?: boolean | null
  /** Env lookup; reads `OM_AI_INPUT_MODERATION`. Defaults to `process.env`. */
  env?: EnvLookup
}

/**
 * Resolves the effective moderation policy following the 5-step precedence.
 * Pure and synchronous — the runtime hydrates the override values from the DB
 * before calling this.
 */
export function resolveModerationPolicy(input: ResolveModerationPolicyInput): ModerationPolicy {
  if (input.untrustedInput === true) return 'enforced'
  if (input.perAgentOverride !== null && input.perAgentOverride !== undefined) {
    return input.perAgentOverride ? 'on' : 'off'
  }
  if (input.tenantWideOverride !== null && input.tenantWideOverride !== undefined) {
    return input.tenantWideOverride ? 'on' : 'off'
  }
  const env = input.env ?? process.env
  return parseBooleanWithDefault(env.OM_AI_INPUT_MODERATION, false) ? 'on' : 'off'
}

/** Whether a resolved policy should run the moderation gate for the turn. */
export function isModerationActive(policy: ModerationPolicy): boolean {
  return policy === 'enforced' || policy === 'on'
}

/**
 * Whether an *unavailable* moderation check (endpoint outage) should fail
 * closed (reject the turn) rather than fail open (allow it through). Per spec:
 * only `enforced` (untrusted) surfaces fail closed; opt-in `on` surfaces prefer
 * availability and fail open. Both paths log. (`off` never reaches the gate.)
 */
export function shouldFailClosed(policy: ModerationPolicy): boolean {
  return policy === 'enforced'
}
