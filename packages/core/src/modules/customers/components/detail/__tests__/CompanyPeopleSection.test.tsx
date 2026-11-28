/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CompanyPeopleSection, type CompanyPersonSummary } from '../CompanyPeopleSection'

const pushMock = jest.fn()
const flashMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('../RolesSection', () => ({
  RolesSection: () => null,
}))

jest.mock('../CreatePersonDialog', () => ({
  CreatePersonDialog: ({
    open,
  }: {
    open: boolean
  }) => (open ? <div>Add new person</div> : null),
}))

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

jest.mock('../DecisionMakersFooter', () => ({
  DecisionMakersFooter: () => null,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="dialog-content" {...props}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('CompanyPeopleSection', () => {
  const emptyState = {
    title: 'Build the account team',
    actionLabel: 'Create person',
  }

  function mockCompanyPeopleApi(options?: {
    linkedPeople?: CompanyPersonSummary[]
    searchItems?: Array<Record<string, unknown>>
  }) {
    const linkedPeople = options?.linkedPeople ?? []
    const searchItems = options?.searchItems ?? []
    readApiResultOrThrowMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customers/companies/company-123/people')) {
        return {
          items: linkedPeople,
          page: 1,
          total: linkedPeople.length,
          totalPages: 1,
        }
      }
      return {
        items: searchItems,
        totalPages: 1,
      }
    })
  }

  beforeEach(() => {
    pushMock.mockReset()
    flashMock.mockReset()
    apiCallOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockReset()
    mockCompanyPeopleApi()
  })

  async function waitForInitialPeopleLoad() {
    await waitFor(() => {
      expect(screen.queryByText(/Loading data/)).not.toBeInTheDocument()
    })
  }

  async function openRowActions(personName: string) {
    const row = (await screen.findByRole('link', { name: personName })).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Open actions' }))
  }

  function columnHeaderLabels() {
    return screen.getAllByRole('columnheader').map((header) => header.textContent)
  }

  function renderSectionWithPeople(people: CompanyPersonSummary[]) {
    mockCompanyPeopleApi({ linkedPeople: people })
    return renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={people}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
      />,
    )
  }

  function peopleUrls() {
    return readApiResultOrThrowMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith('/api/customers/companies/company-123/people'))
  }

  describe('column collapse with the container width', () => {
    const OriginalResizeObserver = globalThis.ResizeObserver
    let resizeCallbacks: ResizeObserverCallback[] = []

    beforeEach(() => {
      resizeCallbacks = []
      globalThis.ResizeObserver = class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    })

    afterEach(() => {
      globalThis.ResizeObserver = OriginalResizeObserver
    })

    function resizeContainer(width: number) {
      act(() => {
        const entries = [{ contentRect: { width } }] as unknown as ResizeObserverEntry[]
        resizeCallbacks.forEach((callback) => callback(entries, {} as ResizeObserver))
      })
    }

    it('keeps only the name below 576px and adds columns from the right as the card widens', async () => {
      renderSectionWithPeople([
        { id: 'person-1', displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' },
      ])
      await screen.findByRole('link', { name: 'Ada Lovelace' })

      resizeContainer(480)
      expect(columnHeaderLabels()).toEqual(['Name', 'Actions'])
      expect(screen.queryByRole('link', { name: 'ada@example.com' })).not.toBeInTheDocument()

      resizeContainer(576)
      expect(columnHeaderLabels()).toEqual(['Name', 'Email', 'Linked', 'Actions'])
      expect(screen.getByRole('link', { name: 'ada@example.com' })).toBeInTheDocument()

      resizeContainer(768)
      expect(columnHeaderLabels()).toEqual(['Name', 'Email', 'Phone', 'Linked', 'Actions'])

      resizeContainer(896)
      expect(columnHeaderLabels()).toEqual(['Name', 'Email', 'Phone', 'Lifecycle stage', 'Linked', 'Actions'])

      resizeContainer(1024)
      expect(columnHeaderLabels()).toEqual(['Name', 'Email', 'Phone', 'Lifecycle stage', 'Source', 'Linked', 'Actions'])
    })
  })

  it('sends the search query to the people endpoint, back on page 1', async () => {
    renderSectionWithPeople([{ id: 'person-1', displayName: 'Ada Lovelace' }])
    await screen.findByRole('link', { name: 'Ada Lovelace' })

    fireEvent.change(screen.getByPlaceholderText('Search by name, role, email...'), {
      target: { value: 'ada' },
    })

    await waitFor(() => {
      expect(peopleUrls().at(-1)).toContain('search=ada')
    }, { timeout: 3000 })
    expect(peopleUrls().at(-1)).toContain('page=1')
  })

  it('pages through the server results from the table footer, and only when there is a next page', async () => {
    readApiResultOrThrowMock.mockImplementation(async (url: string) => {
      const page = Number(new URL(url, 'http://localhost').searchParams.get('page') ?? '1')
      return {
        items: [{ id: `person-${page}`, displayName: `Person ${page}` }],
        page,
        total: 21,
        totalPages: 2,
      }
    })

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
      />,
    )

    await screen.findByRole('link', { name: 'Person 1' })
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    expect(await screen.findByRole('link', { name: 'Person 2' })).toBeInTheDocument()
    expect(peopleUrls().at(-1)).toContain('page=2')
    expect(peopleUrls().at(-1)).toContain('pageSize=20')
  })

  it('keeps keyboard focus on the star button when toggling it', async () => {
    renderSectionWithPeople([{ id: 'person-1', displayName: 'Ada Lovelace' }])
    await screen.findByRole('link', { name: 'Ada Lovelace' })

    const starButton = screen.getByRole('button', { name: 'Star' })
    starButton.focus()
    fireEvent.click(starButton)

    expect(await screen.findByRole('button', { name: 'Remove star' })).toBe(starButton)
    expect(starButton).toHaveFocus()
  })

  it('shows no pager for a single page of people', async () => {
    renderSectionWithPeople([{ id: 'person-1', displayName: 'Ada Lovelace' }])
    await screen.findByRole('link', { name: 'Ada Lovelace' })

    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
  })

  it('offers open and unlink from the row menu without making the row itself a link', async () => {
    renderSectionWithPeople([{ id: 'person-1', displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' }])

    const nameLink = await screen.findByRole('link', { name: 'Ada Lovelace' })
    fireEvent.click(nameLink.closest('td') as HTMLElement)
    expect(pushMock).not.toHaveBeenCalled()

    await openRowActions('Ada Lovelace')
    expect(await screen.findByRole('menuitem', { name: 'Open person' })).toHaveAttribute('href', '/backend/customers/people-v2/person-1')
    expect(screen.getByRole('menuitem', { name: 'Unlink' })).toBeInTheDocument()
  })

  it('reloads with the recent sort from a Linked header the default zone 2 width shows', async () => {
    mockCompanyPeopleApi({ linkedPeople: [{ id: 'person-1', displayName: 'Ada Lovelace' }] })

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
      />,
    )

    const linkedHeader = await screen.findByRole('button', { name: 'Linked' })
    expect(linkedHeader.closest('th')).toHaveAttribute('aria-sort', 'none')
    expect(readApiResultOrThrowMock.mock.calls.map(([url]) => String(url)).join()).not.toContain('sort=recent')

    fireEvent.click(linkedHeader)

    await waitFor(() => {
      const peopleUrls = readApiResultOrThrowMock.mock.calls.map(([url]) => String(url))
      expect(peopleUrls.at(-1)).toContain('/api/customers/companies/company-123/people')
      expect(peopleUrls.at(-1)).toContain('sort=recent')
    })
    const sortedHeader = await screen.findByRole('button', { name: 'Linked' })
    await waitFor(() => expect(sortedHeader.closest('th')).toHaveAttribute('aria-sort', 'descending'))
    expect(screen.getByRole('button', { name: 'Name' }).closest('th')).toHaveAttribute('aria-sort', 'none')

    const readsAfterSort = peopleUrls().length
    fireEvent.click(sortedHeader)
    await waitFor(() => expect(sortedHeader.closest('th')).toHaveAttribute('aria-sort', 'descending'))
    expect(peopleUrls()).toHaveLength(readsAfterSort)
  })

  it('opens the inline create dialog from the empty state', async () => {
    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
      />,
    )

    await waitForInitialPeopleLoad()
    fireEvent.click(await screen.findByRole('button', { name: 'Create person' }))

    expect(screen.getByText('Add new person')).toBeInTheDocument()
  })

  // #5944: the role filter chips used to be built from English literals while every sibling
  // string in the same adapter call went through the translator, so the dialog stayed English
  // in every other locale.
  it('renders the link dialog role filters through the translator', async () => {
    const dictionary: Record<string, string> = {
      'customers.linking.person.role.all': 'Wszystkie',
      'customers.linking.person.role.decisionMaker': 'Decydent',
      'customers.linking.person.role.budgetHolder': 'Dysponent budżetu',
      'customers.linking.person.role.stakeholder': 'Interesariusz',
      'customers.linking.person.role.contact': 'Kontakt',
    }
    const translator = (key: string, fallback?: string) => dictionary[key] ?? fallback ?? key

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
        translator={translator}
      />,
    )

    await waitForInitialPeopleLoad()
    fireEvent.click(screen.getByRole('button', { name: 'Link existing person' }))

    for (const label of Object.values(dictionary)) {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Decision maker' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
  })

  it('links an existing person through the guarded mutation path', async () => {
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())
    const onPeopleChange = jest.fn()
    mockCompanyPeopleApi({
      searchItems: [
        {
          id: 'person-2',
          display_name: 'Ada Lovelace',
          primary_email: 'ada@example.com',
          lifecycle_stage: 'Lead',
        },
      ],
    })
    apiCallOrThrowMock.mockResolvedValue({ ok: true })

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
        onPeopleChange={onPeopleChange}
        runGuardedMutation={runGuardedMutation}
      />,
    )

    await waitForInitialPeopleLoad()
    fireEvent.click(screen.getByRole('button', { name: 'Link existing person' }))

    const checkbox = await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' })
    fireEvent.click(checkbox)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Link (person|company|deal)/ }))
    })

    expect(runGuardedMutation).toHaveBeenCalled()
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/people/person-2/companies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ companyId: 'company-123' }),
      }),
      expect.any(Object),
    )
    await waitFor(() => {
      expect(onPeopleChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'person-2',
            displayName: 'Ada Lovelace',
          }),
        ]),
      )
    })
  })

  it('links multiple existing people from the same dialog', async () => {
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())
    const onPeopleChange = jest.fn()
    mockCompanyPeopleApi({
      searchItems: [
        {
          id: 'person-2',
          display_name: 'Ada Lovelace',
          primary_email: 'ada@example.com',
        },
        {
          id: 'person-3',
          display_name: 'Grace Hopper',
          primary_email: 'grace@example.com',
        },
      ],
    })
    apiCallOrThrowMock.mockResolvedValue({ ok: true })

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
        onPeopleChange={onPeopleChange}
        runGuardedMutation={runGuardedMutation}
      />,
    )

    await waitForInitialPeopleLoad()
    fireEvent.click(screen.getByRole('button', { name: 'Link existing person' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Link (person|company|deal)/ }))
    })

    expect(apiCallOrThrowMock).toHaveBeenNthCalledWith(
      1,
      '/api/customers/people/person-2/companies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ companyId: 'company-123' }),
      }),
      expect.any(Object),
    )
    expect(apiCallOrThrowMock).toHaveBeenNthCalledWith(
      2,
      '/api/customers/people/person-3/companies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ companyId: 'company-123' }),
      }),
      expect.any(Object),
    )
    await waitFor(() => {
      expect(onPeopleChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'person-2', displayName: 'Ada Lovelace' }),
          expect.objectContaining({ id: 'person-3', displayName: 'Grace Hopper' }),
        ]),
      )
    })
  })

  it('selects multiple visible candidates via checkboxes and links them in one save', async () => {
    let linkedPeople: CompanyPersonSummary[] = []
    const searchablePeople = [
      {
        id: 'person-2',
        display_name: 'Ada Lovelace',
        primary_email: 'ada@example.com',
      },
      {
        id: 'person-3',
        display_name: 'Grace Hopper',
        primary_email: 'grace@example.com',
      },
    ]

    readApiResultOrThrowMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customers/companies/company-123/people')) {
        return {
          items: linkedPeople,
          page: 1,
          total: linkedPeople.length,
          totalPages: 1,
        }
      }
      return {
        items: searchablePeople,
        totalPages: 1,
      }
    })
    apiCallOrThrowMock.mockImplementation(async (url: string) => {
      if (url.includes('/people/person-2/companies')) {
        linkedPeople = [
          {
            id: 'person-2',
            displayName: 'Ada Lovelace',
            primaryEmail: 'ada@example.com',
          },
        ]
      }
      if (url.includes('/people/person-3/companies')) {
        linkedPeople = [
          {
            id: 'person-2',
            displayName: 'Ada Lovelace',
            primaryEmail: 'ada@example.com',
          },
          {
            id: 'person-3',
            displayName: 'Grace Hopper',
            primaryEmail: 'grace@example.com',
          },
        ]
      }
      return { ok: true }
    })

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
      />,
    )

    await waitForInitialPeopleLoad()
    fireEvent.click(screen.getByRole('button', { name: 'Link existing person' }))

    const adaCheckbox = await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' })
    fireEvent.click(adaCheckbox)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Link (person|company|deal)/ }))
    })

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    })
  })

  it('submits the link dialog on Cmd/Ctrl+Enter', async () => {
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())
    mockCompanyPeopleApi({
      searchItems: [
        {
          id: 'person-2',
          display_name: 'Ada Lovelace',
        },
      ],
    })
    apiCallOrThrowMock.mockResolvedValue({ ok: true })

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
        runGuardedMutation={runGuardedMutation}
      />,
    )

    await waitForInitialPeopleLoad()
    fireEvent.click(screen.getByRole('button', { name: 'Link existing person' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' }))

    const dialog = screen.getByTestId('dialog-content')

    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })
    })

    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/people/person-2/companies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ companyId: 'company-123' }),
      }),
      expect.any(Object),
    )
  })

  it('does not trigger a setState-in-render warning when the parent syncs linked people', async () => {
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    let linkedPeople: CompanyPersonSummary[] = []
    readApiResultOrThrowMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customers/companies/company-123/people')) {
        return {
          items: linkedPeople,
          page: 1,
          total: linkedPeople.length,
          totalPages: 1,
        }
      }
      return {
        items: [
          {
            id: 'person-2',
            display_name: 'Ada Lovelace',
          },
        ],
        totalPages: 1,
      }
    })
    apiCallOrThrowMock.mockImplementation(async () => {
      linkedPeople = [
        {
          id: 'person-2',
          displayName: 'Ada Lovelace',
        },
      ]
      return { ok: true }
    })

    function Harness() {
      const [people, setPeople] = React.useState<CompanyPersonSummary[]>([])
      return (
        <CompanyPeopleSection
          companyId="company-123"
          initialPeople={people}
          addActionLabel="Add person"
          emptyLabel="No linked people yet."
          emptyState={emptyState}
          onPeopleChange={setPeople}
          runGuardedMutation={runGuardedMutation}
        />
      )
    }

    try {
      renderWithProviders(<Harness />)

      await waitForInitialPeopleLoad()
      fireEvent.click(screen.getByRole('button', { name: 'Link existing person' }))
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' }))

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Link (person|company|deal)/ }))
      })

      await waitFor(() => {
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
      })

      const stateUpdateWarnings = consoleErrorSpy.mock.calls.filter((call) =>
        call.some((value) => typeof value === 'string' && value.includes('Cannot update a component'))
      )
      expect(stateUpdateWarnings).toHaveLength(0)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('unlinks a person through the guarded mutation path', async () => {
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())
    const onPeopleChange = jest.fn()
    const initialPeople: CompanyPersonSummary[] = [
      {
        id: 'person-1',
        displayName: 'Grace Hopper',
      },
    ]
    let linked = initialPeople
    readApiResultOrThrowMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customers/companies/company-123/people')) {
        return {
          items: linked,
          page: 1,
          total: linked.length,
          totalPages: 1,
        }
      }
      return { items: [], totalPages: 1 }
    })
    apiCallOrThrowMock.mockImplementation(async () => {
      linked = []
      return { ok: true }
    })

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={initialPeople}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
        onPeopleChange={onPeopleChange}
        runGuardedMutation={runGuardedMutation}
      />,
    )

    await openRowActions('Grace Hopper')
    const unlinkItem = await screen.findByRole('menuitem', { name: 'Unlink' })

    await act(async () => {
      fireEvent.click(unlinkItem)
    })

    expect(runGuardedMutation).toHaveBeenCalled()
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/people/person-1/companies/company-123',
      expect.objectContaining({ method: 'DELETE' }),
      expect.any(Object),
    )
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Grace Hopper' })).toBeNull()
    })
  })

  it('keeps the add-person action in the section without duplicating it in the tab header', async () => {
    const onActionChange = jest.fn()
    mockCompanyPeopleApi({
      linkedPeople: [
        {
          id: 'person-1',
          displayName: 'Grace Hopper',
        },
      ],
    })

    const { unmount } = renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[
          {
            id: 'person-1',
            displayName: 'Grace Hopper',
          },
        ]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
        onActionChange={onActionChange}
      />,
    )

    await waitForInitialPeopleLoad()
    expect(onActionChange).toHaveBeenCalledWith(null)
    expect(onActionChange.mock.calls.every(([action]) => action === null)).toBe(true)
    expect(screen.getAllByRole('button', { name: 'Add person', exact: true })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Link existing person' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Add person', exact: true }))
    expect(screen.getByText('Add new person')).toBeInTheDocument()

    onActionChange.mockClear()
    unmount()
    expect(onActionChange).toHaveBeenCalledWith(null)
  })

  it('navigates to the next search page via numbered pagination', async () => {
    readApiResultOrThrowMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customers/companies/company-123/people')) {
        return {
          items: [],
          page: 1,
          total: 0,
          totalPages: 1,
        }
      }
      const parsed = new URL(url, 'http://localhost')
      const page = Number(parsed.searchParams.get('page') ?? '1')
      if (page === 1) {
        return {
          items: [
            {
              id: 'person-2',
              display_name: 'Ada Lovelace',
              primary_email: 'ada@example.com',
            },
          ],
          totalPages: 2,
        }
      }
      return {
        items: [
          {
            id: 'person-3',
            display_name: 'Grace Hopper',
            primary_email: 'grace@example.com',
          },
        ],
        totalPages: 2,
      }
    })

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Link existing person' }))
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
    })

    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument()
  })

  it('shows the search box and sortable headers by default when linked people exist', async () => {
    mockCompanyPeopleApi({
      linkedPeople: [
        {
          id: 'person-1',
          displayName: 'Grace Hopper',
          primaryEmail: 'grace@example.com',
        },
      ],
    })

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[
          {
            id: 'person-1',
            displayName: 'Grace Hopper',
            primaryEmail: 'grace@example.com',
          },
        ]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
      />,
    )

    expect(screen.getByPlaceholderText('Search by name, role, email...')).toBeInTheDocument()
    const nameHeader = await screen.findByRole('columnheader', { name: 'Name' })
    await waitFor(() => expect(nameHeader).toHaveAttribute('aria-sort', 'ascending'))
    expect(screen.getByRole('button', { name: 'Linked' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /search and sort/i })).not.toBeInTheDocument()
  })

  // Live refresh for a detach performed in ANOTHER session. A link-backed detach broadcasts
  // `customers.person_company_link.deleted`; a legacy profile-only one has no link row and
  // broadcasts `customers.person.company_assignment.detached` instead (#5114). This tab must
  // reload on both, or it keeps listing someone who is already gone.
  describe.each([
    ['customers.person_company_link.deleted'],
    ['customers.person.company_assignment.detached'],
  ])('%s', (eventId) => {
    async function dispatchDetach(companyEntityId: string) {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent('om:event', {
            detail: {
              id: eventId,
              payload: { linkId: null, personEntityId: 'person-1', companyEntityId },
              timestamp: 1,
              organizationId: 'org-1',
            },
          }),
        )
      })
    }

    function countPeopleReads() {
      return readApiResultOrThrowMock.mock.calls.filter(([url]) =>
        typeof url === 'string' && url.startsWith('/api/customers/companies/company-123/people'),
      ).length
    }

    it('reloads the people list when the detach targets this company', async () => {
      renderWithProviders(
        <CompanyPeopleSection
          companyId="company-123"
          initialPeople={[]}
          addActionLabel="Add person"
          emptyLabel="No linked people yet."
          emptyState={emptyState}
        />,
      )
      await waitForInitialPeopleLoad()
      const before = countPeopleReads()

      await dispatchDetach('company-123')

      await waitFor(() => {
        expect(countPeopleReads()).toBeGreaterThan(before)
      })
    })

    it('ignores a detach that targets a different company', async () => {
      renderWithProviders(
        <CompanyPeopleSection
          companyId="company-123"
          initialPeople={[]}
          addActionLabel="Add person"
          emptyLabel="No linked people yet."
          emptyState={emptyState}
        />,
      )
      await waitForInitialPeopleLoad()
      const before = countPeopleReads()

      await dispatchDetach('company-999')

      expect(countPeopleReads()).toBe(before)
    })
  })
})
