/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
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
})
