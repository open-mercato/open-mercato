/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import WmsPutawayQueuePage from '../WmsPutawayQueuePage'

const apiCallMock = jest.fn()

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
  DataTable: (props: { embedded?: boolean }) => (
    <div data-testid="data-table" data-embedded={props.embedded ? 'true' : 'false'} />
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('../useWmsInventoryMutationAccess', () => ({
  useWmsInventoryMutationAccess: () => ({}),
}))

jest.mock('../inventoryMutationLoaders', () => ({
  resolveCatalogVariantLabel: jest.fn(async () => ''),
  resolveLocationLabel: jest.fn(async () => ''),
}))

jest.mock('../MoveInventoryDialog', () => ({ MoveInventoryDialog: () => null }))
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

describe('WmsPutawayQueuePage table overflow (#9757)', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [], total: 0, totalPages: 1 } })
  })

  it('hosts the embedded tasks table in a horizontal scroll container inside the card', async () => {
    renderWithProviders(<WmsPutawayQueuePage />, {
      queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    })

    const table = await screen.findByTestId('data-table')
    expect(table).toHaveAttribute('data-embedded', 'true')

    const scrollContainer = screen.getByTestId('putaway-tasks-table-scroll')
    expect(scrollContainer).toContainElement(table)
    expect(scrollContainer).toHaveClass('min-w-0', 'overflow-x-auto')
    expect(scrollContainer.closest('section')).not.toBeNull()
  })
})
