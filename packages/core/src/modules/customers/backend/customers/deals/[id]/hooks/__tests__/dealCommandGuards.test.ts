/**
 * @jest-environment jsdom
 *
 * Phase 1 (record-locks CRM v2): deal stage-change / Won-Lost closure command
 * client-guard wiring. These deal mutations flow through the `customers/deals`
 * CRUD route (so the server-side guard is auto-covered by the record_locks
 * `crudMutationGuardService` decorator), but the hooks must (a) attach the OSS
 * lock header derived from `deal.updatedAt` and (b) route a 409 through
 * `surfaceRecordConflict` so the unified conflict bar / merge dialog renders.
 */
import { act, renderHook } from '@testing-library/react'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME, OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  withScopedApiRequestHeaders: jest.fn(async (_headers: Record<string, string>, run: () => Promise<unknown>) => run()),
  readApiResultOrThrow: jest.fn(async () => null),
}))

import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useDealPipeline } from '../useDealPipeline'
import { useDealClosure } from '../useDealClosure'
import type { DealDetailPayload, GuardedMutationRunner } from '../types'

const mockedUpdateCrud = updateCrud as jest.MockedFunction<typeof updateCrud>
const mockedSurface = surfaceRecordConflict as jest.MockedFunction<typeof surfaceRecordConflict>
const mockedFlash = flash as jest.MockedFunction<typeof flash>
const mockedWithScoped = withScopedApiRequestHeaders as jest.MockedFunction<typeof withScopedApiRequestHeaders>

const DEAL_UPDATED_AT = '2026-06-01T00:00:00.000Z'

const passthroughRunner: GuardedMutationRunner = async (operation) => operation()

function makeDeal(): DealDetailPayload {
  return {
    deal: {
      id: 'deal-1',
      title: 'Deal',
      description: null,
      status: 'open',
      pipelineStage: null,
      pipelineId: 'pipe-1',
      pipelineStageId: 'stage-1',
      valueAmount: null,
      valueCurrency: null,
      probability: null,
      expectedCloseAt: null,
      ownerUserId: null,
      source: null,
      closureOutcome: null,
      lossReasonId: null,
      lossNotes: null,
      organizationId: null,
      tenantId: null,
      createdAt: DEAL_UPDATED_AT,
      updatedAt: DEAL_UPDATED_AT,
    },
    people: [],
    companies: [],
    linkedPersonIds: [],
    linkedCompanyIds: [],
    counts: { people: 0, companies: 0 },
    customFields: {},
    viewer: null,
    pipelineStages: [],
    pipelineName: null,
    stageTransitions: [],
    owner: null,
  }
}

function conflict409(): CrudHttpError {
  return new CrudHttpError(409, { error: 'Record conflict', code: 'record_lock_conflict', conflict: { id: 'c1' } })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedUpdateCrud.mockResolvedValue({ ok: true, response: new Response(), result: {} } as never)
})

describe('useDealPipeline — stage change command guard', () => {
  test('attaches the optimistic-lock header derived from deal.updatedAt', async () => {
    const onStageChanged = jest.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useDealPipeline({
        currentDealId: 'deal-1',
        data: makeDeal(),
        runMutationWithContext: passthroughRunner,
        confirmDiscardIfDirty: async () => true,
        onStageChanged,
      }),
    )

    await act(async () => {
      await result.current.handleStageChange('stage-2')
    })

    expect(mockedWithScoped).toHaveBeenCalledTimes(1)
    expect(mockedWithScoped.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: DEAL_UPDATED_AT })
    expect(mockedUpdateCrud).toHaveBeenCalledWith('customers/deals', { id: 'deal-1', pipelineStageId: 'stage-2' })
    expect(onStageChanged).toHaveBeenCalledTimes(1)
    expect(mockedSurface).not.toHaveBeenCalled()
  })

  test('routes a 409 through surfaceRecordConflict instead of the error flash', async () => {
    mockedUpdateCrud.mockRejectedValueOnce(conflict409())
    mockedSurface.mockReturnValue(true)
    const onStageChanged = jest.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useDealPipeline({
        currentDealId: 'deal-1',
        data: makeDeal(),
        runMutationWithContext: passthroughRunner,
        confirmDiscardIfDirty: async () => true,
        onStageChanged,
      }),
    )

    await act(async () => {
      await result.current.handleStageChange('stage-2')
    })

    expect(mockedSurface).toHaveBeenCalledTimes(1)
    expect((mockedSurface.mock.calls[0][0] as CrudHttpError).status).toBe(409)
    // The error flash must NOT fire when the conflict is surfaced.
    expect(mockedFlash).not.toHaveBeenCalledWith(expect.stringContaining('Failed to update deal stage'), 'error')
  })

  test('falls back to the error flash for a non-conflict error', async () => {
    mockedUpdateCrud.mockRejectedValueOnce(new Error('boom'))
    mockedSurface.mockReturnValue(false)

    const { result } = renderHook(() =>
      useDealPipeline({
        currentDealId: 'deal-1',
        data: makeDeal(),
        runMutationWithContext: passthroughRunner,
        confirmDiscardIfDirty: async () => true,
        onStageChanged: jest.fn().mockResolvedValue(undefined),
      }),
    )

    await act(async () => {
      await result.current.handleStageChange('stage-2')
    })

    expect(mockedSurface).toHaveBeenCalledTimes(1)
    expect(mockedFlash).toHaveBeenCalledWith('Failed to update deal stage.', 'error')
  })
})

describe('useDealClosure — Won/Lost closure command guard', () => {
  test('handleWon attaches the lock header and does not surface a conflict on success', async () => {
    const onClosed = jest.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useDealClosure({
        currentDealId: 'deal-1',
        dealUpdatedAt: DEAL_UPDATED_AT,
        runMutationWithContext: passthroughRunner,
        confirmDiscardIfDirty: async () => true,
        onClosed,
      }),
    )

    await act(async () => {
      await result.current.handleWon()
    })

    expect(mockedWithScoped.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: DEAL_UPDATED_AT })
    expect(mockedUpdateCrud).toHaveBeenCalledWith('customers/deals', { id: 'deal-1', closureOutcome: 'won', status: 'win' })
    expect(mockedSurface).not.toHaveBeenCalled()
  })

  test('handleWon routes a 409 through surfaceRecordConflict and aborts the popup', async () => {
    mockedUpdateCrud.mockRejectedValueOnce(conflict409())
    mockedSurface.mockReturnValue(true)
    const onClosed = jest.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useDealClosure({
        currentDealId: 'deal-1',
        dealUpdatedAt: DEAL_UPDATED_AT,
        runMutationWithContext: passthroughRunner,
        confirmDiscardIfDirty: async () => true,
        onClosed,
      }),
    )

    await act(async () => {
      await result.current.handleWon()
    })

    expect(mockedSurface).toHaveBeenCalledTimes(1)
    expect(result.current.wonPopupOpen).toBe(false)
  })

  test('handleLostConfirm attaches the lock header with the lost payload', async () => {
    const { result } = renderHook(() =>
      useDealClosure({
        currentDealId: 'deal-1',
        dealUpdatedAt: DEAL_UPDATED_AT,
        runMutationWithContext: passthroughRunner,
        confirmDiscardIfDirty: async () => true,
        onClosed: jest.fn().mockResolvedValue(undefined),
      }),
    )

    await act(async () => {
      await result.current.handleLostConfirm({ lossReasonId: 'reason-1', lossNotes: 'nope' })
    })

    expect(mockedWithScoped.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: DEAL_UPDATED_AT })
    expect(mockedUpdateCrud).toHaveBeenCalledWith('customers/deals', {
      id: 'deal-1',
      closureOutcome: 'lost',
      status: 'loose',
      lossReasonId: 'reason-1',
      lossNotes: 'nope',
    })
  })

  test('handleLostConfirm routes a 409 through surfaceRecordConflict', async () => {
    mockedUpdateCrud.mockRejectedValueOnce(conflict409())
    mockedSurface.mockReturnValue(true)

    const { result } = renderHook(() =>
      useDealClosure({
        currentDealId: 'deal-1',
        dealUpdatedAt: DEAL_UPDATED_AT,
        runMutationWithContext: passthroughRunner,
        confirmDiscardIfDirty: async () => true,
        onClosed: jest.fn().mockResolvedValue(undefined),
      }),
    )

    await act(async () => {
      await result.current.handleLostConfirm({ lossReasonId: 'reason-1' })
    })

    expect(mockedSurface).toHaveBeenCalledTimes(1)
    expect((mockedSurface.mock.calls[0][0] as CrudHttpError).status).toBe(409)
    expect(result.current.lostPopupOpen).toBe(false)
  })
})

describe('deal resource-kind: closure/stage writes target the customers/deals CRUD route', () => {
  // Documents that the deal command writes ride the makeCrudRoute path
  // (`customers/deals`), so the enterprise record_locks `crudMutationGuardService`
  // decorator auto-covers the server-side guard once `customers.deal` is enabled —
  // no bespoke command endpoint exists to wire (Phase 1 deviation note).
  test('stage change uses the deals CRUD resource path', async () => {
    const { result } = renderHook(() =>
      useDealPipeline({
        currentDealId: 'deal-1',
        data: makeDeal(),
        runMutationWithContext: passthroughRunner,
        confirmDiscardIfDirty: async () => true,
        onStageChanged: jest.fn().mockResolvedValue(undefined),
      }),
    )

    await act(async () => {
      await result.current.handleStageChange('stage-9')
    })

    expect(mockedUpdateCrud.mock.calls[0][0]).toBe('customers/deals')
  })
})

// Keep the imported conflict code referenced so the lint/ts unused check stays quiet
// while documenting the shape the server returns for a deal lock conflict.
void OPTIMISTIC_LOCK_CONFLICT_CODE
