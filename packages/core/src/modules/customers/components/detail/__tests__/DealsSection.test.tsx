/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DealsSection } from '../DealsSection'

const readApiResultOrThrowMock = jest.fn()
const updateCrudMock = jest.fn()
const deleteCrudMock = jest.fn()
const confirmMock = jest.fn()
const flashMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
  deleteCrud: (...args: unknown[]) => deleteCrudMock(...args),
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

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 'scope-v1',
}))

jest.mock(
  '#generated/entities.ids.generated',
  () => ({
    E: {
      customers: {
        customer_deal: 'customers:customer_deal',
      },
    },
  }),
  { virtual: true },
)

jest.mock('../hooks/useCustomerDictionary', () => ({
  useCustomerDictionary: () => ({ data: { map: {} } }),
}))

jest.mock('../hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: jest.fn(),
}))

jest.mock('../hooks/useCustomFieldDisplay', () => ({
  useCustomFieldDisplay: () => ({
    definitions: [],
    dictionaryMapsByKey: {},
    isLoading: false,
    error: null,
  }),
}))

jest.mock('../CustomFieldValuesList', () => ({
  CustomFieldValuesList: () => null,
}))

jest.mock('../DealDialog', () => ({
  DealDialog: () => null,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  TabEmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}))

describe('DealsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    confirmMock.mockResolvedValue(true)
    updateCrudMock.mockResolvedValue({ ok: true })
  })

  it('removes a deal from a person detail page by updating person assignments instead of deleting the record', async () => {
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())
    const onDataRefresh = jest.fn(async () => {})
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        {
          id: 'deal-1',
          title: 'Expansion opportunity',
          status: 'open',
          updatedAt: '2026-04-11T10:00:00.000Z',
          createdAt: '2026-04-10T10:00:00.000Z',
          personIds: ['person-1', 'person-2'],
          companyIds: ['company-1'],
        },
      ],
      totalPages: 1,
    })

    renderWithProviders(
      <DealsSection
        scope={{ kind: 'person', entityId: 'person-1' }}
        addActionLabel="Add deal"
        emptyLabel="No deals"
        emptyState={{
          title: 'No deals yet',
          actionLabel: 'Create deal',
        }}
        onDataRefresh={onDataRefresh}
        runGuardedMutation={runGuardedMutation}
      />,
    )

    const article = (await screen.findByText('Expansion opportunity')).closest('article') as HTMLElement

    await act(async () => {
      fireEvent.click(within(article).getAllByRole('button')[1])
    })

    await waitFor(() => {
      expect(runGuardedMutation).toHaveBeenCalledWith(expect.any(Function), {
        id: 'deal-1',
        personIds: ['person-2'],
      })
    })
    expect(updateCrudMock).toHaveBeenCalledWith(
      'customers/deals',
      {
        id: 'deal-1',
        personIds: ['person-2'],
      },
      expect.any(Object),
    )
    expect(deleteCrudMock).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByText('Expansion opportunity')).not.toBeInTheDocument()
    })
    expect(onDataRefresh).toHaveBeenCalledTimes(1)
  })

  it('removes a deal from a company detail page by updating company assignments instead of deleting the record', async () => {
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        {
          id: 'deal-2',
          title: 'Renewal',
          status: 'open',
          updatedAt: '2026-04-11T11:00:00.000Z',
          createdAt: '2026-04-10T11:00:00.000Z',
          personIds: ['person-3'],
          companyIds: ['company-1', 'company-2'],
        },
      ],
      totalPages: 1,
    })

    renderWithProviders(
      <DealsSection
        scope={{ kind: 'company', entityId: 'company-1' }}
        addActionLabel="Add deal"
        emptyLabel="No deals"
        emptyState={{
          title: 'No deals yet',
          actionLabel: 'Create deal',
        }}
        runGuardedMutation={runGuardedMutation}
      />,
    )

    const article = (await screen.findByText('Renewal')).closest('article') as HTMLElement

    await act(async () => {
      fireEvent.click(within(article).getAllByRole('button')[1])
    })

    await waitFor(() => {
      expect(runGuardedMutation).toHaveBeenCalledWith(expect.any(Function), {
        id: 'deal-2',
        companyIds: ['company-2'],
      })
    })
    expect(updateCrudMock).toHaveBeenCalledWith(
      'customers/deals',
      {
        id: 'deal-2',
        companyIds: ['company-2'],
      },
      expect.any(Object),
    )
    expect(deleteCrudMock).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByText('Renewal')).not.toBeInTheDocument()
    })
  })
})
