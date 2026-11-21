/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TimelineSavedViews } from '../TimelineSavedViews'
import type { DealTimelineSavedView } from '../../../../../../lib/dealsTimelineSavedView'

const mockReadApiResultOrThrow = jest.fn()
let mockScopeVersion = 1

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useLocale: () => 'en',
  useT: () => (key: string, fallbackOrParams?: unknown, maybeParams?: Record<string, unknown>) => {
    const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
    const params = typeof fallbackOrParams === 'object' && fallbackOrParams ? (fallbackOrParams as Record<string, unknown>) : maybeParams
    return fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))
  },
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockScopeVersion,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: () => ({}) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => unknown }) => operation(),
    retryLastMutation: async () => true,
  }),
}))
jest.mock('@open-mercato/ui/backend/views/ViewChip', () => ({
  ViewChip: ({ label, onActivate }: { label: string; onActivate: () => void }) => (
    <button type="button" data-testid="view-chip" onClick={onActivate}>
      {label}
    </button>
  ),
}))
jest.mock('@open-mercato/ui/backend/views/NewViewForm', () => ({
  NewViewForm: () => <div data-testid="new-view-form" />,
}))

const currentView: DealTimelineSavedView = {
  status: [],
  pipelineId: null,
  ownerUserId: [],
  personId: [],
  companyId: [],
  excludeClosed: true,
  groupBy: 'owner',
  bucket: 'week',
}

function perspective(id: string, name: string) {
  return { id, name, settings: { filters: { __namespaced: true, timeline: { v: 1, groupBy: 'stage', bucket: 'month' } } } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderViews(client: QueryClient, onApply = jest.fn()) {
  return render(
    <QueryClientProvider client={client}>
      <TimelineSavedViews currentView={currentView} onApply={onApply} />
    </QueryClientProvider>,
  )
}

describe('TimelineSavedViews', () => {
  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
    mockScopeVersion = 1
  })

  it('drops the previous organization views as soon as the scope switches', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mockReadApiResultOrThrow.mockResolvedValueOnce({ perspectives: [perspective('view-a', 'Org A view')] })
    const view = renderViews(client)
    expect(await screen.findByText('Org A view')).toBeTruthy()

    const orgB = deferred<unknown>()
    mockReadApiResultOrThrow.mockImplementationOnce(() => orgB.promise)
    mockScopeVersion = 2
    view.rerender(
      <QueryClientProvider client={client}>
        <TimelineSavedViews currentView={currentView} onApply={jest.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.queryByText('Org A view')).toBeNull()
    expect(screen.getByText('Loading saved views…')).toBeTruthy()

    await act(async () => {
      orgB.resolve({ perspectives: [perspective('view-b', 'Org B view')] })
    })
    expect(await screen.findByText('Org B view')).toBeTruthy()
    expect(screen.queryByText('Org A view')).toBeNull()
  })

  it('never renders a previous organization response that arrives after the switch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const lateA = deferred<unknown>()
    const orgB = deferred<unknown>()
    mockReadApiResultOrThrow.mockImplementationOnce(() => lateA.promise).mockImplementationOnce(() => orgB.promise)
    const view = renderViews(client)
    expect(screen.getByText('Loading saved views…')).toBeTruthy()

    mockScopeVersion = 2
    view.rerender(
      <QueryClientProvider client={client}>
        <TimelineSavedViews currentView={currentView} onApply={jest.fn()} />
      </QueryClientProvider>,
    )
    await act(async () => {
      lateA.resolve({ perspectives: [perspective('view-a', 'Late org A view')] })
    })
    expect(screen.queryByText('Late org A view')).toBeNull()

    await act(async () => {
      orgB.resolve({ perspectives: [perspective('view-b', 'Org B view')] })
    })
    expect(await screen.findByText('Org B view')).toBeTruthy()
    expect(screen.queryByText('Late org A view')).toBeNull()
  })

  it('shows a load error with Retry instead of an empty list, then recovers', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mockReadApiResultOrThrow.mockRejectedValueOnce(new Error('boom'))
    renderViews(client)
    expect(await screen.findByTestId('timeline-saved-views-error')).toBeTruthy()
    expect(screen.queryByTestId('timeline-saved-views-empty')).toBeNull()
    expect(screen.getByText('Save view')).toBeTruthy()

    mockReadApiResultOrThrow.mockResolvedValueOnce({ perspectives: [perspective('view-a', 'Recovered view')] })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Recovered view')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('timeline-saved-views-error')).toBeNull())
  })

  it('shows a valid empty state when the user has no saved views', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mockReadApiResultOrThrow.mockResolvedValueOnce({ perspectives: [] })
    renderViews(client)
    expect(await screen.findByTestId('timeline-saved-views-empty')).toBeTruthy()
    expect(screen.queryByTestId('timeline-saved-views-error')).toBeNull()
  })

  it('applies the chosen view through onApply', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onApply = jest.fn()
    mockReadApiResultOrThrow.mockResolvedValueOnce({ perspectives: [perspective('view-a', 'Stage month')] })
    renderViews(client, onApply)
    fireEvent.click(await screen.findByText('Stage month'))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'stage', bucket: 'month' }))
  })
})
