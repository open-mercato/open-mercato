import type { AutoDispositionBlock, ProposalOption } from '../../data/validators'
import { rankProposalOptions } from '../../data/proposalEnvelope'

/**
 * The auto-approval POLICY.
 *
 * Auto-approval used to be a single comparison: `confidence >= threshold`. But
 * confidence is the model's evidence about ITSELF. It knows nothing about how
 * damaging the action is, whether the guardrails passed, whether the run left a
 * trace anyone can audit, or what the tenant has decided it is willing to have
 * done unattended.
 *
 * **Confidence is evidence, not authorization.** This module is the one place
 * that turns evidence into a decision, and it takes every input that decision
 * actually depends on.
 *
 * Pure and dependency-free: no ORM, no container, no clock. The disposition
 * service gathers the inputs; this decides.
 */

/**
 * How much damage the proposed action can do if it is wrong.
 *
 * Declared, never inferred from a command id: guessing "delete" is high-risk from
 * a substring gets the interesting cases exactly backwards — a `notify` that
 * emails ten thousand customers is not low risk, and a `deleteDraft` is not high.
 * An undeclared risk is `medium`, which is the conservative reading of "nobody
 * said".
 */
export const ACTION_RISK_TIERS = ['low', 'medium', 'high'] as const
export type ActionRisk = (typeof ACTION_RISK_TIERS)[number]

const RISK_ORDER: Record<ActionRisk, number> = { low: 0, medium: 1, high: 2 }

export const DEFAULT_ACTION_RISK: ActionRisk = 'medium'

/**
 * The tenant's standing decision about unattended action.
 *
 * `maxAutoApproveRisk` defaults to `medium`: a tenant that has said nothing has
 * not consented to unattended high-risk writes, and reading silence as consent is
 * the failure this layer exists to prevent.
 */
export type TenantAutoApprovalPolicy = {
  /** Master switch. `false` sends every proposal to a human regardless of anything else. */
  enabled: boolean
  maxAutoApproveRisk: ActionRisk
}

export const DEFAULT_TENANT_AUTO_APPROVAL_POLICY: TenantAutoApprovalPolicy = {
  enabled: true,
  maxAutoApproveRisk: 'medium',
}

/**
 * Disposition config carried verbatim from the INVOKE_AGENT node's `onResult`.
 * `alwaysAsk` always routes to a human; otherwise a confidence threshold plus an
 * optional separation MARGIN is ONE of the policy's inputs — no longer the whole
 * policy.
 */
export type DispositionOnResult =
  | { autoApproveThreshold: number; autoApproveMargin?: number }
  | { alwaysAsk: true }

export type AutoApprovalInput = {
  options: readonly ProposalOption[]
  onResult: DispositionOnResult
  /**
   * Overrides the risk declared on the leading option's actions. For a caller
   * that knows more than the declaration; absent means the option's own.
   */
  actionRisk?: ActionRisk
  /** False when any guardrail check on this run did not pass. */
  guardrailsPassed?: boolean
  /**
   * Whether the run left a trace an auditor can read. A run nobody can review
   * after the fact must not act unattended: that combination is precisely an
   * unaccountable mutation.
   */
  traceComplete?: boolean
  tenantPolicy?: TenantAutoApprovalPolicy
}

/**
 * The risk of an option — the HIGHEST risk among the actions its plan runs.
 *
 * A plan is a conjunction: every action in the chosen option happens, so the
 * option is exactly as dangerous as its most dangerous step. Taking the lowest,
 * or an average, would let one safe action launder an unsafe one.
 */
export function optionActionRisk(option: ProposalOption): ActionRisk {
  let highest: ActionRisk = 'low'
  for (const action of option.actions) {
    const risk = (action as { risk?: ActionRisk }).risk ?? DEFAULT_ACTION_RISK
    if (RISK_ORDER[risk] > RISK_ORDER[highest]) highest = risk
  }
  return option.actions.length === 0 ? DEFAULT_ACTION_RISK : highest
}

export type AutoApprovalDecision =
  | { kind: 'approve'; option: ProposalOption }
  | { kind: 'review'; block: AutoDispositionBlock | null }

/**
 * Decides whether a proposal may be applied without a human.
 *
 * The order is FAIL-CLOSED and load-bearing at every step:
 *
 * 1. `alwaysAsk` short-circuits first. Dropping it makes every `alwaysAsk: true`
 *    node start auto-approving, which is the worst regression this module can
 *    produce.
 * 2. The tenant switch, then the guardrail verdict, then trace completeness, then
 *    the risk of the option that would actually run — every gate that does not
 *    depend on the model's own opinion is answered BEFORE the model's opinion is
 *    consulted. A high-confidence proposal to do something the tenant forbids is
 *    still forbidden.
 * 3. A missing confidence fails closed to a human, never to approval.
 * 4. Threshold, then margin. The margin exists because a 0.81/0.80 split under an
 *    0.8 threshold is the agent saying it cannot tell its top two apart; reading
 *    that as certainty is how an auto-approved wrong answer happens. It defaults
 *    to 0, which is the historic rule exactly.
 *
 * A `block` is recorded only when the proposal CLEARED the bar it was measured
 * against and was held anyway — silence would otherwise read as the threshold
 * simply not being met. `null` means "did not clear", which needs no explanation.
 */
export function evaluateAutoApproval(input: AutoApprovalInput): AutoApprovalDecision {
  const { options, onResult } = input
  const policy = input.tenantPolicy ?? DEFAULT_TENANT_AUTO_APPROVAL_POLICY

  if ('alwaysAsk' in onResult) return { kind: 'review', block: null }
  if (options.length === 0) return { kind: 'review', block: null }

  if (!policy.enabled) return { kind: 'review', block: 'policy' }
  if (input.guardrailsPassed === false) return { kind: 'review', block: 'guardrail' }
  if (input.traceComplete === false) return { kind: 'review', block: 'trace_incomplete' }

  const ranked = rankProposalOptions(options)
  const [top, runnerUp] = ranked

  // Risk is a property of the OPTION that would actually run, so it is weighed
  // against the leading one rather than the set. An explicit `actionRisk` from
  // the caller wins — it is how a caller that knows more than the declaration
  // (a resolved command catalogue, say) raises the tier.
  const risk = input.actionRisk ?? optionActionRisk(top)
  if (RISK_ORDER[risk] > RISK_ORDER[policy.maxAutoApproveRisk]) {
    return { kind: 'review', block: 'risk' }
  }

  if (typeof top.confidence !== 'number') return { kind: 'review', block: null }
  if (top.confidence < onResult.autoApproveThreshold) return { kind: 'review', block: null }
  const margin = onResult.autoApproveMargin ?? 0
  if (runnerUp && top.confidence - (runnerUp.confidence ?? 0) < margin) {
    return { kind: 'review', block: 'near_tie' }
  }
  return { kind: 'approve', option: top }
}

/** The option auto-approval would run, or null when a human must decide. */
export function autoApprovable(input: AutoApprovalInput): ProposalOption | null {
  const decision = evaluateAutoApproval(input)
  return decision.kind === 'approve' ? decision.option : null
}
