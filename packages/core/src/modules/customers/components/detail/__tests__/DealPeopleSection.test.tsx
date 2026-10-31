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
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DealPeopleSection } from '../DealPeopleSection'
import type { LinkedPersonSummary } from '../LinkedPeopleSection'

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

jest.mock('../PersonCard', () => ({
  PersonCard: ({
    person,
    onUnlink,
    showLinkedDate,
  }: {
    person: LinkedPersonSummary
    onUnlink: (personId: string) => void
    showLinkedDate?: boolean
  }) => (
    <div>
      <span>{person.displayName}</span>
      <span>{`linked-date-shown:${showLinkedDate === true}`}</span>
      <button type="button" onClick={() => onUnlink(person.id)}>
        {`unlink-${person.id}`}
      </button>
    </div>
  ),
}))

describe('DealPeopleSection', () => {
  const emptyState = {
    title: 'Link the people involved',
    actionLabel: 'Add person',
  }

  const linkedPeople: LinkedPersonSummary[] = [
    { id: 'person-1', displayName: 'Ada Lovelace', jobTitle: 'VP Partnerships' },
    { id: 'person-2', displayName: 'Grace Hopper', jobTitle: 'Procurement lead' },
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
      expect(screen.queryByText(/Loading people/)).not.toBeInTheDocument()
    })
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

    fireEvent.click(screen.getByRole('button', { name: 'unlink-person-1' }))

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
    })

    fireEvent.change(screen.getByDisplayValue('Sort: Name A-Z'), {
      target: { value: 'name-desc' },
    })

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        '/api/customers/deals/deal-1/people?page=1&pageSize=20&sort=name-desc&search=grace',
        undefined,
        expect.any(Object),
      )
    })
  })

  it('toggles the filter controls off and on', async () => {
    renderSection(jest.fn(async () => {}))
    await waitForInitialLoad()

    expect(screen.getByPlaceholderText('Search by name, role, email...')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
    expect(screen.queryByPlaceholderText('Search by name, role, email...')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
    expect(screen.getByPlaceholderText('Search by name, role, email...')).toBeInTheDocument()
  })

  it('renders the empty state with both link and add actions when nothing is linked', async () => {
    readApiResultOrThrowMock.mockImplementation(async () => ({
      items: [],
      page: 1,
      total: 0,
      totalPages: 1,
    }))

    renderSection(jest.fn(async () => {}), { selectedIds: [] })
    await waitForInitialLoad()

    expect(screen.getByText('Link the people involved')).toBeInTheDocument()
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

  it('offers only the name sorts, never "recently linked"', async () => {
    renderSection(jest.fn(async () => {}))
    await waitForInitialLoad()

    const sortSelect = screen.getByDisplayValue('Sort: Name A-Z') as HTMLSelectElement
    const offered = Array.from(sortSelect.options).map((option) => option.value)

    expect(offered).toEqual(['name-asc', 'name-desc'])
    expect(offered).not.toContain('recent')
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

  it('does not render the linked date on the card', async () => {
    renderSection(jest.fn(async () => {}))
    await waitForInitialLoad()

    expect(screen.getAllByText('linked-date-shown:false')).toHaveLength(linkedPeople.length)
    expect(screen.queryByText('linked-date-shown:true')).not.toBeInTheDocument()
  })
})
