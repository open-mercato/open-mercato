/** @jest-environment jsdom */
/**
 * Record-locks coverage (deal associations): linking/unlinking people or companies
 * writes through `runMutationWithContext` (useGuardedMutation), which already
 * surfaces a 409 on the unified conflict bar. The bug was that the hook's catch
 * ALSO flashed a generic error, so a conflict produced a double surface. These
 * tests assert the catch defers to `surfaceRecordConflict` (wiring `onRefresh`)
 * and only falls back to the generic flash for non-conflict errors.
 */
import { act, renderHook } from '@testing-library/react'

const surfaceRecordConflictMock = jest.fn()
const flashMock = jest.fn()

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...(args as [])),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...(args as [])),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(async () => ({})),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

import { useDealAssociations } from '../useDealAssociations'

type HookOptions = Parameters<typeof useDealAssociations>[0]

const baseData = {
  deal: { updatedAt: '2026-06-01T00:00:00.000Z' },
  people: [],
  companies: [],
  linkedPersonIds: [],
  linkedCompanyIds: [],
  counts: { people: 0, companies: 0 },
} as unknown as HookOptions['data']

beforeEach(() => {
  surfaceRecordConflictMock.mockReset()
  flashMock.mockReset()
})

describe('useDealAssociations — 409 conflict handling', () => {
  test('a 409 surfaces the conflict bar (with onRefresh) and suppresses the generic flash', async () => {
    surfaceRecordConflictMock.mockReturnValue(true)
    const onRefresh = jest.fn()
    const conflict = { status: 409, body: { code: 'optimistic_lock_conflict' } }
    const runMutationWithContext = jest.fn(async () => {
      throw conflict
    }) as unknown as HookOptions['runMutationWithContext']

    const { result } = renderHook(() =>
      useDealAssociations({
        currentDealId: 'deal-1',
        data: baseData,
        setData: jest.fn(),
        runMutationWithContext,
        onRefresh,
      }),
    )

    await act(async () => {
      await result.current.handlePeopleAssociationsChange(['person-1'])
    })

    expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1)
    expect(surfaceRecordConflictMock.mock.calls[0][0]).toBe(conflict)
    expect(surfaceRecordConflictMock.mock.calls[0][2]).toEqual({ onRefresh })
    expect(flashMock).not.toHaveBeenCalled()
  })

  test('a non-conflict error falls back to the generic flash', async () => {
    surfaceRecordConflictMock.mockReturnValue(false)
    const runMutationWithContext = jest.fn(async () => {
      throw new Error('boom')
    }) as unknown as HookOptions['runMutationWithContext']

    const { result } = renderHook(() =>
      useDealAssociations({
        currentDealId: 'deal-1',
        data: baseData,
        setData: jest.fn(),
        runMutationWithContext,
      }),
    )

    await act(async () => {
      await result.current.handleCompaniesAssociationsChange(['company-1'])
    })

    expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1)
    expect(flashMock).toHaveBeenCalledTimes(1)
  })
})
