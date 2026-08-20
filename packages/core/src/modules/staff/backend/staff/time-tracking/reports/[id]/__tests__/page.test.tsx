/**
 * @jest-environment jsdom
 */
/**
 * Screen 15 is a route, `…/reports/[id]?unlock=1`, not just a button. The deep
 * link may only do what the button does: it opens the unlock dialog for a closed
 * report when the caller holds the unlock feature, and does nothing at all for a
 * draft report or a caller without it — a dialog that cannot be submitted is
 * worse than no dialog.
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import TimeTrackingReportDetailPage from '../page'

const REPORT_ID = '88888888-8888-4888-8888-888888888888'

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

let mockSearchParams = new URLSearchParams('')

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/backend/staff/time-tracking/reports/detail',
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: jest.fn() }))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({ useConfirmDialog: jest.fn() }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('../../../../../../lib/time-tracking-ui/ReportSheet', () => ({
  ReportSheet: () => <div data-testid="report-sheet" />,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return { ...actual, apiCall: jest.fn(), readApiResultOrThrow: jest.fn() }
})

const mockReadApiResultOrThrow = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
const mockUseBackendChrome = useBackendChrome as jest.MockedFunction<typeof useBackendChrome>
const mockUseConfirmDialog = useConfirmDialog as jest.MockedFunction<typeof useConfirmDialog>

function sheetPayload(status: 'draft' | 'closed') {
  return {
    report: {
      id: REPORT_ID,
      reference: 'TR-2026-0007',
      title: 'Acme — August',
      status,
      customerId: 'cus-1',
      customerSnapshot: { name: 'Acme' },
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      currencyCode: 'EUR',
      grouping: 'project_task',
      nonbillableMode: 'separate',
      includeAlreadyReported: false,
      showRates: true,
      roundingUnitMinutes: 15,
      roundingDirection: 'up',
      closedAt: status === 'closed' ? '2026-09-01T10:00:00.000Z' : null,
      closedByUserId: null,
      timeProjectIds: [],
    },
    groups: [],
    totals: { entryCount: 2, billableMinutes: 120, nonbillableMinutes: 0, totalAmount: 200 },
    alreadyReportedCount: 0,
    alreadyReportedMinutes: 0,
    rows: [],
    rowCount: 2,
    rowsTruncated: false,
    events: [],
  }
}

function renderPage(options: { status: 'draft' | 'closed'; features: string[]; search: string }) {
  mockSearchParams = new URLSearchParams(options.search)
  mockUseBackendChrome.mockReturnValue({ payload: { grantedFeatures: options.features } } as never)
  mockReadApiResultOrThrow.mockImplementation(async () => sheetPayload(options.status) as never)
  return render(<TimeTrackingReportDetailPage params={{ id: REPORT_ID }} />)
}

const UNLOCK_FEATURES = ['staff.timesheets.reports.unlock', 'staff.timesheets.rates.view']

beforeEach(() => {
  jest.clearAllMocks()
  mockUseConfirmDialog.mockReturnValue({
    confirm: jest.fn(async () => true),
    ConfirmDialogElement: null,
  } as never)
})

describe('report detail — ?unlock=1 deep link', () => {
  it('opens the unlock dialog for a closed report when the caller may unlock', async () => {
    renderPage({ status: 'closed', features: UNLOCK_FEATURES, search: 'unlock=1' })

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText('Unlock 2 entries?')).toBeInTheDocument()
  })

  it('stays closed on a draft report', async () => {
    renderPage({ status: 'draft', features: UNLOCK_FEATURES, search: 'unlock=1' })

    await waitFor(() => expect(screen.getByTestId('report-sheet')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays closed without the unlock feature', async () => {
    renderPage({ status: 'closed', features: ['staff.timesheets.rates.view'], search: 'unlock=1' })

    await waitFor(() => expect(screen.getByTestId('report-sheet')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Unlock entries/ })).not.toBeInTheDocument()
  })

  it('stays closed without the parameter', async () => {
    renderPage({ status: 'closed', features: UNLOCK_FEATURES, search: '' })

    await waitFor(() => expect(screen.getByTestId('report-sheet')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Unlock entries/ })).toBeInTheDocument()
  })
})
