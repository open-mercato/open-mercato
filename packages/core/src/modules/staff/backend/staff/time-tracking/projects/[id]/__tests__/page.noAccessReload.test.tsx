/**
 * @jest-environment jsdom
 */
// Screen 17 must survive a background reload: the organization scope can resolve
// after the guard is already on screen, and re-running the project load used to
// unmount it — throwing away the "request sent" acknowledgement (TC-TT-017).
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

import TimesheetProjectDetailPage from '../page'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

const mockScope = { version: 1 }

const mockTranslate = (key: string, fallback?: unknown): string => (typeof fallback === 'string' ? fallback : key)

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockScope.version,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/backend/staff/time-tracking/projects/project-1',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(
    async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/charts', () => ({
  KpiCard: ({ label }: { label: React.ReactNode }) => <div>{label}</div>,
  Sparkline: () => null,
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
}))

jest.mock('../../../../../../lib/time-tracking-ui/ProjectTeamDrawer', () => ({
  ProjectTeamDrawer: () => null,
}))

jest.mock('../../../../../../lib/time-tracking-ui/NoProjectAccess', () => ({
  NoProjectAccess: () => {
    const [sent, setSent] = React.useState(false)
    return (
      <button type="button" disabled={sent} onClick={() => setSent(true)}>
        {sent ? 'Request sent' : 'Request access'}
      </button>
    )
  },
}))

const apiCallMock = apiCall as unknown as jest.Mock
const readApiResultOrThrowMock = readApiResultOrThrow as unknown as jest.Mock

let projectLoads: Array<(value: unknown) => void> = []
let projectResponse: unknown

beforeEach(() => {
  jest.clearAllMocks()
  mockScope.version = 1
  projectLoads = []
  projectResponse = { ok: false, status: 404, result: { reason: 'no_project_access' }, response: {} }
  apiCallMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/staff/timesheets/time-projects?')) {
      return new Promise((resolve) => { projectLoads.push(resolve) })
    }
    return Promise.resolve({ ok: true, status: 200, result: {}, response: {} })
  })
  readApiResultOrThrowMock.mockImplementation(async () => ({ items: [], total: 0 }))
})

async function settleProjectLoad() {
  await waitFor(() => expect(projectLoads.length).toBeGreaterThan(0))
  const resolve = projectLoads.shift()!
  await act(async () => { resolve(projectResponse) })
}

describe('project detail no-access guard', () => {
  it('keeps the guard mounted, with its sent request, while the project reloads', async () => {
    const view = render(<TimesheetProjectDetailPage params={{ id: PROJECT_ID }} />)
    await settleProjectLoad()
    fireEvent.click(await screen.findByRole('button', { name: 'Request access' }))
    expect(screen.getByRole('button', { name: 'Request sent' })).toBeDisabled()

    mockScope.version = 2
    view.rerender(<TimesheetProjectDetailPage params={{ id: PROJECT_ID }} />)
    await waitFor(() => expect(projectLoads).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Request sent' })).toBeDisabled()

    await settleProjectLoad()
    expect(screen.getByRole('button', { name: 'Request sent' })).toBeDisabled()
  })

  it('leaves the guard once a reload grants access', async () => {
    const view = render(<TimesheetProjectDetailPage params={{ id: PROJECT_ID }} />)
    await settleProjectLoad()
    await screen.findByRole('button', { name: 'Request access' })

    projectResponse = {
      ok: true,
      status: 200,
      result: { items: [{ id: PROJECT_ID, name: 'Apollo', code: 'APL', status: 'active' }] },
      response: {},
    }
    mockScope.version = 2
    view.rerender(<TimesheetProjectDetailPage params={{ id: PROJECT_ID }} />)
    await settleProjectLoad()

    expect(await screen.findByRole('heading', { name: 'Apollo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
  })

  it('drops the guard as soon as the route moves to another project', async () => {
    const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222'
    const view = render(<TimesheetProjectDetailPage params={{ id: PROJECT_ID }} />)
    await settleProjectLoad()
    await screen.findByRole('button', { name: 'Request access' })

    view.rerender(<TimesheetProjectDetailPage params={{ id: OTHER_PROJECT_ID }} />)
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
    expect(screen.getByText('Loading project...')).toBeInTheDocument()
  })
})
