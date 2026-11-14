/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { LinkedPeopleSection, type LinkedPeopleSectionProps } from '../LinkedPeopleSection'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/backend/customers/companies-v2/company-1',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: jest.fn(async () => []),
  loadInjectionDataWidgetsForSpot: jest.fn(async () => []),
}))

jest.mock('../../linking/LinkEntityDialog', () => ({
  LinkEntityDialog: () => null,
}))

const mockNoInjectedDataWidgets = { widgets: [], isLoading: false, error: null }

jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => mockNoInjectedDataWidgets,
}))

const linkedPerson = { id: 'person-1', displayName: 'Avery Stone' }

function trackedLoadPage() {
  return jest.fn(async (_params: { sort: string }) => ({ items: [linkedPerson], page: 1, total: 1, totalPages: 1 }))
}

function requestedSorts(loadPage: ReturnType<typeof trackedLoadPage>): string[] {
  return loadPage.mock.calls.map(([params]) => params.sort)
}

function columnHeader(name: string) {
  return screen.getByRole('columnheader', { name: new RegExp(`^${name}`) })
}

function clickSortableHeader(name: string) {
  fireEvent.click(within(columnHeader(name)).getByRole('button'))
}

function renderSection(props: Partial<LinkedPeopleSectionProps> = {}) {
  return renderWithProviders(
    <LinkedPeopleSection
      scopeId="company-1"
      loadPage={async () => ({ items: [linkedPerson], page: 1, total: 1, totalPages: 1 })}
      onUnlink={async () => {}}
      linkAdapter={{} as LinkedPeopleSectionProps['linkAdapter']}
      onLinkConfirm={async () => {}}
      sectionTitle="People"
      searchPlaceholder="Search"
      linkActionLabel="Link person"
      emptyLabel="Nobody"
      emptyState={{ title: 'Nobody yet', actionLabel: 'Add' }}
      {...props}
    />,
  )
}

describe('LinkedPeopleSection', () => {
  it('still renders the deprecated sectionSubtitle for a caller that passes it', async () => {
    renderSection({ sectionSubtitle: 'Employees on the client side' })

    expect(await screen.findByText('Avery Stone')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument()
    expect(screen.getByText('Employees on the client side')).toBeInTheDocument()
  })

  it('renders no subtitle when the prop is left out', async () => {
    renderSection()

    expect(await screen.findByText('Avery Stone')).toBeInTheDocument()
    expect(screen.queryByText('Employees on the client side')).toBeNull()
  })

  describe('header sorting stays inside availableSorts', () => {
    it.each([
      { allowed: 'name-asc' as const },
      { allowed: 'name-desc' as const },
    ])('offers no name toggle when only $allowed is allowed', async ({ allowed }) => {
      const loadPage = trackedLoadPage()
      renderSection({ availableSorts: [allowed], loadPage: loadPage as LinkedPeopleSectionProps['loadPage'] })
      await screen.findByText('Avery Stone')

      expect(within(columnHeader('Name')).queryByRole('button')).toBeNull()
      expect(new Set(requestedSorts(loadPage))).toEqual(new Set([allowed]))
    })

    it('moves between the allowed modes without reaching the other name direction', async () => {
      const loadPage = trackedLoadPage()
      renderSection({ availableSorts: ['name-asc', 'recent'], loadPage: loadPage as LinkedPeopleSectionProps['loadPage'] })
      await screen.findByText('Avery Stone')

      clickSortableHeader('Linked')
      await waitFor(() => expect(requestedSorts(loadPage)).toContain('recent'))
      clickSortableHeader('Name')
      await waitFor(() => expect(requestedSorts(loadPage).at(-1)).toBe('name-asc'))
      clickSortableHeader('Name')
      clickSortableHeader('Name')

      await screen.findByText('Avery Stone')
      expect(requestedSorts(loadPage)).not.toContain('name-desc')
    })

    it('still toggles both directions when both are allowed', async () => {
      const loadPage = trackedLoadPage()
      renderSection({ loadPage: loadPage as LinkedPeopleSectionProps['loadPage'] })
      await screen.findByText('Avery Stone')

      clickSortableHeader('Name')

      await waitFor(() => expect(requestedSorts(loadPage)).toContain('name-desc'))
    })
  })

  describe('recency sort in a container too narrow for the Linked column', () => {
    const measuredWidth = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    const scrollIntoView = Element.prototype.scrollIntoView

    function measureContainerAs(width: number) {
      measuredWidth.mockImplementation(() => ({
        width,
        height: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }))
    }

    beforeAll(() => {
      Element.prototype.scrollIntoView = jest.fn()
    })

    afterEach(() => {
      measuredWidth.mockReset()
    })

    afterAll(() => {
      measuredWidth.mockRestore()
      Element.prototype.scrollIntoView = scrollIntoView
    })

    it('offers a compact sort control that can request the recent order at phone width', async () => {
      measureContainerAs(390)
      const loadPage = trackedLoadPage()
      renderSection({ loadPage: loadPage as LinkedPeopleSectionProps['loadPage'] })
      await screen.findByText('Avery Stone')

      expect(screen.queryByRole('columnheader', { name: /^Linked/ })).toBeNull()
      const sortControl = screen.getByRole('combobox', { name: 'Sort order' })
      fireEvent.keyDown(sortControl, { key: 'Enter' })
      fireEvent.click(await screen.findByRole('option', { name: 'Sort: Recently linked' }))

      await waitFor(() => expect(requestedSorts(loadPage).at(-1)).toBe('recent'))
      expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'recent', page: 1 }))
    })

    it('lists only the sort modes the host allows', async () => {
      measureContainerAs(390)
      renderSection({ availableSorts: ['name-asc', 'recent'] })
      await screen.findByText('Avery Stone')

      fireEvent.keyDown(screen.getByRole('combobox', { name: 'Sort order' }), { key: 'Enter' })

      const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
      expect(options).toEqual(['Sort: Name A-Z', 'Sort: Recently linked'])
    })

    it('keeps the sort in the Linked header, with no extra control, once the column fits', async () => {
      measureContainerAs(640)
      renderSection()
      await screen.findByText('Avery Stone')

      expect(columnHeader('Linked')).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'Sort order' })).toBeNull()
    })

    it('offers no compact control to a host that does not allow the recent order', async () => {
      measureContainerAs(390)
      renderSection({ availableSorts: ['name-asc', 'name-desc'], showLinkedDate: false })
      await screen.findByText('Avery Stone')

      expect(screen.queryByRole('combobox', { name: 'Sort order' })).toBeNull()
    })
  })
})
