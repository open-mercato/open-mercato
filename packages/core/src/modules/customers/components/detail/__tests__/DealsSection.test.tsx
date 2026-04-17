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
  })

  const makeDeal = (overrides: Record<string, unknown> = {}) => ({
    id: 'deal-1',
    title: 'Test Deal',
    status: 'open',
    pipelineStage: null,
    valueAmount: 1000,
    valueCurrency: 'USD',
    probability: 50,
    expectedCloseAt: null,
    description: null,
    personIds: ['person-1', 'person-2'],
    companyIds: ['company-1'],
    people: [
      { id: 'person-1', label: 'Alice' },
      { id: 'person-2', label: 'Bob' },
    ],
    companies: [{ id: 'company-1', label: 'Acme' }],
    customValues: null,
    customFields: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  })

  it('renders deals after loading', async () => {
    readApiResultOrThrowMock.mockResolvedValueOnce({
      items: [makeDeal()],
      totalPages: 1,
    })

    renderWithProviders(
      <DealsSection
        scope={{ kind: 'person', entityId: 'person-1' }}
        addActionLabel="Add deal"
        emptyLabel="—"
        emptyState={{ title: 'No deals', actionLabel: 'Create deal' }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Test Deal')).toBeInTheDocument()
    })
  })

  it('calls updateCrud to unlink deal from person (not deleteCrud)', async () => {
    readApiResultOrThrowMock.mockResolvedValueOnce({
      items: [makeDeal()],
      totalPages: 1,
    })

    confirmMock.mockResolvedValue(true)
    updateCrudMock.mockResolvedValue({ result: { id: 'deal-1' } })

    renderWithProviders(
      <DealsSection
        scope={{ kind: 'person', entityId: 'person-1' }}
        addActionLabel="Add deal"
        emptyLabel="—"
        emptyState={{ title: 'No deals', actionLabel: 'Create deal' }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Test Deal')).toBeInTheDocument()
    })

    const article = screen.getByText('Test Deal').closest('article')!
    const removeButton = within(article).getAllByRole('button').at(-1)!
    await act(async () => {
      fireEvent.click(removeButton)
    })

    // HEAD's handleUnlink uses the default confirm variant (not destructive)
    expect(confirmMock).toHaveBeenCalled()

    await waitFor(() => {
      expect(updateCrudMock).toHaveBeenCalledWith(
        'customers/deals',
        expect.objectContaining({
          id: 'deal-1',
          personIds: ['person-2'],
        }),
        expect.any(Object),
      )
    })

    expect(deleteCrudMock).not.toHaveBeenCalled()
  })

  it('calls updateCrud to unlink deal from company (not deleteCrud)', async () => {
    readApiResultOrThrowMock.mockResolvedValueOnce({
      items: [makeDeal()],
      totalPages: 1,
    })

    confirmMock.mockResolvedValue(true)
    updateCrudMock.mockResolvedValue({ result: { id: 'deal-1' } })

    renderWithProviders(
      <DealsSection
        scope={{ kind: 'company', entityId: 'company-1' }}
        addActionLabel="Add deal"
        emptyLabel="—"
        emptyState={{ title: 'No deals', actionLabel: 'Create deal' }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Test Deal')).toBeInTheDocument()
    })

    const article = screen.getByText('Test Deal').closest('article')!
    const removeButton = within(article).getAllByRole('button').at(-1)!
    await act(async () => {
      fireEvent.click(removeButton)
    })

    await waitFor(() => {
      expect(updateCrudMock).toHaveBeenCalledWith(
        'customers/deals',
        expect.objectContaining({
          id: 'deal-1',
          companyIds: [],
        }),
        expect.any(Object),
      )
    })

    expect(deleteCrudMock).not.toHaveBeenCalled()
  })

  it('does not unlink when user cancels confirmation', async () => {
    readApiResultOrThrowMock.mockResolvedValueOnce({
      items: [makeDeal()],
      totalPages: 1,
    })

    confirmMock.mockResolvedValue(false)

    renderWithProviders(
      <DealsSection
        scope={{ kind: 'person', entityId: 'person-1' }}
        addActionLabel="Add deal"
        emptyLabel="—"
        emptyState={{ title: 'No deals', actionLabel: 'Create deal' }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Test Deal')).toBeInTheDocument()
    })

    const article = screen.getByText('Test Deal').closest('article')!
    const removeButton = within(article).getAllByRole('button').at(-1)!
    await act(async () => {
      fireEvent.click(removeButton)
    })

    expect(updateCrudMock).not.toHaveBeenCalled()
    expect(deleteCrudMock).not.toHaveBeenCalled()
  })

  it('shows flash message on successful removal', async () => {
    readApiResultOrThrowMock.mockResolvedValueOnce({
      items: [makeDeal()],
      totalPages: 1,
    })

    confirmMock.mockResolvedValue(true)
    updateCrudMock.mockResolvedValue({ result: { id: 'deal-1' } })

    renderWithProviders(
      <DealsSection
        scope={{ kind: 'person', entityId: 'person-1' }}
        addActionLabel="Add deal"
        emptyLabel="—"
        emptyState={{ title: 'No deals', actionLabel: 'Create deal' }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Test Deal')).toBeInTheDocument()
    })

    const article = screen.getByText('Test Deal').closest('article')!
    const removeButton = within(article).getAllByRole('button').at(-1)!
    await act(async () => {
      fireEvent.click(removeButton)
    })

    await waitFor(() => {
      // HEAD's handleUnlink flashes "Deal unlinked." (develop used "removed")
      expect(flashMock).toHaveBeenCalledWith(
        expect.stringContaining('unlinked'),
        'success',
      )
    })
  })
})
