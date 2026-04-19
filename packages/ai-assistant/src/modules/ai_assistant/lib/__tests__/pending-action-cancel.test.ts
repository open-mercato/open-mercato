import type { AwilixContainer } from 'awilix'
import {
  executePendingActionCancel,
  PENDING_ACTION_CANCELLED_EVENT_ID,
  PENDING_ACTION_EXPIRED_EVENT_ID,
} from '../pending-action-cancel'
import type { AiPendingAction } from '../../data/entities'

function makeAction(overrides: Partial<AiPendingAction> = {}): AiPendingAction {
  return {
    id: 'pa_1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    agentId: 'catalog.merchandising_assistant',
    toolName: 'catalog.update_product',
    status: 'pending',
    fieldDiff: [],
    records: null,
    failedRecords: null,
    sideEffectsSummary: null,
    recordVersion: 'v-1',
    attachmentIds: [],
    normalizedInput: { productId: 'p-1', patch: { title: 'New' } },
    queueMode: 'inline',
    executionResult: null,
    targetEntityType: 'product',
    targetRecordId: 'p-1',
    conversationId: null,
    idempotencyKey: 'idem_1',
    createdByUserId: 'user-1',
    createdAt: new Date('2026-04-18T10:00:00.000Z'),
    expiresAt: new Date('2026-04-18T11:00:00.000Z'),
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  } as unknown as AiPendingAction
}

function makeRepoStub(initialRow: AiPendingAction) {
  let row = { ...initialRow } as AiPendingAction & Record<string, unknown>
  const setStatus = jest.fn(
    async (_id: string, nextStatus: string, _scope: unknown, extra?: Record<string, unknown>) => {
      row = {
        ...row,
        status: nextStatus as never,
      }
      if (extra && 'executionResult' in extra) {
        row.executionResult = (extra.executionResult ?? null) as never
      }
      if (extra && 'resolvedByUserId' in extra) {
        row.resolvedByUserId = extra.resolvedByUserId as never
      }
      row.resolvedAt = ((extra?.now as Date | undefined) ?? new Date()) as never
      return row as AiPendingAction
    },
  )
  return {
    setStatus,
    get current() {
      return row
    },
  }
}

function makeCtx() {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: {
      resolve: (name: string) => {
        if (name === 'em') return {}
        if (name === 'eventBus') return { emitEvent: async () => {} }
        throw new Error(`unknown dep ${name}`)
      },
    } as unknown as AwilixContainer,
  }
}

describe('executePendingActionCancel', () => {
  it('atomically transitions pending → cancelled and emits ai.action.cancelled', async () => {
    const repo = makeRepoStub(makeAction())
    const eventBus = { emitEvent: jest.fn().mockResolvedValue(undefined) }
    const clock = new Date('2026-04-18T10:05:00.000Z')

    const result = await executePendingActionCancel({
      action: makeAction(),
      ctx: makeCtx(),
      reason: 'Customer asked to abort',
      repo: repo as unknown as never,
      eventBus,
      now: clock,
    })

    expect(result.status).toBe('cancelled')
    expect(result.row.status).toBe('cancelled')
    expect(repo.setStatus).toHaveBeenCalledTimes(1)
    const [, nextStatus, , extra] = repo.setStatus.mock.calls[0]
    expect(nextStatus).toBe('cancelled')
    expect(extra).toMatchObject({
      resolvedByUserId: 'user-1',
      executionResult: {
        error: { code: 'cancelled_by_user', message: 'Customer asked to abort' },
      },
    })
    expect(eventBus.emitEvent).toHaveBeenCalledTimes(1)
    expect(eventBus.emitEvent.mock.calls[0][0]).toBe(PENDING_ACTION_CANCELLED_EVENT_ID)
  })

  it('defaults to "Cancelled by user" message when no reason is supplied', async () => {
    const repo = makeRepoStub(makeAction())
    const eventBus = { emitEvent: jest.fn().mockResolvedValue(undefined) }
    const clock = new Date('2026-04-18T10:05:00.000Z')

    const result = await executePendingActionCancel({
      action: makeAction(),
      ctx: makeCtx(),
      repo: repo as unknown as never,
      eventBus,
      now: clock,
    })

    expect(result.status).toBe('cancelled')
    const [, , , extra] = repo.setStatus.mock.calls[0]
    expect(extra).toMatchObject({
      executionResult: {
        error: { code: 'cancelled_by_user', message: 'Cancelled by user' },
      },
    })
  })

  it('idempotent: already-cancelled action returns row without calling setStatus or emitting', async () => {
    const cancelledAction = makeAction({ status: 'cancelled' as never })
    const repo = makeRepoStub(cancelledAction)
    const eventBus = { emitEvent: jest.fn().mockResolvedValue(undefined) }

    const result = await executePendingActionCancel({
      action: cancelledAction,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      eventBus,
    })

    expect(result.status).toBe('cancelled')
    expect(result.row).toBe(cancelledAction)
    expect(repo.setStatus).not.toHaveBeenCalled()
    expect(eventBus.emitEvent).not.toHaveBeenCalled()
  })

  it('expired short-circuit: flips to expired and emits ai.action.expired', async () => {
    const expiredAction = makeAction({
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    })
    const repo = makeRepoStub(expiredAction)
    const eventBus = { emitEvent: jest.fn().mockResolvedValue(undefined) }
    const clock = new Date('2026-04-18T10:05:00.000Z')

    const result = await executePendingActionCancel({
      action: expiredAction,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      eventBus,
      now: clock,
    })

    expect(result.status).toBe('expired')
    expect(result.row.status).toBe('expired')
    expect(repo.setStatus).toHaveBeenCalledTimes(1)
    const [, nextStatus] = repo.setStatus.mock.calls[0]
    expect(nextStatus).toBe('expired')
    expect(eventBus.emitEvent).toHaveBeenCalledTimes(1)
    expect(eventBus.emitEvent.mock.calls[0][0]).toBe(PENDING_ACTION_EXPIRED_EVENT_ID)
  })

  it('swallows event-bus errors without failing the cancel', async () => {
    const repo = makeRepoStub(makeAction())
    const eventBus = {
      emitEvent: jest.fn().mockRejectedValue(new Error('bus down')),
    }
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const clock = new Date('2026-04-18T10:05:00.000Z')

    const result = await executePendingActionCancel({
      action: makeAction(),
      ctx: makeCtx(),
      repo: repo as unknown as never,
      eventBus,
      now: clock,
    })

    expect(result.status).toBe('cancelled')
    expect(consoleWarnSpy).toHaveBeenCalled()
    consoleWarnSpy.mockRestore()
  })
})
