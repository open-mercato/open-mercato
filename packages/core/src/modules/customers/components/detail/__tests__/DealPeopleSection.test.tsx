/**
 * @jest-environment jsdom
 */

/**
 * The deal People tab reaches behavioural parity with the company tab in this PR — unlink,
 * Filters, name sort, person cards, inline create — but deliberately **not** the linked date
 * or the "recently linked" sort. Both read `linkedAt`, which `syncDealPeople` still rewrites
 * on every people write (and unlink and inline create are people writes), so showing them
 * would mean showing a value that is wrong from the first interaction.
 *
 * The last two cases here are the guard on that: they fail if either surface leaks in early.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DealPeopleSection } from '../DealPeopleSection'
import type { LinkedPersonSummary } from '../LinkedPeopleSection'
import { formatDate } from '../utils'

const readApiResultOrThrowMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('../CreatePersonDialog', () => ({
  CreatePersonDialog: ({
    open,
    companyId,
    onPersonCreated,
  }: {
    open: boolean
    companyId?: string
    onPersonCreated?: (created: { id: string; displayName: string }) => void
  }) =>
    open ? (
      <div>
        <span>{`create-person-dialog:${companyId ?? 'no-company'}`}</span>
        <button
          type="button"
          onClick={() => onPersonCreated?.({ id: 'person-new', displayName: 'New Person' })}
        >
          submit-create-person
        </button>
      </div>
    ) : null,
}))

const capturedAdapters: unknown[] = []
jest.mock('../LinkedPeopleSection', () => {
  const actual = jest.requireActual('../LinkedPeopleSection')
  return {
    ...actual,
    LinkedPeopleSection: (props: { linkAdapter: unknown }) => {
      capturedAdapters.push(props.linkAdapter)
      return actual.LinkedPeopleSection(props)
    },
  }
})

const mockNoInjectedDataWidgets = { widgets: [], isLoading: false, error: null }

jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => mockNoInjectedDataWidgets,
}))

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: jest.fn(async () => []),
  loadInjectionDataWidgetsForSpot: jest.fn(async () => []),
}))

const LINKED_AT = '2026-04-10T00:00:00.000Z'

describe('DealPeopleSection', () => {
  const emptyState = {
    title: 'Link the people involved',
    actionLabel: 'Add person',
  }

  const linkedPeople: LinkedPersonSummary[] = [
    { id: 'person-1', displayName: 'Ada Lovelace', jobTitle: 'VP Partnerships', linkedAt: LINKED_AT },
    { id: 'person-2', displayName: 'Grace Hopper', jobTitle: 'Procurement lead', linkedAt: LINKED_AT },
  ]

  function renderSection(
    onSaveSelection: (next: string[]) => Promise<void>,
    overrides?: { selectedIds?: string[] },
  ) {
    return renderWithProviders(
      <DealPeopleSection
        dealId="deal-1"
        dealName="Expansion renewal"
        selectedIds={overrides?.selectedIds ?? ['person-1', 'person-2']}
        onSaveSelection={onSaveSelection}
        addActionLabel="Add person"
        emptyLabel="No people linked to this deal yet."
        emptyState={emptyState}
      />,
    )
  }

  beforeEach(() => {
    capturedAdapters.length = 0
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockImplementation(async () => ({
      items: linkedPeople,
      page: 1,
      total: linkedPeople.length,
      totalPages: 1,
    }))
  })

  async function waitForInitialLoad() {
    await waitFor(() => {
      expect(screen.queryByText(/Loading data/)).not.toBeInTheDocument()
    })
    await screen.findByRole('link', { name: 'Ada Lovelace' })
  }

  it('loads linked people from the deal endpoint', async () => {
    renderSection(jest.fn(async () => {}))
    await waitForInitialLoad()

    expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/deals/deal-1/people?page=1&pageSize=20&sort=name-asc',
      undefined,
      expect.any(Object),
    )
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
  })

  it('unlinks a person by saving the remaining selection', async () => {
    const onSaveSelection = jest.fn(async () => {})
    renderSection(onSaveSelection)
    await waitForInitialLoad()

    const row = screen.getByRole('link', { name: 'Ada Lovelace' }).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Open actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unlink' }))

    await waitFor(() => {
      expect(onSaveSelection).toHaveBeenCalledWith(['person-2'])
    })
  })

  it('forwards the search query and sort mode to the deal endpoint', async () => {
    renderSection(jest.fn(async () => {}))
    await waitForInitialLoad()

    fireEvent.change(screen.getByPlaceholderText('Search by name, role, email...'), {
      target: { value: 'grace' },
    })

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        '/api/customers/deals/deal-1/people?page=1&pageSize=20&sort=name-asc&search=grace',
        undefined,
        expect.any(Object),
      )
    }, { timeout: 3000 })

    await waitForInitialLoad()
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        '/api/customers/deals/deal-1/people?page=1&pageSize=20&sort=name-desc&search=grace',
        undefined,
        expect.any(Object),
      )
    })
  })

  it('keeps the search box visible and sorts from the Name column header (#7493)', async () => {
    renderSection(jest.fn(async () => {}))
    await waitForInitialLoad()

    expect(screen.getByPlaceholderText('Search by name, role, email...')).toBeVisible()
    expect(screen.queryByRole('button', { name: /search and sort/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    const nameHeader = screen.getByRole('columnheader', { name: 'Name' })
    await waitFor(() => expect(nameHeader).toHaveAttribute('aria-sort', 'ascending'))
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    await waitFor(() => expect(nameHeader).toHaveAttribute('aria-sort', 'descending'))
  })

  it('renders the empty state with both link and add actions when nothing is linked', async () => {
    readApiResultOrThrowMock.mockImplementation(async () => ({
      items: [],
      page: 1,
      total: 0,
      totalPages: 1,
    }))

    renderSection(jest.fn(async () => {}), { selectedIds: [] })

    expect(await screen.findByText('Link the people involved')).toBeInTheDocument()
    expect(screen.getByText('No people linked to this deal yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Link existing person/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add person' })).toBeInTheDocument()
  })

  it('opens a company-less create dialog from the add-person action', async () => {
    renderSection(jest.fn(async () => {}))
    await waitForInitialLoad()

    expect(screen.queryByText(/create-person-dialog/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }))

    // The deal has no company context to pre-fill, so the dialog must offer the ordinary
    // editable picker rather than a locked field.
    expect(screen.getByText('create-person-dialog:no-company')).toBeInTheDocument()
  })

  it('links the newly created person to the deal', async () => {
    const onSaveSelection = jest.fn(async () => {})
    renderSection(onSaveSelection)
    await waitForInitialLoad()

    fireEvent.click(screen.getByRole('button', { name: /Add person/ }))
    fireEvent.click(screen.getByRole('button', { name: 'submit-create-person' }))

    await waitFor(() => {
      expect(onSaveSelection).toHaveBeenCalledWith(['person-1', 'person-2', 'person-new'])
    })
  })

  // --- guards on the two surfaces deferred until `linkedAt` is durable ---

  it('offers only the name sort, never a "Linked" column or "recently linked" sort', async () => {
    renderSection(jest.fn(async () => {}))
    await waitForInitialLoad()

    expect(screen.getByRole('button', { name: 'Name' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Linked' })).not.toBeInTheDocument()
  })

  // `LinkEntityDialog` resets its query, results and draft selection whenever `adapter`
  // changes identity. The deal page passes `onSaveSelection` as an inline arrow, so anything
  // derived from it would rebuild the adapter on every parent render and wipe a dialog the
  // user is in the middle of using.
  it('keeps the link adapter referentially stable across re-renders', async () => {
    const { rerender } = renderSection(jest.fn(async () => {}))
    await waitForInitialLoad()

    const first = capturedAdapters[capturedAdapters.length - 1]
    expect(first).toBeDefined()

    // A fresh inline onSaveSelection, exactly as the page produces on every render.
    rerender(
      <DealPeopleSection
        dealId="deal-1"
        dealName="Expansion renewal"
        selectedIds={['person-1', 'person-2']}
        onSaveSelection={jest.fn(async () => {})}
        addActionLabel="Add person"
        emptyLabel="No people linked to this deal yet."
        emptyState={emptyState}
      />,
    )

    expect(capturedAdapters[capturedAdapters.length - 1]).toBe(first)
  })

  it('does not render the linked date in the rows', async () => {
    renderSection(jest.fn(async () => {}))
    await waitForInitialLoad()

    expect(screen.queryByText(formatDate(LINKED_AT) as string)).not.toBeInTheDocument()
  })
})
