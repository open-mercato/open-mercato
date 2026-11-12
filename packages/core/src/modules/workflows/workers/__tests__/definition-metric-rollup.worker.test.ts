/**
 * KPI rollup worker wiring (spec §8.5).
 *
 * The arithmetic and the idempotency of the pass itself are covered by
 * `lib/__tests__/metrics-rollup-service.test.ts`; this file covers the two
 * things only the worker can get wrong — the queue contract the generator
 * reads, and refusing a job whose scope is missing.
 */

const writeRollupsForScope = jest.fn()
jest.mock('../../lib/metrics/rollup-service', () => ({
  writeRollupsForScope: (...args: unknown[]) => writeRollupsForScope(...args),
}))

const mockEm = {}
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => (name === 'em' ? mockEm : null),
  })),
}))

import handle, { metadata } from '../workflow-definition-metric-rollup.worker'
import {
  WORKFLOW_DEFINITION_METRIC_ROLLUP_INTERVAL,
  WORKFLOW_DEFINITION_METRIC_ROLLUP_QUEUE,
} from '../../lib/metrics/rollup-schedule'
import { WORKFLOW_ROLLUP_BUCKET_MS } from '../../lib/metrics/definition-metrics'

const tenantId = 'tenant-1'
const organizationId = 'org-1'

function job(payload: unknown) {
  return { id: 'job-1', payload } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  writeRollupsForScope.mockResolvedValue({ workflowIds: 2, written: 6 })
})

describe('worker metadata', () => {
  test('declares the queue the schedule targets, and single concurrency', () => {
    // The queue name is spelled as a literal in the worker (the generator's AST
    // extractor cannot resolve an imported one) and as a constant in the
    // schedule module. This assertion is what keeps the duplication from
    // drifting into a schedule that enqueues onto a queue nobody consumes.
    expect(metadata.queue).toBe(WORKFLOW_DEFINITION_METRIC_ROLLUP_QUEUE)
    expect(metadata.id).toBe('workflows:definition-metric-rollup')
    expect(metadata.concurrency).toBe(1)
  })

  test('the schedule interval matches the rollup bucket', () => {
    // Ticking faster than the bucket only rewrites identical rows; ticking
    // slower leaves buckets with no row for the read route to find.
    const intervalSeconds = Number.parseInt(WORKFLOW_DEFINITION_METRIC_ROLLUP_INTERVAL, 10)
    expect(intervalSeconds * 1000).toBe(WORKFLOW_ROLLUP_BUCKET_MS)
  })
})

describe('handler', () => {
  test('runs the pass for the nested scheduler scope', async () => {
    await handle(job({ scope: { tenantId, organizationId } }), {} as never)

    expect(writeRollupsForScope).toHaveBeenCalledWith(mockEm, { tenantId, organizationId })
  })

  test('accepts the flattened scope the scheduler also adds at the top level', async () => {
    await handle(job({ tenantId, organizationId }), {} as never)

    expect(writeRollupsForScope).toHaveBeenCalledWith(mockEm, { tenantId, organizationId })
  })

  test('the nested scope wins when both shapes are present', async () => {
    await handle(
      job({ scope: { tenantId, organizationId }, tenantId: 'other', organizationId: 'other' }),
      {} as never,
    )

    expect(writeRollupsForScope).toHaveBeenCalledWith(mockEm, { tenantId, organizationId })
  })

  test('refuses a job with no organization rather than widening the pass', async () => {
    // A rollup without an organization would fold several organizations' runs
    // into one row, which no read scope could ever unpick.
    await handle(job({ scope: { tenantId } }), {} as never)
    await handle(job({ scope: { organizationId } }), {} as never)
    await handle(job(undefined), {} as never)

    expect(writeRollupsForScope).not.toHaveBeenCalled()
  })
})
