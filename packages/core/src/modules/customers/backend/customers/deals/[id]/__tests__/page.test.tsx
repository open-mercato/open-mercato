/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import DealDetailPage from '../page'

const readApiResultOrThrowMock = jest.fn()
const updateCrudMock = jest.fn()
const deleteCrudMock = jest.fn()
const replaceMock = jest.fn()
const pushMock = jest.fn()
const inlineActivityComposerMock = jest.fn(
  ({
    entityType,
    entityId,
    onScheduleRequested,
  }: {
    entityType: string
    entityId: string
    onScheduleRequested?: () => void
  }) => (
    <div data-testid="inline-activity-composer">
      {entityType}:{entityId}:{onScheduleRequested ? 'schedule-enabled' : 'schedule-disabled'}
    </div>
  ),
)
const plannedActivitiesSectionMock = jest.fn(
  ({ onSchedule }: { onSchedule?: () => void }) => (
    <div data-testid="planned-activities-section">
      {onSchedule ? 'schedule-enabled' : 'schedule-disabled'}
    </div>
  ),
)
let activeTabParam: string | null = 'activities'
let detailRequestCount = 0

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'tab' ? activeTabParam : null),
    toString: () => (activeTabParam ? `tab=${activeTabParam}` : ''),
  }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  AttachmentsSection: ({
    entityId,
    recordId,
    title,
    description,
  }: {
    entityId: string
    recordId: string | null
    title?: string
    description?: string
  }) => (
    <div data-testid="attachments-section">
      {entityId}:{recordId}:{title}:{description}
    </div>
  ),
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  NotesSection: () => <div>notes</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/crud/CollapsibleZoneLayout', () => ({
  CollapsibleZoneLayout: ({ zone1, zone2 }: { zone1: React.ReactNode; zone2: React.ReactNode }) => <div>{zone1}{zone2}</div>,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
  deleteCrud: (...args: unknown[]) => deleteCrudMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [] }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(async () => true),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  createTranslatorWithFallback: () => (_key: string, fallback?: string) => fallback ?? '',
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    customers: {
      customer_deal: 'customer_deal',
    },
  },
}), { virtual: true })

jest.mock('../../../../../components/detail/DealDetailHeader', () => ({
  DealDetailHeader: ({ deal }: { deal: { title: string } }) => <div>{deal.title}</div>,
}))

jest.mock('../../../../../components/detail/DealDetailTabs', () => ({
  resolveLegacyTab: (tab?: string | null) => {
    if (tab === 'activities' || tab === 'people' || tab === 'companies' || tab === 'notes' || tab === 'files' || tab === 'changelog') {
      return tab
    }
    return 'activities'
  },
  DealDetailTabs: ({
    children,
    activeTab,
    onTabChange,
  }: {
    children: React.ReactNode
    activeTab: string
    onTabChange: (tab: string) => void
  }) => (
    <div>
      <div data-testid="active-tab">{activeTab}</div>
      <button type="button" onClick={() => onTabChange('activities')}>tab-activities</button>
      <button type="button" onClick={() => onTabChange('companies')}>tab-companies</button>
      <button type="button" onClick={() => onTabChange('files')}>tab-files</button>
      <button type="button" onClick={() => onTabChange('changelog')}>tab-changelog</button>
      {children}
    </div>
  ),
}))

jest.mock('../../../../../components/detail/DealForm', () => ({
  DealForm: () => <div>form</div>,
  useDealAssociationLookups: () => ({
    searchPeoplePage: jest.fn(async () => ({ items: [], totalPages: 1 })),
    fetchPeopleByIds: jest.fn(),
    searchCompaniesPage: jest.fn(async () => ({ items: [], totalPages: 1 })),
    fetchCompaniesByIds: jest.fn(),
  }),
}))

jest.mock('../../../../../components/detail/DealLinkedEntitiesTab', () => ({
  DealLinkedEntitiesTab: ({
    entityLabelPlural,
    onSaveSelection,
  }: {
    entityLabelPlural: string
    onSaveSelection: (next: string[]) => void
  }) => (
    <div>
      <div>{entityLabelPlural}</div>
      <button
        type="button"
        onClick={() => onSaveSelection(entityLabelPlural === 'People' ? ['person-2'] : ['company-2'])}
      >
        {entityLabelPlural === 'People' ? 'manage-people-links' : 'manage-company-links'}
      </button>
    </div>
  ),
}))

jest.mock('../../../../../components/detail/PipelineStepper', () => ({
  PipelineStepper: ({ footer }: { footer?: React.ReactNode }) => <div>pipeline{footer}</div>,
}))

jest.mock('../../../../../components/detail/DealClosureActionBar', () => ({
  DealClosureActionBar: ({
    closureOutcome,
    onWon,
    onLost,
  }: {
    closureOutcome: string | null
    onWon: () => void
    onLost: () => void
  }) => (
    closureOutcome ? null : (
      <div>
        <button type="button" onClick={onWon}>Won</button>
        <button type="button" onClick={onLost}>Lost</button>
      </div>
    )
  ),
}))

jest.mock('../../../../../components/detail/ConfirmDealLostDialog', () => ({
  ConfirmDealLostDialog: ({ open }: { open: boolean }) => (open ? <div>lost-dialog</div> : null),
}))

jest.mock('../../../../../components/detail/DealWonPopup', () => ({
  DealWonPopup: ({ open, stats }: { open: boolean; stats: { pipelineName?: string | null } | null }) => (
    open ? <div>won-popup:{stats?.pipelineName ?? 'none'}</div> : null
  ),
}))

jest.mock('../../../../../components/detail/DealLostSummaryDialog', () => ({
  DealLostSummaryDialog: ({ open }: { open: boolean }) => (open ? <div>lost-popup</div> : null),
}))

jest.mock('../../../../../components/detail/ActivitiesSection', () => ({
  ActivitiesSection: () => <div>activities</div>,
}))

jest.mock('../../../../../components/detail/InlineActivityComposer', () => ({
  InlineActivityComposer: (props: {
    entityType: string
    entityId: string
    onScheduleRequested?: () => void
  }) => inlineActivityComposerMock(props),
}))

jest.mock('../../../../../components/detail/PlannedActivitiesSection', () => ({
  PlannedActivitiesSection: (props: { onSchedule?: () => void }) => plannedActivitiesSectionMock(props),
}))

jest.mock('../../../../../components/detail/ScheduleActivityDialog', () => ({
  ScheduleActivityDialog: ({
    entityType,
    entityId,
  }: {
    entityType: string
    entityId: string
  }) => <div data-testid="schedule-activity-dialog">{entityType}:{entityId}</div>,
}))

jest.mock('../../../../../components/detail/ChangelogTab', () => ({
  ChangelogTab: () => <div>changelog</div>,
}))

jest.mock('../../../../../components/detail/notesAdapter', () => ({
  createCustomerNotesAdapter: () => ({}),
}))

jest.mock('../../../../../lib/markdownPreference', () => ({
  readMarkdownPreferenceCookie: jest.fn(),
  writeMarkdownPreferenceCookie: jest.fn(),
}))

jest.mock('../../../../../lib/dictionaries', () => ({
  ICON_SUGGESTIONS: [],
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  renderDictionaryColor: jest.fn(),
  renderDictionaryIcon: jest.fn(),
}))

function createDealPayload(closureOutcome: 'won' | 'lost' | null = null) {
  return {
    deal: {
      id: 'deal-1',
      title: 'Expansion renewal',
      description: null,
      status: 'qualified',
      pipelineStage: 'Discovery',
      pipelineId: 'pipeline-1',
      pipelineStageId: 'stage-1',
      valueAmount: '12000',
      valueCurrency: 'USD',
      probability: 65,
      expectedCloseAt: null,
      ownerUserId: 'owner-1',
      source: 'Referral',
      closureOutcome,
      lossReasonId: null,
      lossNotes: closureOutcome === 'lost' ? 'Budget freeze' : null,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      createdAt: '2026-04-10T08:00:00.000Z',
      updatedAt: '2026-04-14T16:30:00.000Z',
    },
    people: [
      {
        id: 'person-1',
        label: 'Ada Lovelace',
        subtitle: 'VP Partnerships',
        kind: 'person' as const,
      },
    ],
    companies: [
      {
        id: 'company-1',
        label: 'Brightside Solar',
        subtitle: 'brightside.example',
        kind: 'company' as const,
      },
    ],
    linkedPersonIds: ['person-1'],
    linkedCompanyIds: ['company-1'],
    counts: {
      people: 1,
      companies: 1,
    },
    customFields: {},
    viewer: {
      userId: 'user-1',
      name: 'Viewer User',
      email: 'viewer@example.com',
    },
    pipelineStages: [
      { id: 'stage-1', label: 'Discovery', order: 1, color: '#2563eb', icon: 'search' },
    ],
    stageTransitions: [
      {
        stageId: 'stage-1',
        stageLabel: 'Discovery',
        stageOrder: 1,
        transitionedAt: '2026-04-11T09:00:00.000Z',
      },
    ],
    owner: {
      id: 'owner-1',
      name: 'Owner User',
      email: 'owner@example.com',
    },
  }
}

describe('DealDetailPage', () => {
  beforeEach(() => {
    activeTabParam = 'activities'
    detailRequestCount = 0
    readApiResultOrThrowMock.mockReset()
    updateCrudMock.mockReset()
    deleteCrudMock.mockReset()
    replaceMock.mockReset()
    pushMock.mockReset()
    inlineActivityComposerMock.mockClear()
    plannedActivitiesSectionMock.mockClear()

    updateCrudMock.mockResolvedValue(undefined)
    deleteCrudMock.mockResolvedValue(undefined)
    readApiResultOrThrowMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customers/deals/deal-1/stats')) {
        return {
          dealValue: 12000,
          dealCurrency: 'USD',
          closureOutcome: 'won',
          closedAt: '2026-04-14T16:30:00.000Z',
          pipelineName: 'Enterprise pipeline',
          dealsClosedThisPeriod: 4,
          salesCycleDays: 13,
          dealRankInQuarter: 3,
          lossReason: null,
        }
      }
      if (url.startsWith('/api/customers/deals/deal-123')) {
        detailRequestCount += 1
        return createDealPayload(detailRequestCount > 1 ? 'won' : null)
      }
      if (url.startsWith('/api/customers/people?ids=person-2')) {
        return {
          items: [
            {
              id: 'person-2',
              displayName: 'Grace Hopper',
              primaryEmail: 'grace@example.com',
              personProfile: { jobTitle: 'Procurement lead' },
            },
          ],
        }
      }
      if (url.startsWith('/api/customers/companies?ids=company-2')) {
        return {
          items: [
            {
              id: 'company-2',
              displayName: 'Sunrise Energy',
              companyProfile: { domain: 'sunrise.example' },
            },
          ],
        }
      }
      if (url.startsWith('/api/customers/interactions')) {
        return { items: [] }
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
  })

  it('renders the attachments section on the files tab', async () => {
    activeTabParam = 'files'

    renderWithProviders(<DealDetailPage params={{ id: 'deal-123' }} />)

    await waitFor(() => {
      expect(screen.getByTestId('attachments-section')).toHaveTextContent(
        'customer_deal:deal-1:Files:Upload and manage files linked to this deal.',
      )
    })
  })

  it('persists tab changes to the URL search params', async () => {
    renderWithProviders(<DealDetailPage params={{ id: 'deal-123' }} />)

    await waitFor(() => {
      expect(screen.getByTestId('active-tab')).toHaveTextContent('activities')
    })

    fireEvent.click(screen.getByRole('button', { name: 'tab-companies' }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/backend/customers/deals/deal-123?tab=companies', { scroll: false })
    })
  })

  it('marks the deal as won and opens the won popup with fetched stats', async () => {
    renderWithProviders(<DealDetailPage params={{ id: 'deal-123' }} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Won' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Won' }))

    await waitFor(() => {
      expect(updateCrudMock).toHaveBeenCalledWith('customers/deals', {
        id: 'deal-1',
        closureOutcome: 'won',
        status: 'win',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('won-popup:Enterprise pipeline')).toBeInTheDocument()
    })
  })

  it('updates linked people inline without reloading the full deal detail payload', async () => {
    activeTabParam = 'people'

    renderWithProviders(<DealDetailPage params={{ id: 'deal-123' }} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'manage-people-links' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'manage-people-links' }))

    await waitFor(() => {
      expect(updateCrudMock).toHaveBeenCalledWith('customers/deals', {
        id: 'deal-1',
        personIds: ['person-2'],
      })
    })

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        '/api/customers/people?ids=person-2&pageSize=1',
      )
    })

    expect(detailRequestCount).toBe(1)
  })

  it('requires an explicit entity selection before quick activity actions bind to a linked customer', async () => {
    readApiResultOrThrowMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customers/deals/deal-1/stats')) {
        return {
          dealValue: 12000,
          dealCurrency: 'USD',
          closureOutcome: 'won',
          closedAt: '2026-04-14T16:30:00.000Z',
          pipelineName: 'Enterprise pipeline',
          dealsClosedThisPeriod: 4,
          salesCycleDays: 13,
          dealRankInQuarter: 3,
          lossReason: null,
        }
      }
      if (url.startsWith('/api/customers/deals/deal-123')) {
        detailRequestCount += 1
        const payload = createDealPayload()
        payload.people = [
          {
            id: 'person-1',
            label: 'Ada Lovelace',
            subtitle: 'VP Partnerships',
            kind: 'person' as const,
          },
          {
            id: 'person-2',
            label: 'Grace Hopper',
            subtitle: 'Procurement lead',
            kind: 'person' as const,
          },
        ]
        payload.linkedPersonIds = ['person-1', 'person-2']
        payload.counts.people = 2
        return payload
      }
      if (url.startsWith('/api/customers/interactions')) {
        return { items: [] }
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    renderWithProviders(<DealDetailPage params={{ id: 'deal-123' }} />)

    const selector = await screen.findByLabelText('Choose customer record')

    expect(screen.queryByTestId('inline-activity-composer')).not.toBeInTheDocument()
    expect(screen.getByTestId('planned-activities-section')).toHaveTextContent('schedule-disabled')

    fireEvent.change(selector, { target: { value: 'company-1' } })

    await waitFor(() => {
      expect(screen.getByTestId('inline-activity-composer')).toHaveTextContent('company:company-1:schedule-enabled')
    })
    expect(screen.getByTestId('planned-activities-section')).toHaveTextContent('schedule-enabled')
  })
})
