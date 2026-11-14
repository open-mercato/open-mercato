/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import WmsAsnsListPage from '../WmsAsnsListPage'
import WmsLotsListPage from '../WmsLotsListPage'
import WmsPutawayQueuePage from '../WmsPutawayQueuePage'

const apiCallMock = jest.fn()
const dataTableLoadingStates: boolean[] = []

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageHeader: () => null,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: { isLoading?: boolean; data: unknown[]; emptyState?: React.ReactNode }) => {
    dataTableLoadingStates.push(Boolean(props.isLoading))
    return (
      <div data-testid="data-table" data-loading={props.isLoading ? 'true' : 'false'}>
        {props.isLoading ? 'Loading table' : props.data.length === 0 ? props.emptyState : null}
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('../useWmsInventoryMutationAccess', () => ({
  useWmsInventoryMutationAccess: () => ({}),
}))

jest.mock('../inventoryMutationLoaders', () => ({
  loadWarehouseOptions: jest.fn(async () => []),
  resolveWarehouseLabel: jest.fn(async () => ''),
  resolveCatalogVariantLabel: jest.fn(async () => ''),
  resolveLocationLabel: jest.fn(async () => ''),
}))

jest.mock('../CreateAsnDialog', () => ({ CreateAsnDialog: () => null }))
jest.mock('../ChangeLotStatusDialog', () => ({ ChangeLotStatusDialog: () => null }))
jest.mock('../ImportInventoryDialog', () => ({ ImportInventoryDialog: () => null }))
jest.mock('../MoveInventoryDialog', () => ({ MoveInventoryDialog: () => null }))
jest.mock('../ReceiveInventoryDialog', () => ({ ReceiveInventoryDialog: () => null }))
jest.mock('../AssignPutawayTaskDialog', () => ({ AssignPutawayTaskDialog: () => null }))
jest.mock('../CompletePutawayTaskDialog', () => ({ CompletePutawayTaskDialog: () => null }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void }

function createDeferred(): Deferred {
  let resolve: (value: unknown) => void = () => undefined
  const promise = new Promise<unknown>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const emptyPage = { ok: true, result: { items: [], total: 0, totalPages: 1 } }

const pages: Array<{ name: string; Component: React.ComponentType }> = [
  { name: 'ASNs', Component: WmsAsnsListPage },
  { name: 'Lots', Component: WmsLotsListPage },
  { name: 'Putaway queue', Component: WmsPutawayQueuePage },
]

describe('WMS list pages background refetch', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    dataTableLoadingStates.length = 0
  })

  it.each(pages)('$name keeps the table out of the loading state during a background refetch', async ({ Component }) => {
    apiCallMock.mockResolvedValue(emptyPage)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderWithProviders(<Component />, { queryClient })

    await screen.findByTestId('data-table')
    const emptyStateText = screen.getByTestId('data-table').textContent

    const pendingRefetch = createDeferred()
    apiCallMock.mockImplementation(() => pendingRefetch.promise)
    dataTableLoadingStates.length = 0

    let refetchDone: Promise<void> = Promise.resolve()
    act(() => {
      refetchDone = queryClient.refetchQueries()
    })

    await waitFor(() => expect(queryClient.isFetching()).toBeGreaterThan(0))
    expect(screen.getByTestId('data-table')).toHaveAttribute('data-loading', 'false')
    expect(screen.getByTestId('data-table').textContent).toBe(emptyStateText)
    expect(screen.queryByText('Loading table')).not.toBeInTheDocument()

    await act(async () => {
      pendingRefetch.resolve(emptyPage)
      await refetchDone
    })

    expect(dataTableLoadingStates).not.toContain(true)
    expect(screen.getByTestId('data-table')).toHaveAttribute('data-loading', 'false')
  })
})
