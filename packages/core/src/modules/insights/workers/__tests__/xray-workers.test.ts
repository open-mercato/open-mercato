const runXrayIngestJobMock = jest.fn(async () => ({ status: 'caught_up' }))
const runXrayBackfillJobMock = jest.fn(async () => 'completed')
const failAbandonedXrayScanMock = jest.fn(async () => undefined)
const container = { resolve: jest.fn() }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => container,
}))

jest.mock('../../lib/projection/jobs', () => ({
  runXrayIngestJob: (...args: unknown[]) => runXrayIngestJobMock(...(args as [])),
  runXrayBackfillJob: (...args: unknown[]) => runXrayBackfillJobMock(...(args as [])),
  failAbandonedXrayScan: (...args: unknown[]) => failAbandonedXrayScanMock(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: jest.fn() }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

import ingestHandler, { metadata as ingestMetadata } from '../xray-ingest.worker'
import backfillHandler, { metadata as backfillMetadata, onXrayBackfillAbandoned } from '../xray-backfill.worker'
import { XRAY_BACKFILL_QUEUE, XRAY_INGEST_QUEUE } from '../../lib/projection/queue'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_ID = '22222222-0000-4000-8000-000000000001'
const SCAN_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const JOB_CONTEXT = { jobId: 'job-1', attemptNumber: 1, queueName: 'queue' }

describe('X-Ray workers', () => {
  beforeEach(() => jest.clearAllMocks())

  it('declare literal queue names matching the queue helpers and bounded concurrency', () => {
    expect(ingestMetadata).toEqual({ queue: XRAY_INGEST_QUEUE, id: 'insights:xray-ingest', concurrency: 2 })
    expect(backfillMetadata).toEqual(expect.objectContaining({ queue: XRAY_BACKFILL_QUEUE, id: 'insights:xray-backfill', concurrency: 1 }))
    expect(typeof backfillMetadata.onJobAbandoned).toBe('function')
  })

  it('runs an ingest tick for a scheduler payload and skips a payload without scope', async () => {
    await ingestHandler({ id: 'job', createdAt: '', payload: { scope: { tenantId: TENANT_ID }, tenantId: TENANT_ID, organizationId: ORG_ID } }, JOB_CONTEXT)
    expect(runXrayIngestJobMock).toHaveBeenCalledWith(container, { tenantId: TENANT_ID, organizationId: ORG_ID })
    await ingestHandler({ id: 'job', createdAt: '', payload: {} }, JOB_CONTEXT)
    expect(runXrayIngestJobMock).toHaveBeenCalledTimes(1)
  })

  it('rethrows ingest failures for the queue retry', async () => {
    runXrayIngestJobMock.mockRejectedValueOnce(new Error('db down'))
    await expect(ingestHandler({ id: 'job', createdAt: '', payload: { scope: { tenantId: TENANT_ID, organizationId: ORG_ID } } }, JOB_CONTEXT)).rejects.toThrow('db down')
  })

  it('runs a backfill slice and clears an abandoned scan', async () => {
    const payload = { scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, scanId: SCAN_ID, chainId: 'bbbbbbbb-0000-4000-8000-000000000001', progressJobId: null }
    await backfillHandler({ id: 'job', createdAt: '', payload }, JOB_CONTEXT)
    expect(runXrayBackfillJobMock).toHaveBeenCalledWith(container, { ...payload, scope: { ...payload.scope, userId: null } })
    await backfillHandler({ id: 'job', createdAt: '', payload: { scanId: 'bad' } }, JOB_CONTEXT)
    expect(runXrayBackfillJobMock).toHaveBeenCalledTimes(1)
    await onXrayBackfillAbandoned({ id: 'job', createdAt: '', payload }, { jobId: 'job', reason: 'stalled' })
    expect(failAbandonedXrayScanMock).toHaveBeenCalledWith(container, { ...payload, scope: { ...payload.scope, userId: null } }, 'stalled')
    await onXrayBackfillAbandoned({ id: 'job', createdAt: '', payload: { scanId: 'bad' } }, { jobId: 'job', reason: 'stalled' })
    expect(failAbandonedXrayScanMock).toHaveBeenCalledTimes(1)
  })
})
