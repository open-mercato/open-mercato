/**
 * Consumers of the run verdict: the KPI rollup, the failure-queue grouping, the
 * bulk-replay eligibility gate and the wire schema.
 */

import { describe, test, expect } from '@jest/globals'
import { buildDefinitionMetrics, type TerminalRunSample } from '../metrics/definition-metrics'
import { workflowDefinitionMetricsSchema } from '../../data/metrics-validators'
import { groupFailures, resolveFailureMessage } from '../failure-grouping'
import { canApplyBulkReplay } from '../bulk-replay'
import { WORKFLOW_RUN_OUTCOMES } from '../run-outcome'
import { workflowRunOutcomeEnumSchema } from '../../api/openapi'

const terminalAt = new Date('2026-07-30T10:00:00.000Z')
const startedAt = new Date('2026-07-30T09:59:00.000Z')

const run = (
  status: string,
  outcome: TerminalRunSample['outcome'] = null,
): TerminalRunSample => ({ status, outcome, startedAt, terminalAt })

describe('KPI rollup does not count partial_failure as success', () => {
  test('a partial failure is its own number and is excluded from successRate', () => {
    const metrics = buildDefinitionMetrics({
      runsStarted: 4,
      terminalRuns: [
        run('COMPLETED', 'success'),
        run('COMPLETED', 'partial_failure'),
        run('COMPLETED', 'partial_failure'),
        run('FAILED', 'failure'),
      ],
      completedTasks: [],
    })

    expect(metrics.runsTerminal).toBe(4)
    expect(metrics.runsCompleted).toBe(3)
    expect(metrics.runsPartialFailure).toBe(2)
    // Folded into NEITHER bucket: not added to runsFailed …
    expect(metrics.runsFailed).toBe(1)
    // … and not in the successRate numerator. 1 clean success of 4 terminal.
    expect(metrics.successRate).toBeCloseTo(0.25)
  })

  test('every run tolerating a failure drives successRate to 0, not to 100%', () => {
    const metrics = buildDefinitionMetrics({
      runsStarted: 3,
      terminalRuns: [
        run('COMPLETED', 'partial_failure'),
        run('COMPLETED', 'partial_failure'),
        run('COMPLETED', 'partial_failure'),
      ],
      completedTasks: [],
    })

    expect(metrics.successRate).toBe(0)
    expect(metrics.runsPartialFailure).toBe(3)
  })

  test('a pre-outcome COMPLETED row (null outcome) counts exactly as it did before', () => {
    const metrics = buildDefinitionMetrics({
      runsStarted: 2,
      terminalRuns: [run('COMPLETED', null), run('COMPLETED', null)],
      completedTasks: [],
    })

    expect(metrics.runsPartialFailure).toBe(0)
    expect(metrics.successRate).toBe(1)
  })

  test('success_with_warnings still counts as a success', () => {
    const metrics = buildDefinitionMetrics({
      runsStarted: 1,
      terminalRuns: [run('COMPLETED', 'success_with_warnings')],
      completedTasks: [],
    })

    expect(metrics.successRate).toBe(1)
    expect(metrics.runsPartialFailure).toBe(0)
  })

  test('a rollup row written before outcomes existed still parses', () => {
    const legacyRow = {
      runsStarted: 1,
      runsTerminal: 1,
      runsCompleted: 1,
      runsFailed: 0,
      runsCancelled: 0,
      successRate: 1,
      durationSampleCount: 1,
      avgDurationMs: 10,
      p50DurationMs: 10,
      p95DurationMs: 10,
      tasksWithDeadline: 0,
      tasksMetDeadline: 0,
      taskSlaHitRate: null,
    }

    const parsed = workflowDefinitionMetricsSchema.safeParse(legacyRow)
    expect(parsed.success).toBe(true)
    expect((parsed as { data: Record<string, unknown> }).data.runsPartialFailure).toBeUndefined()
  })

  test('a current rollup row round-trips its new key', () => {
    const metrics = buildDefinitionMetrics({
      runsStarted: 1,
      terminalRuns: [run('COMPLETED', 'partial_failure')],
      completedTasks: [],
    })
    expect(workflowDefinitionMetricsSchema.safeParse(metrics).success).toBe(true)
  })
})

describe('failure-queue grouping', () => {
  test('a partial failure carries no errorMessage but does not fall into "unclassified"', () => {
    const message = resolveFailureMessage({
      id: 'i1',
      workflowId: 'order-approval',
      status: 'COMPLETED',
      errorMessage: null,
      attentionReason: null,
      outcome: 'partial_failure',
    })
    expect(message).toBe('Completed with tolerated failures')
  })

  test('a real error message still wins over the outcome fallback', () => {
    const message = resolveFailureMessage({
      id: 'i1',
      workflowId: 'order-approval',
      status: 'FAILED',
      errorMessage: 'Payment declined',
      outcome: 'failure',
    })
    expect(message).toBe('Payment declined')
  })

  test('partial failures group together, apart from genuinely unlabelled rows', () => {
    const groups = groupFailures([
      { id: 'i1', workflowId: 'w', status: 'COMPLETED', outcome: 'partial_failure' },
      { id: 'i2', workflowId: 'w', status: 'COMPLETED', outcome: 'partial_failure' },
      { id: 'i3', workflowId: 'w', status: 'FAILED' },
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0].count).toBe(2)
    expect(groups[0].label).toBe('Completed with tolerated failures')
  })
})

describe('bulk replay agrees that partial_failure is not retryable', () => {
  test('a partial failure is refused for retry', () => {
    expect(canApplyBulkReplay('retry', 'COMPLETED', 'partial_failure')).toBe(false)
    // Even if the status gate were ever widened to COMPLETED, the verdict holds.
    expect(canApplyBulkReplay('retry', 'FAILED', 'partial_failure')).toBe(false)
  })

  test('a failed run is still retryable, with or without a recorded verdict', () => {
    expect(canApplyBulkReplay('retry', 'FAILED', 'failure')).toBe(true)
    expect(canApplyBulkReplay('retry', 'FAILED', null)).toBe(true)
    expect(canApplyBulkReplay('retry', 'FAILED')).toBe(true)
    expect(canApplyBulkReplay('retry', 'PAUSED', null)).toBe(true)
  })

  test('cancel eligibility is unchanged and ignores the verdict', () => {
    expect(canApplyBulkReplay('cancel', 'RUNNING')).toBe(true)
    expect(canApplyBulkReplay('cancel', 'RUNNING', 'partial_failure')).toBe(true)
    expect(canApplyBulkReplay('cancel', 'COMPLETED')).toBe(false)
  })
})

describe('wire schema', () => {
  test('the OpenAPI outcome enum cannot drift from the engine vocabulary', () => {
    expect(workflowRunOutcomeEnumSchema.options).toEqual([...WORKFLOW_RUN_OUTCOMES])
  })
})
