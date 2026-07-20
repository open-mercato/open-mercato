import { z } from 'zod'
import type { ScorerDefinition } from '../types'
import { skipped } from '../types'
import { judgeRubricSchema } from '../judgeRubric'
import { baseConfigSchema } from './shared'

const I18N = 'agent_orchestrator.evalAssertions.scorer'

/**
 * Accepts BOTH shapes on purpose:
 *
 * - the structured `JudgeRubric` (choice scoring, evaluation steps, sampling), and
 * - the pre-Phase-3 `{ rubric: string }` that the seeded `llm_judge_helpfulness`
 *   assertion and every user-authored judge row still hold.
 *
 * A union rather than a migration: rewriting stored rubrics would change what
 * existing judges measure. `normalizeJudgeRubric` lifts the legacy form into an
 * equivalent binary rubric at evaluation time.
 */
const judgeConfig = z.union([
  judgeRubricSchema.and(baseConfigSchema),
  baseConfigSchema.extend({ rubric: z.string().optional() }),
])

/**
 * Write-boundary schema. The read union above ends in an all-optional object that
 * accepts ANYTHING, so using it for writes made `resolveScorerForWrite`'s promised
 * 422 unreachable: a structurally broken rubric (empty `promptTemplate`, one
 * choice) fell through to the permissive branch, saved with 200, and only failed
 * silently at evaluation time forever after.
 *
 * Discriminating on which key is PRESENT — mirroring `normalizeJudgeRubric` —
 * routes a full rubric to the strict schema while still accepting the legacy form.
 */
const judgeWriteConfig = z.union([
  baseConfigSchema.extend({ rubric: z.string().min(1) }),
  judgeRubricSchema.and(baseConfigSchema),
])
export type JudgeConfig = z.infer<typeof judgeConfig>

/**
 * `llm_judge` is a first-class registry member so `GET /eval-scorers` can project
 * it and the generated form can render it — it is the registry's hardest scorer,
 * not a parallel mechanism.
 *
 * Its `score` is a deliberate no-op returning SKIPPED. A judge verdict needs an
 * async model round-trip, and `ScorerDefinition.score` is contractually a PURE,
 * SYNCHRONOUS function — that purity is what guarantees online/offline parity for
 * the deterministic tier. Judge scoring therefore runs on its own async path in
 * `lib/eval/llmJudge.ts`, which reads this definition's `configSchema` for
 * validation. Callers of the deterministic evaluator never reach this branch:
 * `evaluateRun` selects assertions by `type: 'deterministic'`.
 */
export const llmJudge: ScorerDefinition<JudgeConfig> = {
  scorerKey: 'llm_judge',
  labelKey: `${I18N}.llm_judge`,
  group: 'judge',
  kind: 'llm_judge',
  configSchema: judgeConfig,
  writeConfigSchema: judgeWriteConfig,
  fields: [
    {
      name: 'promptTemplate',
      kind: 'textarea',
      labelKey: `${I18N}.llm_judge.field.rubric`,
      hintKey: `${I18N}.llm_judge.field.rubric.hint`,
      placeholderKey: `${I18N}.llm_judge.field.rubric.placeholder`,
      required: true,
    },
    {
      name: 'threshold',
      kind: 'slider',
      labelKey: `${I18N}.llm_judge.field.threshold`,
      hintKey: `${I18N}.llm_judge.field.threshold.hint`,
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
    },
    {
      name: 'samples',
      kind: 'number',
      labelKey: `${I18N}.llm_judge.field.samples`,
      hintKey: `${I18N}.llm_judge.field.samples.hint`,
      min: 1,
      max: 9,
      step: 2,
      default: 1,
    },
    {
      name: 'requireReasoning',
      kind: 'boolean',
      labelKey: `${I18N}.llm_judge.field.requireReasoning`,
      hintKey: `${I18N}.llm_judge.field.requireReasoning.hint`,
      default: true,
    },
  ],
  needsExpected: () => false,
  score: () => skipped('unknown_scorer', { reason: 'llm_judge is scored asynchronously by the judge runner' }),
}

export const judgeScorers = [llmJudge] as const
