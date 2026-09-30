/** @jest-environment jsdom */

const updateCrudMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: async (_headers: HeadersInit, operation: () => Promise<unknown>) =>
    operation(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback || _key,
}))

import { act, renderHook } from '@testing-library/react'
import { useDealClosure } from '../useDealClosure'

describe('useDealClosure', () => {
  beforeEach(() => {
    updateCrudMock.mockReset().mockResolvedValue({ ok: true })
    readApiResultOrThrowMock.mockReset().mockResolvedValue(null)
  })

  it('omits empty loss notes when closing a deal as lost', async () => {
    const runMutationWithContext = jest.fn(async (operation: () => Promise<unknown>) => operation())
    const { result } = renderHook(() =>
      useDealClosure({
        currentDealId: 'deal-1',
        dealUpdatedAt: '2026-06-16T10:00:00.000Z',
        runMutationWithContext,
        confirmDiscardIfDirty: async () => true,
        onClosed: async () => {},
      }),
    )

    await act(async () => {
      await result.current.handleLostConfirm({ lossReasonId: 'reason-price' })
    })

    expect(updateCrudMock).toHaveBeenCalledWith('customers/deals', {
      id: 'deal-1',
      closureOutcome: 'lost',
      status: 'lost',
      lossReasonId: 'reason-price',
    })
    expect(runMutationWithContext).toHaveBeenCalledWith(expect.any(Function), {
      id: 'deal-1',
      closureOutcome: 'lost',
      status: 'lost',
      lossReasonId: 'reason-price',
      operation: 'closeLost',
    })
  })

  it('sends loss notes when the user provides them', async () => {
    const runMutationWithContext = jest.fn(async (operation: () => Promise<unknown>) => operation())
    const { result } = renderHook(() =>
      useDealClosure({
        currentDealId: 'deal-1',
        dealUpdatedAt: '2026-06-16T10:00:00.000Z',
        runMutationWithContext,
        confirmDiscardIfDirty: async () => true,
        onClosed: async () => {},
      }),
    )

    await act(async () => {
      await result.current.handleLostConfirm({
        lossReasonId: 'reason-price',
        lossNotes: 'Too expensive',
      })
    })

    expect(updateCrudMock).toHaveBeenCalledWith('customers/deals', {
      id: 'deal-1',
      closureOutcome: 'lost',
      status: 'lost',
      lossReasonId: 'reason-price',
      lossNotes: 'Too expensive',
    })
  })

  it('only closes without a decision after confirmation and preserves the guarded mutation', async () => {
    const runMutationWithContext = jest.fn(async (operation: () => Promise<unknown>) => operation())
    const confirmNoDecision = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const onClosed = jest.fn()
    const { result } = renderHook(() =>
      useDealClosure({
        currentDealId: 'deal-1',
        dealUpdatedAt: '2026-09-30T10:00:00.000Z',
        runMutationWithContext,
        confirmDiscardIfDirty: async () => true,
        confirmNoDecision,
        onClosed,
      }),
    )

    await act(async () => { await result.current.handleNoDecision() })
    expect(updateCrudMock).not.toHaveBeenCalled()

    await act(async () => { await result.current.handleNoDecision() })
    expect(updateCrudMock).toHaveBeenCalledWith('customers/deals', {
      id: 'deal-1', status: 'no_decision', closureOutcome: null,
    })
    expect(runMutationWithContext).toHaveBeenCalledWith(expect.any(Function), {
      id: 'deal-1', status: 'no_decision', closureOutcome: null, operation: 'closeNoDecision',
    })
    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it('reopens to the status from before closing', async () => {
    const runMutationWithContext = jest.fn(async (operation: () => Promise<unknown>) => operation())
    const { result } = renderHook(() =>
      useDealClosure({
        currentDealId: 'deal-1',
        dealUpdatedAt: '2026-09-30T10:00:00.000Z',
        preCloseStatus: 'question',
        runMutationWithContext,
        confirmDiscardIfDirty: async () => true,
        onClosed: async () => {},
      }),
    )

    await act(async () => { await result.current.handleReopenNoDecision() })
    expect(updateCrudMock).toHaveBeenCalledWith('customers/deals', {
      id: 'deal-1', status: 'question', closureOutcome: null,
    })
  })
})
