const mockReportError = jest.fn()
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))
jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => mockLogger,
}))

import handle, { metadata } from '../workers/status-poller'

const ORG = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'

type Tx = { id: string; organizationId: string; tenantId: string; unifiedStatus: string }

function tx(id: string, status = 'pending'): Tx {
  return { id, organizationId: ORG, tenantId: TENANT, unifiedStatus: status }
}

function build(transactions: Tx[], getPaymentStatus = jest.fn()) {
  const service = {
    listTransactionsForStatusPolling: jest.fn().mockResolvedValue(transactions),
    getPaymentStatus,
  }
  const ctx = { resolve: jest.fn().mockReturnValue(service) }
  return { service, ctx }
}

function run(payload: Record<string, unknown>, ctx: unknown) {
  const job = { id: 'job-1', payload, createdAt: new Date().toISOString() }
  return handle(job as never, ctx as never)
}

describe('gateway_tpay status poller', () => {
  beforeEach(() => jest.clearAllMocks())

  it('declares worker metadata owned by the gateway_tpay module', () => {
    expect(metadata.queue).toBe('gateway-tpay-status-poller')
    expect(metadata.id).toBe('gateway_tpay:status-poller')
    expect(metadata.concurrency).toBe(2)
    expect(metadata.id.split(':')[0]).toBe('gateway_tpay')
  })

  it('reads scope from the scheduler payload and forces the tpay provider key', async () => {
    const { service, ctx } = build([])
    await run({ scope: { organizationId: ORG, tenantId: TENANT }, providerKey: 'other' }, ctx)
    expect(ctx.resolve).toHaveBeenCalledWith('paymentGatewayService')
    expect(service.listTransactionsForStatusPolling).toHaveBeenCalledWith({
      providerKey: 'tpay',
      organizationId: ORG,
      tenantId: TENANT,
      limit: 100,
    })
  })

  it('falls back to top-level organizationId and tenantId', async () => {
    const { service, ctx } = build([])
    await run({ organizationId: ORG, tenantId: TENANT }, ctx)
    expect(service.listTransactionsForStatusPolling).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, tenantId: TENANT }),
    )
  })

  it('defaults the limit and clamps invalid values', async () => {
    const { service, ctx } = build([])
    await run({ organizationId: ORG, tenantId: TENANT, limit: 25 }, ctx)
    await run({ organizationId: ORG, tenantId: TENANT, limit: 500 }, ctx)
    await run({ organizationId: ORG, tenantId: TENANT, limit: 0 }, ctx)
    await run({ organizationId: ORG, tenantId: TENANT, limit: 'abc' }, ctx)
    const limits = service.listTransactionsForStatusPolling.mock.calls.map(([arg]) => arg.limit)
    expect(limits).toEqual([25, 100, 100, 100])
  })

  it('does nothing and warns when scope is missing or invalid', async () => {
    const { service, ctx } = build([])
    await run({}, ctx)
    await run({ scope: { organizationId: 'nope', tenantId: TENANT } }, ctx)
    await run({ organizationId: ORG }, ctx)
    expect(service.listTransactionsForStatusPolling).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledTimes(3)
  })

  it('isolates per-item failures and reports them', async () => {
    const boom = new Error('provider down')
    const getPaymentStatus = jest
      .fn()
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce({ status: 'captured' })
    const { ctx } = build([tx('a'), tx('b')], getPaymentStatus)
    await run({ organizationId: ORG, tenantId: TENANT }, ctx)
    expect(getPaymentStatus).toHaveBeenCalledTimes(2)
    expect(getPaymentStatus).toHaveBeenCalledWith('b', { organizationId: ORG, tenantId: TENANT })
    expect(mockReportError).toHaveBeenCalledWith(boom, {
      module: 'gateway_tpay',
      code: 'gateway_tpay.status_poll_failed',
    })
    expect(mockLogger.warn).toHaveBeenCalledWith('Tpay status poll failed', { transactionId: 'a' })
  })

  it('logs a summary with scanned, changed and failed counts', async () => {
    const getPaymentStatus = jest
      .fn()
      .mockResolvedValueOnce({ status: 'captured' })
      .mockResolvedValueOnce({ status: 'pending' })
      .mockRejectedValueOnce(new Error('x'))
    const { ctx } = build([tx('a'), tx('b'), tx('c')], getPaymentStatus)
    await run({ organizationId: ORG, tenantId: TENANT }, ctx)
    expect(mockLogger.info).toHaveBeenCalledWith('Tpay reconciliation run finished', {
      scanned: 3,
      changed: 1,
      failed: 1,
      organizationId: ORG,
      tenantId: TENANT,
    })
  })
})
