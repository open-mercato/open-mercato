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
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
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

  it.each(['won', 'lost'] as const)('does not fetch or show %s stats after the organization changes', async (outcome) => {
    emitOrganizationScopeChanged({ organizationId: 'org-before-closure', tenantId: 'tenant' })
    const runMutationWithContext = jest.fn(async (operation: () => Promise<unknown>) => {
      const response = await operation()
      emitOrganizationScopeChanged({ organizationId: 'org-after-closure', tenantId: 'tenant' })
      return response
    })
    const onClosed = jest.fn(async () => undefined)
    const { result } = renderHook(() => useDealClosure({
      currentDealId: 'deal-1',
      dealUpdatedAt: '2026-06-16T10:00:00.000Z',
      runMutationWithContext,
      confirmDiscardIfDirty: async () => true,
      onClosed,
    }))

    await act(async () => {
      if (outcome === 'won') await result.current.handleWon()
      else await result.current.handleLostConfirm({ lossReasonId: 'reason-price' })
    })

    expect(updateCrudMock).toHaveBeenCalledTimes(1)
    expect(readApiResultOrThrowMock).not.toHaveBeenCalled()
    expect(onClosed).not.toHaveBeenCalled()
    expect(result.current.wonPopupOpen).toBe(false)
    expect(result.current.lostPopupOpen).toBe(false)
  })
})
