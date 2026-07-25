/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import CompanyDetailV2Page from '../page'

const readApiResultOrThrowMock = jest.fn()
const scopedDeleteHeaderCalls: Array<Record<string, string>> = []
let activeTabParam: string | null = 'activity-log'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: (key: string) => (key === 'tab' ? activeTabParam : null) }),
  usePathname: () => '/backend/customers/companies-v2/test',
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
  withScopedApiRequestHeaders: <T,>(headers: Record<string, string>, run: () => Promise<T>) => {
    scopedDeleteHeaderCalls.push(headers)
    return run()
  },
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
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

const crudFormPropsCapture: { current: Record<string, unknown> | null } = { current: null }
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    crudFormPropsCapture.current = props
    return <div>form</div>
  },
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
  resolveLegacyTab: (tab?: string | null) => {
    if (tab === 'activity-log' || tab === 'files') {
      return tab
    }
    return 'people'
  },
  CompanyDetailTabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('../../../../../components/detail/ActivityLogTab', () => ({
  ActivityLogTab: ({
    onEditActivity,
    onScheduleRequested,
  }: {
    onEditActivity: (activity: Record<string, unknown>) => void
    onScheduleRequested: () => void
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onEditActivity({ id: 'activity-1', interactionType: 'meeting', title: 'Existing meeting', scheduledAt: '2026-04-20T09:00:00.000Z' })}
      >
        edit-activity
      </button>
      <button type="button" onClick={onScheduleRequested}>
        schedule-new
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
    activeTabParam = 'activity-log'
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

  it('renders the shared attachments section on the files tab', async () => {
    activeTabParam = 'files'

    renderWithProviders(<CompanyDetailV2Page params={{ id: 'company-123' }} />)

    await waitFor(() => {
      expect(screen.getByTestId('attachments-section')).toHaveTextContent(
        'e1:company-123:Files:Upload and manage files linked to this company.',
      )
    })
  })

  it('passes company.updatedAt to CrudForm as optimisticLockUpdatedAt (PR #1981)', async () => {
    activeTabParam = 'activity-log'
    crudFormPropsCapture.current = null
    readApiResultOrThrowMock.mockResolvedValue({
      company: {
        id: 'company-123',
        displayName: 'Acme Corp',
        updatedAt: '2026-05-25T11:00:00.000Z',
        nextInteractionAt: null,
        nextInteractionName: null,
      },
      interactionMode: 'legacy',
      tags: [],
      todos: [],
      people: [],
      deals: [],
      interactions: [],
    })

    renderWithProviders(<CompanyDetailV2Page params={{ id: 'company-123' }} />)

    await waitFor(() => {
      expect(crudFormPropsCapture.current).not.toBeNull()
    })
    expect(crudFormPropsCapture.current?.optimisticLockUpdatedAt).toBe(
      '2026-05-25T11:00:00.000Z',
    )
  })

  it('sends the optimistic-lock header on company delete (PR #2055 QA)', async () => {
    activeTabParam = 'activity-log'
    crudFormPropsCapture.current = null
    scopedDeleteHeaderCalls.length = 0
    const deleteCrudMock = jest.requireMock('@open-mercato/ui/backend/utils/crud').deleteCrud as jest.Mock
    deleteCrudMock.mockReset().mockResolvedValue({ ok: true })
    readApiResultOrThrowMock.mockResolvedValue({
      company: {
        id: 'company-789',
        displayName: 'Delete Me Inc',
        updatedAt: '2026-05-28T09:30:00.000Z',
        nextInteractionAt: null,
        nextInteractionName: null,
      },
      interactionMode: 'legacy',
      tags: [],
      todos: [],
      people: [],
      deals: [],
      interactions: [],
    })

    renderWithProviders(<CompanyDetailV2Page params={{ id: 'company-789' }} />)

    await waitFor(() => {
      expect(crudFormPropsCapture.current).not.toBeNull()
    })

    const onDelete = crudFormPropsCapture.current?.onDelete as (() => Promise<void>) | undefined
    expect(typeof onDelete).toBe('function')
    await onDelete!()

    expect(deleteCrudMock).toHaveBeenCalledTimes(1)
    expect(scopedDeleteHeaderCalls).toContainEqual({
      [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-05-28T09:30:00.000Z',
    })
  })

  it('passes undefined when the loaded company has no updatedAt (graceful fallback)', async () => {
    activeTabParam = 'activity-log'
    crudFormPropsCapture.current = null
    readApiResultOrThrowMock.mockResolvedValue({
      company: {
        id: 'company-456',
        displayName: 'Without Timestamp',
        nextInteractionAt: null,
        nextInteractionName: null,
      },
      interactionMode: 'legacy',
      tags: [],
      todos: [],
      people: [],
      deals: [],
      interactions: [],
    })

    renderWithProviders(<CompanyDetailV2Page params={{ id: 'company-456' }} />)

    await waitFor(() => {
      expect(crudFormPropsCapture.current).not.toBeNull()
    })
    expect(crudFormPropsCapture.current?.optimisticLockUpdatedAt).toBeUndefined()
  })
})
