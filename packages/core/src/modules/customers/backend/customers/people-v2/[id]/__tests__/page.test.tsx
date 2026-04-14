/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import PersonDetailV2Page from '../page'

const readApiResultOrThrowMock = jest.fn()
let activeTabParam: string | null = 'changelog'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: (key: string) => (key === 'tab' ? activeTabParam : null) }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  AttachmentsSection: () => <div>attachments</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => <div>form</div>,
}))

jest.mock('@open-mercato/ui/backend/crud/CollapsibleZoneLayout', () => ({
  CollapsibleZoneLayout: ({ zone1, zone2 }: { zone1: React.ReactNode; zone2: React.ReactNode }) => (
    <div>{zone1}{zone2}</div>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: jest.fn(),
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

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1' }),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: { customers: { customer_entity: 'e1', customer_person_profile: 'e2' } },
}))

jest.mock('../../../../../components/formConfig', () => ({
  createPersonEditSchema: () => ({}),
  createPersonEditFields: () => [],
  createPersonDaneOsoboweGroups: () => [],
  mapPersonOverviewToFormValues: () => ({}),
  buildPersonEditPayload: () => ({}),
}))

jest.mock('../../../../../components/detail/PersonDetailHeader', () => ({
  PersonDetailHeader: () => <div>header</div>,
}))

jest.mock('../../../../../components/detail/PersonDetailTabs', () => ({
  resolveLegacyTab: (tab?: string | null) => {
    if (tab === 'activities' || tab === 'companies' || tab === 'tasks' || tab === 'deals' || tab === 'files' || tab === 'changelog') {
      return tab
    }
    return 'activities'
  },
  PersonDetailTabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('../../../../../components/detail/ActivitiesSection', () => ({
  ActivitiesSection: () => <div>activities</div>,
}))

jest.mock('../../../../../components/detail/DealsSection', () => ({
  DealsSection: () => <div>deals</div>,
}))

jest.mock('../../../../../components/detail/TasksSection', () => ({
  TasksSection: () => <div>tasks</div>,
}))

jest.mock('../../../../../components/detail/InlineActivityComposer', () => ({
  InlineActivityComposer: () => <div>composer</div>,
}))

jest.mock('../../../../../components/detail/PlannedActivitiesSection', () => ({
  PlannedActivitiesSection: () => <div>planned</div>,
}))

jest.mock('../../../../../components/detail/ScheduleActivityDialog', () => ({
  ScheduleActivityDialog: () => null,
}))

jest.mock('../../../../../components/detail/PersonCompaniesSection', () => ({
  PersonCompaniesSection: () => <div>companies</div>,
}))

jest.mock('../../../../../components/detail/ChangelogTab', () => ({
  ChangelogTab: () => <div>changelog</div>,
}))

describe('PersonDetailV2Page', () => {
  beforeEach(() => {
    activeTabParam = 'changelog'
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue({
      person: {
        id: 'person-123',
        displayName: 'Jane Doe',
      },
      profile: null,
      customFields: {},
      tags: [],
      todos: [],
      deals: [],
      interactions: [],
      activities: [],
      companies: [],
      interactionMode: 'legacy',
    })
  })

  it('renders the shared changelog tab on the person v2 page', async () => {
    renderWithProviders(<PersonDetailV2Page params={{ id: 'person-123' }} />)

    await waitFor(() => {
      expect(screen.getByText('changelog')).toBeInTheDocument()
    })
  })
})
