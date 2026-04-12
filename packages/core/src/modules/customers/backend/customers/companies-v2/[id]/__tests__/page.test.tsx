/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import CompanyDetailV2Page from '../page'

const readApiResultOrThrowMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: (key: string) => (key === 'tab' ? 'activity-log' : null) }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
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

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  createTranslatorWithFallback: () => (_key: string, fallback?: string) => fallback ?? '',
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => <div>form</div>,
}))

jest.mock('@open-mercato/ui/backend/crud/CollapsibleZoneLayout', () => ({
  CollapsibleZoneLayout: ({ zone1, zone2 }: { zone1: React.ReactNode; zone2: React.ReactNode }) => (
    <div>{zone1}{zone2}</div>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1' }),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: { customers: { customer_entity: 'e1', customer_company_profile: 'e2' } },
}))

jest.mock('../../../../../components/formConfig', () => ({
  createCompanyEditSchema: () => ({}),
  createCompanyEditFields: () => [],
  createCompanyDaneFiremyGroups: () => [],
  mapCompanyOverviewToFormValues: () => ({}),
  buildCompanyEditPayload: () => ({}),
}))

jest.mock('../../../../../components/detail/CompanyDetailHeader', () => ({
  CompanyDetailHeader: () => <div>header</div>,
}))

jest.mock('../../../../../components/detail/CompanyKpiBar', () => ({
  CompanyKpiBar: () => <div>kpis</div>,
}))

jest.mock('../../../../../components/detail/CompanyDetailTabs', () => ({
  resolveLegacyTab: (tab?: string | null) => (tab === 'activity-log' ? 'activity-log' : 'people'),
  CompanyDetailTabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('../../../../../components/detail/InlineActivityComposer', () => ({
  InlineActivityComposer: ({ onScheduleRequested }: { onScheduleRequested: () => void }) => (
    <button type="button" onClick={onScheduleRequested}>
      schedule-new
    </button>
  ),
}))

jest.mock('../../../../../components/detail/PlannedActivitiesSection', () => ({
  PlannedActivitiesSection: ({
    onEdit,
    onSchedule,
  }: {
    onEdit: (activity: Record<string, unknown>) => void
    onSchedule: () => void
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onEdit({ id: 'activity-1', interactionType: 'meeting', title: 'Existing meeting', scheduledAt: '2026-04-20T09:00:00.000Z' })}
      >
        edit-activity
      </button>
      <button type="button" onClick={onSchedule}>
        schedule-from-planned
      </button>
    </div>
  ),
}))

jest.mock('../../../../../components/detail/ScheduleActivityDialog', () => ({
  ScheduleActivityDialog: ({
    open,
    onClose,
    editData,
  }: {
    open: boolean
    onClose: () => void
    editData: { id?: string } | null
  }) =>
    open ? (
      <div>
        <div data-testid="schedule-dialog-mode">{editData ? 'edit' : 'create'}</div>
        <button type="button" onClick={onClose}>
          close-schedule-dialog
        </button>
      </div>
    ) : null,
}))

jest.mock('../../../../../components/detail/ActivitiesSection', () => ({
  ActivitiesSection: () => <div>activities</div>,
}))

jest.mock('../../../../../components/detail/DealsSection', () => ({
  DealsSection: () => <div>deals</div>,
}))

jest.mock('../../../../../components/detail/CompanyPeopleSection', () => ({
  CompanyPeopleSection: () => <div>people</div>,
}))

jest.mock('../../../../../components/detail/ComingSoonPlaceholder', () => ({
  ComingSoonPlaceholder: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('../../../../../components/detail/ChangelogTab', () => ({
  ChangelogTab: () => <div>changelog</div>,
}))

describe('CompanyDetailV2Page schedule dialog state', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue({
      company: {
        id: 'company-123',
        displayName: 'Acme Corp',
        nextInteractionAt: null,
        nextInteractionName: null,
      },
      interactionMode: 'legacy',
      tags: [],
      todos: [],
      people: [],
      deals: [],
      interactions: [
        {
          id: 'activity-1',
          status: 'planned',
          interactionType: 'meeting',
          title: 'Existing meeting',
          scheduledAt: '2026-04-20T09:00:00.000Z',
        },
      ],
    })
  })

  it('resets edit state before opening a new schedule dialog', async () => {
    renderWithProviders(<CompanyDetailV2Page params={{ id: 'company-123' }} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'edit-activity' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'edit-activity' }))
    expect(screen.getByTestId('schedule-dialog-mode')).toHaveTextContent('edit')

    fireEvent.click(screen.getByRole('button', { name: 'close-schedule-dialog' }))
    await waitFor(() => {
      expect(screen.queryByTestId('schedule-dialog-mode')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'schedule-new' }))
    expect(screen.getByTestId('schedule-dialog-mode')).toHaveTextContent('create')
  })
})
