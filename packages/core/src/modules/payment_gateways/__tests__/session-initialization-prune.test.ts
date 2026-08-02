import type { EntityManager } from '@mikro-orm/postgresql'

const mockEnqueue = jest.fn()

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(() => ({ enqueue: mockEnqueue })),
}))

import {
  PAYMENT_SESSION_INITIALIZATION_PRUNE_BATCH_SIZE,
  PAYMENT_SESSION_REPLAY_WINDOW_MS,
  pruneCompletedPaymentSessionInitializations,
} from '../lib/session-idempotency'
import handle, { metadata } from '../workers/session-initialization-prune'

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const ORGANIZATION_ID = '20000000-0000-4000-8000-000000000001'

type ExecuteResult = { affectedRows?: number; rowCount?: number }
type ExecuteSpy = jest.Mock<Promise<ExecuteResult>>

function makeEmStub(execute: ExecuteSpy): EntityManager {
  return {
    getConnection: () => ({ execute }),
  } as unknown as EntityManager
}

describe('payment session initialization retention (#4861)', () => {
  beforeEach(() => {
    mockEnqueue.mockReset()
  })

  it('retains completed claims through the 24-hour boundary and scopes cleanup eligibility', async () => {
    const execute: ExecuteSpy = jest.fn().mockResolvedValue({ affectedRows: 0 })
    const now = new Date('2026-08-02T12:00:00.000Z')

    const deleted = await pruneCompletedPaymentSessionInitializations(
      makeEmStub(execute),
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      { now, batchSize: 100 },
    )

    expect(deleted).toBe(0)
    expect(PAYMENT_SESSION_REPLAY_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
    expect(execute).toHaveBeenCalledTimes(1)

    const [sql, params, mode] = execute.mock.calls[0] as [string, unknown[], string]
    const normalizedSql = sql.replace(/\s+/g, ' ').trim()
    expect(normalizedSql).toContain('gateway_transaction_id is not null')
    expect(normalizedSql).toContain('tenant_id = ?')
    expect(normalizedSql).toContain('organization_id = ?')
    expect(normalizedSql).toContain('updated_at < ?')
    expect(normalizedSql).not.toContain('updated_at <= ?')
    expect(params).toEqual([
      TENANT_ID,
      ORGANIZATION_ID,
      new Date('2026-08-01T12:00:00.000Z'),
      100,
    ])
    expect(mode).toBe('run')
  })

  it('deletes at most one bounded batch per invocation', async () => {
    const execute: ExecuteSpy = jest.fn().mockResolvedValue({ affectedRows: 2 })

    const deleted = await pruneCompletedPaymentSessionInitializations(
      makeEmStub(execute),
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      { now: new Date('2026-08-02T12:00:00.000Z'), batchSize: 2 },
    )

    expect(deleted).toBe(2)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('queues a continuation after a full worker batch', async () => {
    const execute: ExecuteSpy = jest.fn().mockResolvedValue({
      affectedRows: PAYMENT_SESSION_INITIALIZATION_PRUNE_BATCH_SIZE,
    })
    const em = makeEmStub(execute) as EntityManager & { fork: () => EntityManager }
    em.fork = () => em
    const resolve = jest.fn(() => em)

    await handle(
      { payload: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID } } as never,
      { resolve } as never,
    )

    expect(execute).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith(
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      { delayMs: 1_000 },
    )
  })

  it('fails closed when the scheduled job has no complete tenant scope', async () => {
    const resolve = jest.fn()

    await handle({ payload: { tenantId: TENANT_ID } } as never, { resolve } as never)

    expect(resolve).not.toHaveBeenCalled()
  })

  it('uses a single-flight queue worker contract', () => {
    expect(metadata).toEqual({
      queue: 'payment-gateway-session-initialization-prune',
      id: 'payment_gateways:session-initialization-prune',
      concurrency: 1,
    })
  })
})
