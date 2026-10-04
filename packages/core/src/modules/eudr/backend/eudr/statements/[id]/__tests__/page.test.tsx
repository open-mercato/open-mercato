/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import EditEudrStatementPage from '../page'

const apiCallMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: () => <div>table</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  RecordNotFoundState: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: (message: string) => new Error(message),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@open-mercato/ui/primitives/empty-state', () => ({
  EmptyState: () => null,
}))

jest.mock('@open-mercato/ui/primitives/status-badge', () => ({
  StatusBadge: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const stableTranslate = (key: string) => key
  return {
    useT: () => stableTranslate,
    I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

const crudFormPropsCapture: { current: Record<string, unknown> | null } = { current: null }
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    crudFormPropsCapture.current = props
    return <div>form</div>
  },
}))

jest.mock('../../../../../components/StatementLifecycleBar', () => ({
  StatementLifecycleBar: () => null,
}))

jest.mock('../../../../../components/StatementReadinessChecklist', () => ({
  StatementReadinessChecklist: () => null,
}))

jest.mock('../../../../../components/StatementRiskSection', () => ({
  StatementRiskSection: () => null,
  riskConclusionBadgeVariant: () => 'neutral',
  riskTierBadgeVariant: () => 'neutral',
}))

jest.mock('../../../../../components/PlotMapPreview', () => ({
  PlotMapPreview: () => null,
}))

jest.mock('../../../../../components/formConfig', () => ({
  OrderSelectField: () => null,
  ReferencedStatementsField: () => null,
  actorRoleOptions: () => [],
  activityTypeOptions: () => [],
  commodityOptions: () => [],
  statusBadgeVariant: () => 'neutral',
  translateEudrCrudError: (err: unknown) => err,
}))

function statementRecord(status: string) {
  return {
    id: 'statement-1',
    title: 'Statement 1',
    commodity: 'coffee',
    referenceNumber: null,
    verificationNumber: null,
    status,
    activityType: null,
    actorRole: null,
    referencedStatements: [],
    quantityKg: null,
    supplementaryUnit: null,
    supplementaryQuantity: null,
    orderId: null,
    submittedAt: null,
    referenceIssuedAt: null,
    orderSnapshot: null,
    notes: null,
    latestRisk: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  }
}

async function renderDetailFor(status: string): Promise<void> {
  apiCallMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/eudr/statements?')) {
      return { ok: true, result: { items: [statementRecord(status)] } }
    }
    return { ok: true, result: { items: [] } }
  })
  renderWithProviders(<EditEudrStatementPage params={{ id: 'statement-1' }} />)
  await waitFor(() => expect(crudFormPropsCapture.current).not.toBeNull())
}

describe('EditEudrStatementPage delete affordance', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    crudFormPropsCapture.current = null
  })

  it('keeps Delete available for a statement that can still be deleted', async () => {
    await renderDetailFor('draft')

    expect(crudFormPropsCapture.current?.deleteVisible).toBe(true)
  })

  it('hides Delete for an archived statement, which the server always refuses', async () => {
    await renderDetailFor('archived')

    expect(crudFormPropsCapture.current?.deleteVisible).toBe(false)
  })
})
