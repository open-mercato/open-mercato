import { generateObject } from 'ai'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createModelFactory } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import { AgentRun, AgentEvalAssertion, AgentEvalResult } from '../../data/entities'

export const judgeVerdictSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  feedback: z.string().default(''),
})
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>

/** Scores one run output against one assertion rubric. Injectable so the worker is testable without a model. */
export type JudgeFn = (args: { rubric: string; runOutput: unknown }) => Promise<JudgeVerdict>

/**
 * The production judge: resolve a model via the shared factory and score with the
 * Vercel AI SDK in object mode. Throws if no provider is configured — the worker
 * treats that as best-effort (llm_judge is warn-only and never blocks production).
 */
export function createModelJudge(container: AwilixContainer): JudgeFn {
  return async ({ rubric, runOutput }) => {
    const resolution = createModelFactory(container).resolveModel({ moduleId: 'agent_orchestrator' })
    const { object } = await generateObject({
      model: resolution.model as Parameters<typeof generateObject>[0]['model'],
      schema: judgeVerdictSchema,
      prompt:
        'You are an impartial evaluation judge. Decide whether the agent output satisfies the rubric.\n\n' +
        `Rubric:\n${rubric}\n\nAgent output:\n${JSON.stringify(runOutput)}\n\n` +
        'Return passed (boolean), score (0..1), and a brief feedback string.',
    })
    return judgeVerdictSchema.parse(object)
  }
}

function rubricFor(assertion: AgentEvalAssertion): string {
  const config = (assertion.config as Record<string, unknown> | null) ?? {}
  if (typeof config.rubric === 'string' && config.rubric.trim()) return config.rubric
  return assertion.description?.trim() || assertion.title
}

export type RunLlmJudgeResult = { judged: number; skipped: number }

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
): Promise<RunLlmJudgeResult> {
  const run = await findOneWithDecryption(
    em,
    AgentRun,
    { id: runId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!run) return { judged: 0, skipped: 0 }

  const assertions = await em.find(AgentEvalAssertion, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    type: 'llm_judge',
    enabled: true,
    deletedAt: null,
    appliesTo: { $in: [run.agentId, '*'] },
  })
  if (!assertions.length) return { judged: 0, skipped: 0 }

  const existing = await em.find(AgentEvalResult, { agentRunId: run.id, tenantId: scope.tenantId, organizationId: scope.organizationId })
  const alreadyJudged = new Set(existing.map((result) => result.assertionId))

  let judged = 0
  let skipped = 0
  for (const assertion of assertions) {
    if (alreadyJudged.has(assertion.id)) {
      skipped += 1
      continue
    }
    const verdict = await judge({ rubric: rubricFor(assertion), runOutput: run.output })
    em.persist(
      em.create(AgentEvalResult, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        agentRunId: run.id,
        assertionId: assertion.id,
        assertionKey: assertion.key,
        passed: verdict.passed,
        score: verdict.score,
        severity: 'warn', // llm_judge is always warn — never blocks production
        evidence: { feedback: verdict.feedback },
      }),
    )
    judged += 1
  }
  await em.flush()

  return { judged, skipped }
}
