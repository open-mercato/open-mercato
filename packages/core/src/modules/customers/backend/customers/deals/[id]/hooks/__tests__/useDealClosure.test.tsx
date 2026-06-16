/** @jest-environment jsdom */

const updateCrudMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
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
      status: 'loose',
      lossReasonId: 'reason-price',
    })
    expect(runMutationWithContext).toHaveBeenCalledWith(expect.any(Function), {
      id: 'deal-1',
      closureOutcome: 'lost',
      status: 'loose',
      lossReasonId: 'reason-price',
      operation: 'closeLost',
    })
  })

  it('sends loss notes when the user provides them', async () => {
    const runMutationWithContext = jest.fn(async (operation: () => Promise<unknown>) => operation())
    const { result } = renderHook(() =>
      useDealClosure({
        currentDealId: 'deal-1',
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
      status: 'loose',
      lossReasonId: 'reason-price',
      lossNotes: 'Too expensive',
    })
  })
})
