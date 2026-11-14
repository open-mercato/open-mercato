/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { act, waitFor } from '@testing-library/react'
import { clearAllOperations, markUndoSuccess, pushOperation } from '@open-mercato/ui/backend/operations/store'
import { ActivityHistorySection } from '../ActivityHistorySection'
import type { InteractionSummary } from '../types'

type ActivityCardProbeProps = {
  onDelete?: (activity: InteractionSummary) => Promise<void>
}

const activityCardMock = jest.fn<null, [ActivityCardProbeProps]>(() => null)
const readApiResultOrThrowMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const scopedHeadersMock = jest.fn()
const confirmMock = jest.fn<Promise<boolean>, unknown[]>(async () => true)
const flashMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (headers: Record<string, string>, operation: () => unknown) => {
    scopedHeadersMock(headers)
    return operation()
  },
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: (...args: unknown[]) => confirmMock(...args),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('../ActivityCard', () => ({
  ActivityCard: (props: ActivityCardProbeProps) => activityCardMock(props),
}))

function sampleActivity(overrides: Partial<InteractionSummary> = {}): InteractionSummary {
  return {
    id: 'interaction-1',
    interactionType: 'call',
    title: 'Discovery call',
    body: null,
    status: 'done',
    scheduledAt: null,
    occurredAt: new Date().toISOString(),
    priority: null,
    authorUserId: null,
    ownerUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
    source: 'manual',
    entityId: 'company-123',
    dealId: null,
    organizationId: null,
    tenantId: null,
    authorName: null,
    authorEmail: null,
    dealTitle: null,
    customValues: null,
    createdAt: new Date().toISOString(),
    updatedAt: '2026-07-10T08:30:00.000Z',
    ...overrides,
  } as InteractionSummary
}

function readCardProps(): ActivityCardProbeProps {
  const calls = activityCardMock.mock.calls
  return calls[calls.length - 1][0]
}

describe('ActivityHistorySection delete flow', () => {
  beforeEach(() => {
    activityCardMock.mockClear()
    readApiResultOrThrowMock.mockReset()
    apiCallOrThrowMock.mockReset()
    scopedHeadersMock.mockClear()
    flashMock.mockClear()
    confirmMock.mockClear()
    confirmMock.mockResolvedValue(true)
    act(() => {
      clearAllOperations()
    })
  })

  it('deletes through the canonical interactions route with the optimistic-lock header', async () => {
    const activity = sampleActivity()
    readApiResultOrThrowMock.mockResolvedValue({ items: [activity] })
    apiCallOrThrowMock.mockResolvedValue({ ok: true })

    renderWithProviders(<ActivityHistorySection entityId="company-123" useCanonicalInteractions />)

    await waitFor(() => expect(activityCardMock).toHaveBeenCalled())
    const cardProps = readCardProps()
    expect(typeof cardProps.onDelete).toBe('function')

    readApiResultOrThrowMock.mockClear()
    await cardProps.onDelete?.(activity)

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(scopedHeadersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        'x-om-ext-optimistic-lock-expected-updated-at': '2026-07-10T08:30:00.000Z',
      }),
    )
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/interactions',
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ id: 'interaction-1' }) }),
    )
    expect(flashMock).toHaveBeenCalledWith('Activity deleted', 'success')
    // The history reloads so the deleted row disappears without a manual
    // refresh — pinned to the interactions list URL so the counts refetch
    // alone cannot satisfy it.
    await waitFor(() =>
      expect(
        readApiResultOrThrowMock.mock.calls.some(([url]) => String(url).includes('/api/customers/interactions?')),
      ).toBe(true),
    )
  })

  it('notifies the host after a delete so the week strip and counters it owns refresh (#9487)', async () => {
    const activity = sampleActivity()
    readApiResultOrThrowMock.mockResolvedValue({ items: [activity] })
    apiCallOrThrowMock.mockResolvedValue({ ok: true })
    const onDataRefresh = jest.fn()

    renderWithProviders(
      <ActivityHistorySection entityId="company-123" useCanonicalInteractions onDataRefresh={onDataRefresh} />,
    )

    await waitFor(() => expect(activityCardMock).toHaveBeenCalled())
    await act(async () => {
      await readCardProps().onDelete?.(activity)
    })

    expect(onDataRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not notify the host when the delete request fails', async () => {
    const activity = sampleActivity()
    readApiResultOrThrowMock.mockResolvedValue({ items: [activity] })
    apiCallOrThrowMock.mockRejectedValue(new Error('boom'))
    const onDataRefresh = jest.fn()

    renderWithProviders(
      <ActivityHistorySection entityId="company-123" useCanonicalInteractions onDataRefresh={onDataRefresh} />,
    )

    await waitFor(() => expect(activityCardMock).toHaveBeenCalled())
    await act(async () => {
      await readCardProps().onDelete?.(activity)
    })

    expect(onDataRefresh).not.toHaveBeenCalled()
  })

  it('reloads the history and notifies the host when the delete is undone (#9488)', async () => {
    const activity = sampleActivity()
    readApiResultOrThrowMock.mockResolvedValue({ items: [] })
    const onDataRefresh = jest.fn()
    act(() => {
      pushOperation({
        id: 'log-1',
        undoToken: 'undo-token-1',
        commandId: 'customers.interactions.delete',
        actionLabel: null,
        resourceKind: 'customers.interaction',
        resourceId: activity.id,
        executedAt: new Date().toISOString(),
      })
    })

    renderWithProviders(
      <ActivityHistorySection entityId="company-123" useCanonicalInteractions onDataRefresh={onDataRefresh} />,
    )
    await waitFor(() =>
      expect(
        readApiResultOrThrowMock.mock.calls.some(([url]) => String(url).includes('/api/customers/interactions?')),
      ).toBe(true),
    )
    expect(activityCardMock).not.toHaveBeenCalled()
    readApiResultOrThrowMock.mockClear()
    readApiResultOrThrowMock.mockResolvedValue({ items: [activity] })

    act(() => {
      markUndoSuccess('undo-token-1')
    })

    await waitFor(() => expect(activityCardMock).toHaveBeenCalled())
    expect(
      readApiResultOrThrowMock.mock.calls.some(([url]) => String(url).includes('/api/customers/interactions/counts?')),
    ).toBe(true)
    expect(onDataRefresh).toHaveBeenCalledTimes(1)
  })

  it('routes the delete through the guarded-mutation runner when the host supplies one', async () => {
    const activity = sampleActivity()
    readApiResultOrThrowMock.mockResolvedValue({ items: [activity] })
    apiCallOrThrowMock.mockResolvedValue({ ok: true })
    const runMutationSpy = jest.fn()
    const runMutation = <T,>(operation: () => Promise<T>, payload?: Record<string, unknown>): Promise<T> => {
      runMutationSpy(operation, payload)
      return operation()
    }

    renderWithProviders(
      <ActivityHistorySection entityId="company-123" useCanonicalInteractions runMutation={runMutation} />,
    )

    await waitFor(() => expect(activityCardMock).toHaveBeenCalled())
    await readCardProps().onDelete?.(activity)

    expect(runMutationSpy).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ id: 'interaction-1', operation: 'deleteActivity' }),
    )
    expect(apiCallOrThrowMock).toHaveBeenCalled()
  })

  it('does not delete when the confirmation is dismissed', async () => {
    const activity = sampleActivity()
    readApiResultOrThrowMock.mockResolvedValue({ items: [activity] })
    confirmMock.mockResolvedValue(false)

    renderWithProviders(<ActivityHistorySection entityId="company-123" useCanonicalInteractions />)

    await waitFor(() => expect(activityCardMock).toHaveBeenCalled())
    await readCardProps().onDelete?.(activity)

    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
  })

  it('surfaces an error flash when the delete request fails', async () => {
    const activity = sampleActivity()
    readApiResultOrThrowMock.mockResolvedValue({ items: [activity] })
    apiCallOrThrowMock.mockRejectedValue(new Error('boom'))

    renderWithProviders(<ActivityHistorySection entityId="company-123" useCanonicalInteractions />)

    await waitFor(() => expect(activityCardMock).toHaveBeenCalled())
    await readCardProps().onDelete?.(activity)

    expect(flashMock).toHaveBeenCalledWith('Could not delete activity', 'error')
  })
})
