/**
 * @jest-environment jsdom
 */
// EP-20: the project detail screen is an injection host. The `tabs` spot is the
// one that had to do more than render below existing markup — a contributed
// widget has to become a real tab in the page's own `<Tabs>`, with its own
// trigger and its own panel — so it is exercised end to end here.
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'

import TimesheetProjectDetailPage from '../page'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const STAFF_ID = '33333333-3333-4333-8333-333333333333'

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    params[key] === undefined ? match : String(params[key]),
  )
}

const mockTranslate = (
  key: string,
  fallbackOrParams?: string | Record<string, string | number>,
  params?: Record<string, string | number>,
): string => {
  if (typeof fallbackOrParams === 'string') return interpolate(fallbackOrParams, params)
  return interpolate(key, fallbackOrParams)
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
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

jest.mock('../../../../../../lib/time-tracking-ui/ProjectTeamDrawer', () => ({
  ProjectTeamDrawer: () => null,
}))

type TabWidget = {
  widgetId: string
  moduleId: string
  key: string
  placement?: { kind?: string; groupId?: string; groupLabel?: string; priority?: number }
  module: { Widget: React.ComponentType<{ context: unknown }>; metadata: { id: string; title?: string } }
}

const mockInjection: { spotIds: string[]; tabWidgets: TabWidget[] } = { spotIds: [], tabWidgets: [] }

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: ({ spotId }: { spotId: string }) => {
    mockInjection.spotIds.push(spotId)
    return null
  },
  useInjectionWidgets: (spotId: string) => {
    mockInjection.spotIds.push(spotId)
    return { widgets: mockInjection.tabWidgets, loading: false, error: null }
  },
}))

const apiCallMock = apiCall as unknown as jest.Mock
const readApiResultOrThrowMock = readApiResultOrThrow as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockInjection.spotIds = []
  mockInjection.tabWidgets = []

  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/auth/feature-check')) {
      return {
        ok: true,
        status: 200,
        result: { ok: true, granted: ['staff.timesheets.projects.manage'] },
        response: {},
      }
    }
    if (url.startsWith('/api/staff/team-members')) {
      return {
        ok: true,
        status: 200,
        result: { items: [{ id: STAFF_ID, display_name: 'Ada Lovelace' }] },
        response: {},
      }
    }
    if (url.startsWith('/api/staff/timesheets/time-projects?')) {
      return {
        ok: true,
        status: 200,
        result: { items: [{ id: PROJECT_ID, name: 'Apollo', code: 'APL', status: 'active' }] },
        response: {},
      }
    }
    return { ok: true, status: 200, result: {}, response: {} }
  })

  readApiResultOrThrowMock.mockImplementation(async () => ({ items: [], total: 0 }))
})

async function renderPage() {
  const view = render(<TimesheetProjectDetailPage params={{ id: PROJECT_ID }} />)
  await screen.findByRole('heading', { name: 'Apollo' })
  return view
}

describe('project detail injection spots', () => {
  it('renders every declared project-detail spot', async () => {
    await renderPage()
    for (const key of [
      'projectDetailHeader',
      'projectDetailStatusBadges',
      'projectDetailTabs',
      'projectDetailSidebar',
      'projectDetailFooter',
    ] as const) {
      expect(mockInjection.spotIds).toContain(extensionPoints.hosts[key].spotId)
    }
  })

  it('adds no tab when nothing is contributed', async () => {
    await renderPage()
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Team0', 'Time', 'Tasks'])
  })

  it('turns a contributed widget into its own tab and renders its panel', async () => {
    mockInjection.tabWidgets = [
      {
        widgetId: 'invoices-widget',
        moduleId: 'billing',
        key: 'billing/invoices',
        placement: { kind: 'tab', groupId: 'invoices', groupLabel: 'Invoices', priority: 10 },
        module: {
          Widget: () => <p>Contributed invoices panel</p>,
          metadata: { id: 'invoices-widget', title: 'Invoices' },
        },
      },
    ]

    await renderPage()

    const invoicesTab = await screen.findByRole('tab', { name: 'Invoices' })
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Team0',
      'Time',
      'Tasks',
      'Invoices',
    ])

    fireEvent.click(invoicesTab)
    await waitFor(() => expect(screen.getByText('Contributed invoices panel')).toBeTruthy())
  })
})
