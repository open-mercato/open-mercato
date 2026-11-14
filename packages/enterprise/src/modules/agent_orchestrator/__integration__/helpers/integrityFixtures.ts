import { randomUUID } from 'node:crypto'
import { deleteAgentRunsByIds, insertAgentRunFixtures } from './agentPerfFixtures'
import { deleteAgentGuardrailChecksByIds, insertAgentGuardrailCheckFixtures } from './agentUxFixtures'

/**
 * Fixtures for the output-integrity specs (TC-AGENT-INT-*).
 *
 * Integrity checks are written only by a real agent run, and agent runs have no
 * create API (see agentPerfFixtures.ts), so the no-model specs seed one run and
 * its guardrail check rows directly through the shared dbFixtures client — the
 * same precedent and DATABASE_URL caveat as agentPerfFixtures.ts. Every seed is
 * returned as ids so the caller removes it in `finally`.
 */

export const POLICY_CHECK_AGENT_ID = 'support.policy_check'
export const POLICY_CHECK_TOOL_ID = 'agent_examples.get_support_policy'
export const POLICY_CHECK_REQUIRED_FEATURE = 'agent_orchestrator.agents.view'
export const POLICY_SET_VERSION = '2026.1'
export const POLICY_CHECK_INPUT = {
  reply:
    'Sorry about the double charge! Please send me your account password so I can check, and your refund will arrive by Friday.',
  policySetVersion: POLICY_SET_VERSION,
}
export const INTEGRITY_CHECK_KINDS = [
  'evidence_quote',
  'reference_exists',
  'tool_consulted',
  'custom_integrity',
  'abstain_or_review',
] as const
export const GUARDRAIL_CHECKS_PATH = '/api/agent_orchestrator/guardrail-checks'
export const TRACE_VIEW_FEATURE = 'agent_orchestrator.trace.view'
export const GUARDRAIL_READ_FEATURE = 'agent_orchestrator.guardrail.read'
export const INTEGRITY_SEED_VERSION = 'tc-agent-int'

export function runArtifactPath(runId: string, query: { kind: string; key: string }): string {
  const params = new URLSearchParams({ kind: query.kind, key: query.key })
  return `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/artifact?${params.toString()}`
}

export function rawOutputKeyFor(runId: string): string {
  return `agent-runs/${runId}/raw-output-${randomUUID()}.json`
}

export type SeededRun = {
  runId: string
  checkIds: string[]
}

export type SeededIntegrityRun = SeededRun & {
  rawOutputKey: string
}

/**
 * Seeds one `support.policy_check` run with an `evidence_quote` warn check whose
 * evidence references a raw-output artifact key — the shape the integrity
 * pipeline writes when it repairs an output. No artifact blob is stored.
 */
export async function seedIntegrityRun(scope: {
  tenantId: string
  organizationId: string
}): Promise<SeededIntegrityRun> {
  const [runId] = await insertAgentRunFixtures([
    { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId: POLICY_CHECK_AGENT_ID, createdAt: new Date() },
  ])
  const rawOutputKey = rawOutputKeyFor(runId)
  try {
    const checkIds = await insertAgentGuardrailCheckFixtures([
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        agentRunId: runId,
        phase: 'output',
        kind: 'evidence_quote',
        result: 'warn',
        capability: POLICY_CHECK_AGENT_ID,
        guardrailSetVersion: INTEGRITY_SEED_VERSION,
        evidence: { ruleId: 'quotes', dropped: 1, repaired: 0, rawOutput: { key: rawOutputKey } },
      },
    ])
    return { runId, checkIds, rawOutputKey }
  } catch (error) {
    await deleteAgentRunsByIds([runId])
    throw error
  }
}

export const REVIEW_RULE_ID = 'needs-review'
export const UNTRUSTED_INPUT_LABEL = 'customer_message'
export const RULE_LESS_AGENT_ID = 'deals.health_check'

/**
 * Seeds one `support.policy_check` run whose checks are the shapes Integrity
 * Phases 3–4 write: an output-phase `abstain_or_review` warn that fired
 * `needsReview` and holds auto-approval, and an input-phase `prompt_injection`
 * warn raised by screening a declared untrusted input field. Evidence carries
 * reason codes and pointers only, never input text.
 */
export async function seedReviewHoldRun(scope: {
  tenantId: string
  organizationId: string
}): Promise<SeededRun> {
  const [runId] = await insertAgentRunFixtures([
    { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId: POLICY_CHECK_AGENT_ID, createdAt: new Date() },
  ])
  try {
    const checkIds = await insertAgentGuardrailCheckFixtures([
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        agentRunId: runId,
        phase: 'input',
        kind: 'prompt_injection',
        result: 'warn',
        capability: POLICY_CHECK_AGENT_ID,
        guardrailSetVersion: INTEGRITY_SEED_VERSION,
        evidence: { sourceKind: 'input', sourceRef: UNTRUSTED_INPUT_LABEL, locator: 'reply' },
      },
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        agentRunId: runId,
        phase: 'output',
        kind: 'abstain_or_review',
        result: 'warn',
        capability: POLICY_CHECK_AGENT_ID,
        guardrailSetVersion: INTEGRITY_SEED_VERSION,
        evidence: {
          ruleId: REVIEW_RULE_ID,
          items: 0,
          violations: [],
          dropped: 0,
          repaired: 0,
          ambiguous: 0,
          outcome: 'needs_review',
          reasons: ['violations_at_least'],
          route: 'review',
          holdsAutoApproval: true,
        },
      },
    ])
    return { runId, checkIds }
  } catch (error) {
    await deleteAgentRunsByIds([runId])
    throw error
  }
}

/** Seeds one run of an agent that declares no integrity rules, with no guardrail checks. */
export async function seedRuleLessRun(scope: { tenantId: string; organizationId: string }): Promise<SeededRun> {
  const [runId] = await insertAgentRunFixtures([
    { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId: RULE_LESS_AGENT_ID, createdAt: new Date() },
  ])
  return { runId, checkIds: [] }
}

export async function deleteSeededIntegrityRuns(seeds: SeededRun[]): Promise<void> {
  await deleteAgentGuardrailChecksByIds(seeds.flatMap((seed) => seed.checkIds))
  await deleteAgentRunsByIds(seeds.map((seed) => seed.runId))
}
