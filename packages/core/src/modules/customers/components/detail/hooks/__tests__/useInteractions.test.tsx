/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { useInteractions, type UseInteractionsResult } from '../useInteractions'
import type { InteractionSummary } from '../../types'

const apiCallOrThrowMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()
const surfaceRecordConflictMock = jest.fn()
const withScopedApiRequestHeadersMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (headers: Record<string, string>, operation: () => Promise<unknown>) => {
    withScopedApiRequestHeadersMock(headers)
    return operation()
  },
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => translate }
})

const interaction: InteractionSummary = {
  id: 'interaction-1',
  interactionType: 'task',
  title: 'Original task',
  status: 'planned',
  createdAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-22T11:00:00.000Z',
}

const mutations: Array<[string, (hook: UseInteractionsResult) => Promise<void>]> = [
  ['update', (hook) => hook.updateInteraction(interaction.id, { title: 'Attempted edit' })],
  ['complete', (hook) => hook.completeInteraction(interaction.id)],
  ['cancel', (hook) => hook.cancelInteraction(interaction.id)],
  ['delete', (hook) => hook.deleteInteraction(interaction.id)],
]

async function renderInteractions() {
  const rendered = renderHook(() => useInteractions({ entityId: 'customer-1', typeFilter: 'task' }))
  await waitFor(() => expect(rendered.result.current.interactions).toEqual([interaction]))
  return rendered
}

describe('useInteractions mutation outcomes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    readApiResultOrThrowMock.mockResolvedValue({ items: [interaction] })
    apiCallOrThrowMock.mockResolvedValue(undefined)
    surfaceRecordConflictMock.mockReturnValue(false)
  })

  it.each(mutations)('rejects a handled %s conflict after refreshing the list', async (_name, mutate) => {
    const conflict = Object.assign(new Error('Record modified'), { status: 409 })
    apiCallOrThrowMock.mockRejectedValue(conflict)
    surfaceRecordConflictMock.mockReturnValue(true)
    const { result } = await renderInteractions()

    await act(async () => {
      await expect(mutate(result.current)).rejects.toBe(conflict)
    })

    expect(surfaceRecordConflictMock).toHaveBeenCalledWith(conflict, expect.any(Function))
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledWith({
      [OPTIMISTIC_LOCK_HEADER_NAME]: interaction.updatedAt,
    })
    expect(result.current.isMutating).toBe(false)
    expect(result.current.pendingId).toBeNull()
  })

  it.each(mutations)('resolves an accepted %s mutation and refreshes the list', async (_name, mutate) => {
    const { result } = await renderInteractions()

    await act(async () => {
      await expect(mutate(result.current)).resolves.toBeUndefined()
    })

    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
    expect(surfaceRecordConflictMock).not.toHaveBeenCalled()
    expect(result.current.isMutating).toBe(false)
    expect(result.current.pendingId).toBeNull()
  })

  it.each(mutations)('propagates an ordinary %s failure without refreshing', async (_name, mutate) => {
    const failure = new Error('Network unavailable')
    apiCallOrThrowMock.mockRejectedValue(failure)
    const { result } = await renderInteractions()

    await act(async () => {
      await expect(mutate(result.current)).rejects.toBe(failure)
    })

    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)
    expect(result.current.isMutating).toBe(false)
    expect(result.current.pendingId).toBeNull()
  })
})
