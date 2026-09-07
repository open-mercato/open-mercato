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

  it('formats the deal value and its expected-close date in the app locale', async () => {
    // The company page renders these cards directly under `CompanyKpiBar`, which formats in the
    // application locale. A runtime-default value label put `210 000 USD` above `$210,000.00` on
    // one screen — the same mixed-convention regression this PR fixed on the sales document page
    // (#5182 review, minor 4). Pinning a non-English locale makes a revert fail loudly.
    //
    // Value and expected-close render as adjacent `<dd>` entries in one `<dl>` on the same card, so
    // they are asserted together: threading the locale into only one of them left a single card
    // mixing conventions two rows apart — a tighter instance of the very defect this PR exists to
    // remove (#5182 re-review, minor 1).
    //
    // The date literal is offset-less on purpose. An instant lands on a different calendar day at
    // the timezone extremes, which is the machine-dependence this PR removes rather than adds.
    readApiResultOrThrowMock.mockResolvedValueOnce({
      items: [makeDeal({ expectedCloseAt: '2026-06-09T12:00:00' })],
      totalPages: 1,
    })

    renderWithProviders(
      <DealsSection
        scope={{ kind: 'person', entityId: 'person-1' }}
        addActionLabel="Add deal"
        emptyLabel="—"
        emptyState={{ title: 'No deals', actionLabel: 'Create deal' }}
      />,
      { locale: 'pl-PL' },
    )

    // `Intl` separates the amount from the currency code with a non-breaking space.
    const valueLabel = await screen.findByText(/1000,00/)
    expect(valueLabel.textContent?.replace(/[  ]/g, ' ')).toBe('1000,00 USD')

    // `9.06.2026`, not the en-US `6/9/2026` the runtime default would produce. Asserting the
    // absence of the en-US shape too means a component that silently stops threading the locale
    // fails here instead of merely looking plausible.
    expect(screen.getByText('9.06.2026')).toBeInTheDocument()
    expect(screen.queryByText('6/9/2026')).not.toBeInTheDocument()
  })

  it('clamps a long deal description so one card cannot flood the page', async () => {
    const description = Array.from({ length: 200 }, (_, index) => `Call note line ${index}`).join('\n')
    readApiResultOrThrowMock.mockResolvedValueOnce({
      items: [makeDeal({ description })],
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

    const article = (await screen.findByText('Test Deal')).closest('article')!
    const paragraph = Array.from(article.querySelectorAll('p')).find(
      (element) => element.textContent === description,
    )
    expect(paragraph?.className).toContain('line-clamp-3')
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

  // `hasMore` used to prefer `nextPage < totalPages` and only fall back to page
  // fullness. A totalPages of 1 next to a full page — an under-reporting or
  // capped total — hid the button and made the remaining deals unreachable.
  describe('load-more termination', () => {
    const makeFullPage = (offset = 0) =>
      Array.from({ length: 10 }, (_, index) =>
        makeDeal({ id: `deal-${offset + index + 1}`, title: `Deal ${offset + index + 1}` }))

    it('offers Load more on a full page even when totalPages reports a single page', async () => {
      readApiResultOrThrowMock.mockResolvedValueOnce({
        items: makeFullPage(),
        totalPages: 1,
        total: 4,
      })

      renderWithProviders(
        <DealsSection
          scope={{ kind: 'person', entityId: 'person-1' }}
          addActionLabel="Add deal"
          emptyLabel="—"
          emptyState={{ title: 'No deals', actionLabel: 'Create deal' }}
        />,
      )

      expect(await screen.findByRole('button', { name: 'Load more deals' })).toBeInTheDocument()
    })

    it('hides Load more once a page comes back short', async () => {
      readApiResultOrThrowMock.mockResolvedValueOnce({
        items: [makeDeal()],
        // A large total must not conjure a next page.
        totalPages: 99,
        total: 999,
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
        expect(readApiResultOrThrowMock).toHaveBeenCalled()
      })
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more deals' })).toBeNull()
      })
    })

    // `/api/customers/deals` is a query-engine list and does not clamp, so the
    // page past the end comes back empty. That is what ends the sequence.
    it('stops on the empty page past the end', async () => {
      readApiResultOrThrowMock
        .mockResolvedValueOnce({ items: makeFullPage(), totalPages: 1, total: 10 })
        .mockResolvedValueOnce({ items: [], totalPages: 1, total: 10 })

      renderWithProviders(
        <DealsSection
          scope={{ kind: 'person', entityId: 'person-1' }}
          addActionLabel="Add deal"
          emptyLabel="—"
          emptyState={{ title: 'No deals', actionLabel: 'Create deal' }}
        />,
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Load more deals' }))

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more deals' })).toBeNull()
      })
      expect(screen.getByText('Deal 10')).toBeInTheDocument()
    })

    // The served page decides, not the rows left after the append dedupes by
    // id: a full page of already-known deals must still offer the next one.
    it('offers Load more when a full page dedupes away entirely', async () => {
      readApiResultOrThrowMock
        .mockResolvedValueOnce({ items: makeFullPage(), totalPages: 1, total: 10 })
        .mockResolvedValueOnce({ items: makeFullPage(), totalPages: 1, total: 10 })

      renderWithProviders(
        <DealsSection
          scope={{ kind: 'person', entityId: 'person-1' }}
          addActionLabel="Add deal"
          emptyLabel="—"
          emptyState={{ title: 'No deals', actionLabel: 'Create deal' }}
        />,
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Load more deals' }))

      await waitFor(() => {
        expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
      })
      expect(screen.getByRole('button', { name: 'Load more deals' })).toBeInTheDocument()
    })
  })

})
