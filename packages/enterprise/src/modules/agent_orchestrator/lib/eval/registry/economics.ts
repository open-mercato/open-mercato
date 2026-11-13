import { z } from 'zod'
import type { ScorerDefinition, ScorerRunView } from '../types'
import { SKIP_REASON, skipped } from '../types'
import { baseConfigSchema, compareThreshold, directionSchema } from './shared'

const I18N = 'agent_orchestrator.evalAssertions.scorer'

/**
 * Run-economics scorers. Every one carries an explicit `direction` — DeepEval's
 * BiasMetric taught the industry that an implicit "threshold is a maximum here but
 * a minimum everywhere else" convention is a reliable source of inverted gates.
 */
function thresholdScorer(
  scorerKey: string,
  defaults: { threshold: number; direction: 'gte' | 'lte' },
  read: (run: ScorerRunView) => number | null,
  unitHintKey: string,
): ScorerDefinition<ThresholdConfig> {
  return {
    scorerKey,
    labelKey: `${I18N}.${scorerKey}`,
    group: 'economics',
    kind: 'deterministic',
    configSchema: thresholdConfig,
    fields: [
      {
        name: 'threshold',
        kind: 'number',
        labelKey: `${I18N}.${scorerKey}.field.threshold`,
        hintKey: unitHintKey,
        min: 0,
        required: true,
        default: defaults.threshold,
      },
      {
        name: 'direction',
        kind: 'select',
        labelKey: `${I18N}.field.direction`,
        default: defaults.direction,
        options: [
          { value: 'lte', labelKey: `${I18N}.direction.lte` },
          { value: 'gte', labelKey: `${I18N}.direction.gte` },
        ],
      },
    ],
    needsExpected: () => false,
    score: (run, _expected, config) => {
      const actual = read(run)
      if (actual === null) {
        // The run never recorded this measurement (e.g. a run with no latency
        // stamp). Not a failure of the agent — skip.
        return skipped(SKIP_REASON.notApplicable, { reason: `run has no ${scorerKey} measurement` })
      }
      const passed = compareThreshold(actual, config.threshold, config.direction)
      return {
        passed,
        score: passed ? 1 : 0,
        evidence: { actual, threshold: config.threshold, direction: config.direction },
      }
    },
  }
}

const thresholdConfig = baseConfigSchema.extend({
  threshold: z.number().min(0),
  direction: directionSchema.default('lte'),
})
export type ThresholdConfig = z.infer<typeof thresholdConfig>

export const latency = thresholdScorer(
  'latency',
  { threshold: 30_000, direction: 'lte' },
  (run) => run.latencyMs,
  `${I18N}.latency.field.threshold.hint`,
)

export const cost = thresholdScorer(
  'cost',
  { threshold: 100, direction: 'lte' },
  (run) => run.costMinor,
  `${I18N}.cost.field.threshold.hint`,
)

export const stepCount = thresholdScorer(
  'step_count',
  { threshold: 20, direction: 'lte' },
  (run) => run.stepCount,
  `${I18N}.step_count.field.threshold.hint`,
)

export const economicsScorers = [latency, cost, stepCount] as const
