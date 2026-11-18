/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { SalesOrder, SalesOrderLine } from '@open-mercato/core/modules/sales/data/entities'
import { SalesOperation, type SalesOperationStatus } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/encryptedSalesDocuments').encryptingFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('../lib/salesOperationAlerts', () => {
  const actual = jest.requireActual('../lib/salesOperationAlerts')
  return { ...actual, reportStalledOperation: jest.fn(async () => undefined) }
})

import { runSalesOperation, type OperationTargetHandler, type RunnerDeps } from '../lib/salesOperationRunner'
import { storeSalesDocument } from './support/encryptedSalesDocuments'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const CHANNEL = '33333333-3333-4333-8333-333333333333'
const COMPANY = '44444444-4444-4444-8444-444444444444'

type CreateBehaviour = 'commit' | 'commit_then_fail'

function seedOrderLine(em: FakeEm, orderId: string) {
  em.seed(SalesOrderLine, { id: `${orderId}-line-1`, ...scope, order: orderId, lineNumber: 1 } as never)
}

function salesStub(em: FakeEm, behaviour: CreateBehaviour) {
  let sequence = 0
  const execute = jest.fn(async (commandId: string, options: { input: Record<string, unknown> }) => {
    if (commandId !== 'sales.orders.create') throw new Error(`[internal] unexpected command ${commandId}`)
    sequence += 1
    const id = `order-created-${sequence}`
    storeSalesDocument(em, 'order', {
      id,
      organizationId: String(options.input.organizationId),
      tenantId: String(options.input.tenantId),
      channelId: options.input.channelId as string,
      customerEntityId: options.input.customerEntityId as string,
      createdAt: new Date(),
      metadata: options.input.metadata as Record<string, unknown>,
    })
    seedOrderLine(em, id)
    if (behaviour === 'commit_then_fail') throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' })
    return { result: { orderId: id } }
  })
  const container = { resolve: jest.fn((name: string) => (name === 'commandBus' ? { execute } : undefined)) } as unknown as AwilixContainer
  return { container, execute }
}

function seedLeaseOrderOperation(em: FakeEm, status: SalesOperationStatus = 'pending', extra: Partial<SalesOperation> = {}): SalesOperation {
  return em.seed(SalesOperation, {
    id: 'op-lease-order',
    ...scope,
    kind: 'lease_order',
    subjectKey: 'lease_order:v1',
    payloadHash: 'hash',
    payload: {
      channelId: CHANNEL,
      customerEntityId: COMPANY,
      currencyCode: 'EUR',
      metadata: { propertyManagementLeaseId: 'lease-1' },
      lines: [{ kind: 'product', productId: 'product-1', quantity: '1' }],
    },
    changeId: null,
    sequence: 1,
    targetType: 'lease_version',
    targetId: 'v1',
    leaseId: 'lease-1',
    status,
    token: 'token-1',
    allowCredit: null,
    attempts: 0,
    lastError: null,
    createdAt: new Date(Date.now() - 60_000),
    ...extra,
  } as never) as unknown as SalesOperation
}

function makeHandler(): jest.Mocked<OperationTargetHandler> {
  return {
    isHoldValid: jest.fn(async () => true),
    finish: jest.fn(async () => 'done' as const),
    onDone: jest.fn(async () => undefined),
    onRefused: jest.fn(async () => undefined),
    onCompensated: jest.fn(async () => undefined),
    onCompensationFailed: jest.fn(async () => undefined),
    onDuplicated: jest.fn(async () => undefined),
  } as jest.Mocked<OperationTargetHandler>
}

function deps(em: FakeEm, container: AwilixContainer, handler: OperationTargetHandler): RunnerDeps {
  return {
    container,
    em: em as never,
    resolveHandler: () => handler,
    enqueuer: jest.fn(async () => undefined),
    recheckEnqueuer: jest.fn(async () => undefined),
    today: () => '2026-11-18',
    dispatchTimeoutMs: 5_000,
  }
}

const originalEncryption = process.env.TENANT_DATA_ENCRYPTION

afterEach(() => {
  if (originalEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
  else process.env.TENANT_DATA_ENCRYPTION = originalEncryption
  jest.clearAllMocks()
})

describe.each([
  ['on', 'yes'],
  ['off', 'no'],
])('exactly-once billing with tenant data encryption %s', (_label, flag) => {
  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = flag
  })

  it('finds an order a failed create already committed and creates no second one', async () => {
    const em = new FakeEm()
    const op = seedLeaseOrderOperation(em)
    const { container, execute } = salesStub(em, 'commit_then_fail')
    const outcome = await runSalesOperation(deps(em, container, makeHandler()), op.id)
    expect(outcome).toBe('done')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(em.rows(SalesOrder)).toHaveLength(1)
    expect(op).toMatchObject({
      status: 'done',
      salesDocumentType: 'order',
      salesDocumentId: 'order-created-1',
      salesDocumentLineId: 'order-created-1-line-1',
    })
  })

  it('reuses the order a crashed earlier run committed instead of dispatching again', async () => {
    const em = new FakeEm()
    const op = seedLeaseOrderOperation(em)
    storeSalesDocument(em, 'order', {
      id: 'order-from-earlier-run',
      ...scope,
      channelId: CHANNEL,
      customerEntityId: COMPANY,
      createdAt: new Date(),
      metadata: { propertyManagementLeaseId: 'lease-1', propertyManagementOperationId: op.id },
    })
    seedOrderLine(em, 'order-from-earlier-run')
    const { container, execute } = salesStub(em, 'commit')
    const outcome = await runSalesOperation(deps(em, container, makeHandler()), op.id)
    expect(outcome).toBe('done')
    expect(execute).not.toHaveBeenCalled()
    expect(op.salesDocumentId).toBe('order-from-earlier-run')
    expect(op.salesDocumentLineId).toBe('order-from-earlier-run-line-1')
    expect(em.rows(SalesOrder)).toHaveLength(1)
  })

  it('reports an extra order of a finished operation as a duplicate', async () => {
    const em = new FakeEm()
    const op = seedLeaseOrderOperation(em, 'done', { salesDocumentType: 'order', salesDocumentId: 'order-kept' })
    const metadata = { propertyManagementLeaseId: 'lease-1', propertyManagementOperationId: op.id }
    const base = { ...scope, channelId: CHANNEL, customerEntityId: COMPANY, metadata }
    storeSalesDocument(em, 'order', { ...base, id: 'order-kept', createdAt: new Date(Date.now() - 30_000) })
    storeSalesDocument(em, 'order', { ...base, id: 'order-extra', createdAt: new Date() })
    storeSalesDocument(em, 'order', { ...base, id: 'order-unrelated', createdAt: new Date(), metadata: { propertyManagementOperationId: 'op-other' } })
    const handler = makeHandler()
    const { container, execute } = salesStub(em, 'commit')
    const outcome = await runSalesOperation(deps(em, container, handler), op.id)
    expect(outcome).toBe('reconciled')
    expect(handler.onDuplicated).toHaveBeenCalledWith(expect.anything(), ['order-extra'])
    expect(execute).not.toHaveBeenCalled()
  })
})
