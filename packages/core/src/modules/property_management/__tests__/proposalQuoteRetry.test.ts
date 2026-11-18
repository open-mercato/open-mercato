/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { SalesOperation, type SalesOperationStatus } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('../lib/salesOperationAlerts', () => {
  const actual = jest.requireActual('../lib/salesOperationAlerts')
  return { ...actual, reportStalledOperation: jest.fn(async () => undefined) }
})

import { runSalesOperation, type OperationTargetHandler, type RunnerDeps } from '../lib/salesOperationRunner'
import type { SalesDispatcher } from '../lib/salesDispatcher'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

function seedQuoteOperation(em: FakeEm): SalesOperation {
  return em.seed(SalesOperation, {
    id: 'op-quote',
    ...scope,
    subjectKey: 'quote:proposal-1',
    payloadHash: 'hash',
    payload: { lines: [{ productId: 'p1' }], metadata: { propertyManagementLeaseId: 'l1' } },
    changeId: null,
    sequence: 1,
    targetType: 'lease_proposal',
    targetId: 'proposal-1',
    leaseId: 'l1',
    kind: 'quote',
    status: 'pending' as SalesOperationStatus,
    token: 'token-1',
    allowCredit: null,
    attempts: 0,
    lastError: null,
  } as never) as unknown as SalesOperation
}

function makeDispatcher(overrides: Partial<SalesDispatcher>): jest.Mocked<SalesDispatcher> {
  return {
    createOrder: jest.fn(async () => 'order-1'),
    createQuote: jest.fn(async () => 'quote-1'),
    updateDocumentStatus: jest.fn(async () => undefined),
    cancelRecurrence: jest.fn(async () => ({ status: 'cancelled', cancelEffectiveOn: null, creditMemoIds: [] })),
    readRecurrence: jest.fn(async () => null),
    findDocuments: jest.fn(async () => []),
    loadDocument: jest.fn(async () => ({ id: 'quote-1', number: 'Q-1', status: 'sent', deleted: false })),
    firstOrderLineId: jest.fn(async () => null),
    resolveStatusEntryId: jest.fn(async (value: string) => `status-${value}`),
    ...overrides,
  } as jest.Mocked<SalesDispatcher>
}

function makeHandler(): OperationTargetHandler {
  return {
    isHoldValid: jest.fn(async () => true),
    finish: jest.fn(async () => 'done' as const),
    onDone: jest.fn(async () => undefined),
    onRefused: jest.fn(async () => undefined),
    onCompensated: jest.fn(async () => undefined),
    onCompensationFailed: jest.fn(async () => undefined),
    onDuplicated: jest.fn(async () => undefined),
  }
}

function deps(em: FakeEm, dispatcher: SalesDispatcher, handler: OperationTargetHandler): RunnerDeps {
  return {
    container: { resolve: jest.fn() } as unknown as AwilixContainer,
    em: em as never,
    resolveHandler: () => handler,
    dispatcherFactory: () => dispatcher,
    enqueuer: jest.fn(async () => undefined),
    today: () => '2026-03-01',
  }
}

beforeEach(() => jest.clearAllMocks())

describe('proposal sending retry', () => {
  it('uses the quote a dispatch committed before it threw, and creates no second quote', async () => {
    const em = new FakeEm()
    const op = seedQuoteOperation(em)
    const handler = makeHandler()
    const dispatcher = makeDispatcher({
      findDocuments: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(['quote-late']),
      createQuote: jest.fn(async () => {
        throw new Error('cache invalidation failed after commit')
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('done')
    expect(dispatcher.createQuote).toHaveBeenCalledTimes(1)
    expect(dispatcher.findDocuments).toHaveBeenLastCalledWith('quote', expect.objectContaining({ operationId: op.id }))
    expect(op.salesDocumentId).toBe('quote-late')
    expect(handler.finish).toHaveBeenCalledTimes(1)
  })

  it('links the quote of an earlier attempt on retry instead of creating a second one', async () => {
    const em = new FakeEm()
    const op = seedQuoteOperation(em)
    const dispatcher = makeDispatcher({ findDocuments: jest.fn(async () => ['quote-existing']) })
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('done')
    expect(dispatcher.createQuote).not.toHaveBeenCalled()
    expect(op.salesDocumentId).toBe('quote-existing')
  })
})
