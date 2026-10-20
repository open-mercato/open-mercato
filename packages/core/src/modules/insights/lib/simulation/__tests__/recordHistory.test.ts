const findFieldHistory = jest.fn()
const constructed: unknown[][] = []

jest.mock('@open-mercato/core/modules/audit_logs/services/actionLogService', () => ({
  ActionLogService: jest.fn().mockImplementation((...args: unknown[]) => {
    constructed.push(args)
    return { findFieldHistory: (...callArgs: unknown[]) => findFieldHistory(...callArgs) }
  }),
}))

import { createRecordHistoryReader } from '../context'

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

function historyEntry(overrides: Record<string, unknown> = {}) {
  return {
    logId: 'log-1',
    at: '2026-10-01T10:00:00.000Z',
    cursorAt: '2026-10-01T10:00:00.000000Z',
    commandId: 'catalog.prices.update',
    actionType: 'edit',
    executionState: 'done',
    actorUserId: 'user-1',
    resourceKind: 'catalog.price',
    resourceId: 'price-1',
    changedFields: ['unitPriceNet'],
    snapshotBefore: { unitPriceNet: '10.0000' },
    snapshotAfter: { unitPriceNet: '12.0000' },
    changes: null,
    causeKind: 'user',
    causeId: null,
    organizationId: SCOPE.organizationId,
    actionLabel: null,
    onBehalfOfUserId: null,
    parentResourceKind: null,
    parentResourceId: null,
    correlationId: null,
    causedByLogId: null,
    causation: null,
    historyAction: 'undo',
    sourceLogId: null,
    actorKind: 'user',
    ...overrides,
  }
}

describe('simulation record history reader (readRecordHistory)', () => {
  beforeEach(() => {
    findFieldHistory.mockReset()
    constructed.length = 0
  })

  it('reads one record of the run organization only, newest first, with the encryption service and the undo marker', async () => {
    const em = { marker: 'trx' }
    const encryption = { marker: 'encryption' }
    findFieldHistory.mockResolvedValueOnce({ entries: [historyEntry()], nextBefore: { at: '2026-10-01T10:00:00.000000Z', id: 'log-1' } })
    const read = createRecordHistoryReader(em as never, encryption as never, SCOPE)
    const page = await read({ resourceKinds: ['catalog.price', 'catalog.price', ''], resourceId: ' price-1 ', before: null, limit: 100 })
    expect(constructed[0]).toEqual([em, encryption])
    expect(findFieldHistory).toHaveBeenCalledWith({
      tenantId: SCOPE.tenantId,
      organizationIds: [SCOPE.organizationId],
      resourceKinds: ['catalog.price'],
      resourceId: 'price-1',
      before: null,
      limit: 100,
    })
    expect(page.nextBefore).toEqual({ at: '2026-10-01T10:00:00.000000Z', id: 'log-1' })
    expect(page.entries[0]).toEqual(expect.objectContaining({ logId: 'log-1', historyAction: 'undo', snapshotAfter: { unitPriceNet: '12.0000' }, organizationId: SCOPE.organizationId }))
    expect(page.entries[0]).not.toHaveProperty('cursorAt')
  })

  it('reads nothing for an empty resource id or resource kind list', async () => {
    const read = createRecordHistoryReader({} as never, undefined, SCOPE)
    await expect(read({ resourceKinds: [], resourceId: 'price-1', before: null, limit: 10 })).resolves.toEqual({ entries: [], nextBefore: null })
    await expect(read({ resourceKinds: ['catalog.price'], resourceId: '  ', before: null, limit: 10 })).resolves.toEqual({ entries: [], nextBefore: null })
    expect(findFieldHistory).not.toHaveBeenCalled()
  })
})
