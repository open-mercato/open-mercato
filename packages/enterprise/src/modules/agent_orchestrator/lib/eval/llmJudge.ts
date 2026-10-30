import { generateObject } from 'ai'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createModelFactory } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import { AgentRun, AgentEvalAssertion, AgentEvalResult } from '../../data/entities'
import {
  aggregateScores,
  buildJudgePrompt,
  buildVerdictSchema,
  meetsThreshold,
  normalizeJudgeRubric,
  scoreVerdict,
  type JudgeRubric,
} from './judgeRubric'
import { withRuntimeAuditWrite } from '../identity/agentWriteScope'
import { resolveEffectiveAssertions, type EvalCaseAssertionRef } from './assertionResolution'

export const judgeVerdictSchema = z.object({
  /** `null` means the judge skipped — excluded from aggregation, never a failure. */
  passed: z.boolean().nullable(),
  score: z.number().min(0).max(1).nullable(),
  feedback: z.string().default(''),
})
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>

/**
 * Scores one run output against one assertion rubric. Injectable so the worker is
 * testable without a model. `rubric` is the normalized structured rubric; the
 * legacy free-text form is lifted into a binary rubric by `normalizeJudgeRubric`.
 */
export type JudgeFn = (args: { rubric: JudgeRubric; runOutput: unknown; expected?: unknown }) => Promise<JudgeVerdict>

/**
 * The production judge: resolve a model via the shared factory and score with the
 * Vercel AI SDK in object mode. Throws if no provider is configured — the worker
 * treats that as best-effort (llm_judge is warn-only and never blocks production).
 */
export function createModelJudge(container: AwilixContainer): JudgeFn {
  return async ({ rubric, runOutput, expected }) => {
    const resolution = createModelFactory(container).resolveModel({
      moduleId: 'agent_orchestrator',
      ...(rubric.model ? { model: rubric.model } : {}),
    } as Parameters<ReturnType<typeof createModelFactory>['resolveModel']>[0])

    const schema = buildVerdictSchema(rubric)
    const prompt = buildJudgePrompt(rubric, runOutput, expected ?? null)

    // Repeat sampling MEASURES variance rather than assuming it away. Inspect's
    // guidance is temperature 0 AND a seed AND multiple epochs — a seed alone
    // buys no reproducibility guarantee from any provider.
    const scores: Array<number | null> = []
    let lastReasoning = ''
    for (let sample = 0; sample < rubric.samples; sample += 1) {
      const { object } = await generateObject({
        model: resolution.model as Parameters<typeof generateObject>[0]['model'],
        schema,
        prompt,
        temperature: rubric.temperature,
        ...(rubric.seed !== undefined ? { seed: rubric.seed + sample } : {}),
      })
      const verdict = object as Record<string, unknown>
      if (typeof verdict.reasoning === 'string') lastReasoning = verdict.reasoning
      scores.push(scoreVerdict(rubric, verdict))
    }

    const score = aggregateScores(rubric, scores)
    // A judge that skipped every sample yields no verdict — recorded as SKIPPED
    // rather than as a failure.
    if (score === null) return { passed: null, score: null, feedback: lastReasoning }
    return { passed: meetsThreshold(rubric, score), score, feedback: lastReasoning }
  }
}

function rubricFor(assertion: AgentEvalAssertion, config: unknown = assertion.config): JudgeRubric | null {
  return normalizeJudgeRubric(config, assertion.description?.trim() || assertion.title)
}

export type RunLlmJudgeResult = { judged: number; skipped: number }

/**
 * Decides whether a judge verdict may gate. A human reads a MANUAL workbench run,
 * so a rubric can decide pass/fail there; CI and online ingest pass `false` so the
 * gate tier stays deterministic and promotion reproducible. One scorer set, one
 * result shape, two policies — not two judge implementations.
 */
export type GatePolicy = { judgeMayGate: boolean }

/**
 * Ties a judge pass to one replayed eval case run. Present only on the eval plane:
 * the results carry `evalCaseRunId` so the suite aggregate sees them, the judge
 * receives the case's `expected`, and the case's assertion refs decide which judge
 * assertions apply. Absent on the online plane, where behaviour is unchanged.
 */
export type FrozenJudgeAssertion = {
  id: string
  key: string
  severity: 'gate' | 'warn'
  rubric: JudgeRubric | null
}

export type JudgeCaseLinkage = {
  evalCaseRunId: string
  expected?: unknown
  assertions?: ReadonlyArray<EvalCaseAssertionRef>
  /**
   * Judge assertions frozen in the suite's eval-set manifest. When present they
   * replace the live `AgentEvalAssertion` rows, so a replay scores against the
   * rubrics the dataset was pinned with rather than whatever is stored today.
   */
  frozenAssertions?: ReadonlyArray<FrozenJudgeAssertion>
}

async function liveJudgeTargets(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  agentId: string,
  linkage: JudgeCaseLinkage | undefined,
): Promise<FrozenJudgeAssertion[]> {
  const assertions = await em.find(AgentEvalAssertion, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    type: 'llm_judge',
    enabled: true,
    deletedAt: null,
    appliesTo: { $in: [agentId, '*'] },
  })
  if (!assertions.length) return []
  const entries = linkage
    ? resolveEffectiveAssertions(assertions, linkage.assertions ?? []).map((entry) => ({
        assertion: entry.assertion,
        config: entry.config,
        configError: Boolean(entry.configError),
      }))
    : assertions.map((assertion) => ({ assertion, config: assertion.config, configError: false }))
  return entries.map(({ assertion, config, configError }) => ({
    id: assertion.id,
    key: assertion.key,
    severity: assertion.severity,
    rubric: configError ? null : rubricFor(assertion, config),
  }))
}

/**
 * Run the enabled `llm_judge` assertions for a run and append `warn` results.
 * Idempotent: an assertion that already has a result for this run is skipped, so
 * a re-enqueued/re-ingested run is not double-judged. Always `warn` — these
 * results NEVER affect `run.evalPassed` (the judge tier cannot block production).
 * Pure over the EM + an injectable `judge`, so it is unit-testable without an LLM.
 */
export async function runLlmJudgeForRun(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  runId: string,
  judge: JudgeFn,
  policy: GatePolicy = { judgeMayGate: false },
  linkage?: JudgeCaseLinkage,
): Promise<RunLlmJudgeResult> {
  const run = await findOneWithDecryption(
    em,
    AgentRun,
    { id: runId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!run) return { judged: 0, skipped: 0 }

  const targets = linkage?.frozenAssertions
    ? [...linkage.frozenAssertions]
    : await liveJudgeTargets(em, scope, run.agentId, linkage)
  if (!targets.length) return { judged: 0, skipped: 0 }
  const caseRunLink = linkage ? { evalCaseRunId: linkage.evalCaseRunId } : {}

  const existing = await em.find(AgentEvalResult, { agentRunId: run.id, tenantId: scope.tenantId, organizationId: scope.organizationId })
  const alreadyJudged = new Set(existing.map((result) => result.assertionId))

  let judged = 0
  let skipped = 0
  for (const assertion of targets) {
    if (alreadyJudged.has(assertion.id)) {
      skipped += 1
      continue
    }
    const rubric = assertion.rubric
    if (!rubric) {
      // An unusable rubric is a config fault, recorded as SKIPPED so it stays
      // visible without ever counting as a failed assertion.
      em.persist(
        em.create(AgentEvalResult, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          agentRunId: run.id,
          ...caseRunLink,
          assertionId: assertion.id,
          assertionKey: assertion.key,
          passed: null,
          score: null,
          severity: 'warn',
          evidence: { reason: 'invalid_config' },
        }),
      )
      skipped += 1
      continue
    }

    const verdict = await judge(
      linkage ? { rubric, runOutput: run.output, expected: linkage.expected ?? null } : { rubric, runOutput: run.output },
    )
    em.persist(
      em.create(AgentEvalResult, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        agentRunId: run.id,
        ...caseRunLink,
        assertionId: assertion.id,
        assertionKey: assertion.key,
        passed: verdict.passed,
        score: verdict.score,
        // Only a plane that lets judges gate may record a judge result as `gate`.
        // Online ingest and CI never do, so a stochastic verdict can never move
        // `AgentRun.evalPassed` or a promotion decision.
        severity: policy.judgeMayGate && assertion.severity === 'gate' ? 'gate' : 'warn',
        evidence: { feedback: verdict.feedback },
      }),
    )
    judged += 1
  }
  await withRuntimeAuditWrite(() => em.flush())

  return { judged, skipped }
}
