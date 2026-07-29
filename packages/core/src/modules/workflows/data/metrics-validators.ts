import { z } from 'zod'
import { WORKFLOW_ROLLUP_WINDOW_KEYS } from '../lib/metrics/definition-metrics'

/**
 * Shape of `workflow_definition_metric_rollups.metrics`.
 *
 * Every stored row is re-validated on read: a row written by an older build is
 * rejected rather than trusted, and the read route falls back to live compute —
 * the same fail-safe `agent_orchestrator`'s metrics routes use. New keys MUST
 * therefore be added as `.optional()` so pre-upgrade rows keep parsing, with
 * readers treating a missing key as "this rollup has nothing to say about that
 * metric" rather than as zero.
 */
export const workflowDefinitionMetricsSchema = z.object({
  runsStarted: z.number().int().nonnegative(),
  runsTerminal: z.number().int().nonnegative(),
  runsCompleted: z.number().int().nonnegative(),
  runsFailed: z.number().int().nonnegative(),
  runsCancelled: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1).nullable(),
  durationSampleCount: z.number().int().nonnegative(),
  avgDurationMs: z.number().nonnegative().nullable(),
  p50DurationMs: z.number().nonnegative().nullable(),
  p95DurationMs: z.number().nonnegative().nullable(),
  tasksWithDeadline: z.number().int().nonnegative(),
  tasksMetDeadline: z.number().int().nonnegative(),
  taskSlaHitRate: z.number().min(0).max(1).nullable(),
})

export const workflowRollupWindowSchema = z.enum(
  WORKFLOW_ROLLUP_WINDOW_KEYS as [string, ...string[]],
)

/**
 * Query contract for `GET /api/workflows/metrics/definitions`.
 *
 * `workflowIds` is a comma-separated list because the caller is a list page
 * asking about the rows it has on screen, exactly like the mirrored
 * `/api/agent_orchestrator/metrics/agents?ids=` batch route.
 */
export const workflowDefinitionMetricsQuerySchema = z.object({
  window: workflowRollupWindowSchema.default('7d'),
  workflowIds: z.string().min(1),
})

export type WorkflowDefinitionMetricsPayload = z.infer<typeof workflowDefinitionMetricsSchema>
