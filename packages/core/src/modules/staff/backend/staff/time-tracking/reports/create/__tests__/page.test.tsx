/**
 * @jest-environment jsdom
 */
/**
 * Screen 13, note 2: a project with no entries in the selected period stays on
 * the list but must NOT ship ticked — ticking it bills a client for an empty
 * project. The per-project entry counts arrive with the preview call, after the
 * candidate list, so these tests pin the ordering: nothing is ticked on the
 * strength of the list alone, the counts settle the default once, and a tick the
 * user made while the counts were in flight survives them.
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import TimeTrackingReportCreatePage from '../page'

const ALPHA_ID = '11111111-1111-4111-8111-111111111111'
const BETA_ID = '22222222-2222-4222-8222-222222222222'

const ENTRY_COUNTS: Record<string, number> = { [ALPHA_ID]: 3, [BETA_ID]: 0 }

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

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/backend/staff/time-tracking/reports/create',
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: jest.fn() }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('../../../../../../lib/time-tracking-ui/CustomerPicker', () => ({
  CustomerPicker: () => null,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return { ...actual, apiCall: jest.fn(), readApiResultOrThrow: jest.fn() }
})

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const mockReadApiResultOrThrow = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
const mockUseBackendChrome = useBackendChrome as jest.MockedFunction<typeof useBackendChrome>

function ok<T>(result: T) {
  return { ok: true, status: 200, result, response: {} as Response, cacheStatus: null }
}

function previewFor(projectIds: string[]) {
  const projects = projectIds.map((id) => ({
    id,
    name: id === ALPHA_ID ? 'Alpha' : 'Beta',
    hourlyRate: 100,
    currencyCode: 'EUR',
    entryCount: ENTRY_COUNTS[id] ?? 0,
    billableMinutes: (ENTRY_COUNTS[id] ?? 0) * 60,
    nonbillableMinutes: 0,
    amount: (ENTRY_COUNTS[id] ?? 0) * 100,
  }))
  return {
    currencyCode: 'EUR',
    grouping: 'project_task',
    nonbillableMode: 'separate',
    includeAlreadyReported: false,
    showRates: true,
    projects,
    groups: [],
    totals: {
      entryCount: projects.reduce((sum, project) => sum + project.entryCount, 0),
      billableMinutes: projects.reduce((sum, project) => sum + project.billableMinutes, 0),
      nonbillableMinutes: 0,
      totalAmount: projects.reduce((sum, project) => sum + (project.amount ?? 0), 0),
    },
    alreadyReportedCount: 0,
    alreadyReportedMinutes: 0,
    alreadyReportedIn: [],
    rounding: { unitMinutes: 15, direction: 'up' },
  }
}

/** Holds the whole-candidate-set preview open so the tick order can be observed. */
let releaseCandidatePreview: (() => void) | null = null

function installApi({ holdCandidatePreview = false }: { holdCandidatePreview?: boolean } = {}) {
  releaseCandidatePreview = null
  mockReadApiResultOrThrow.mockImplementation(async () =>
    ({
      items: [
        { id: ALPHA_ID, name: 'Alpha', hourly_rate: 100, currency_code: 'EUR' },
        { id: BETA_ID, name: 'Beta', hourly_rate: 100, currency_code: 'EUR' },
      ],
    }) as never,
  )
  mockApiCall.mockImplementation((async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as { timeProjectIds?: string[] }) : {}
    const ids = body.timeProjectIds ?? []
    const isCandidatePreview = ids.length === 2
    if (isCandidatePreview && holdCandidatePreview) {
      await new Promise<void>((resolve) => {
        releaseCandidatePreview = resolve
      })
    }
    return ok(previewFor(ids))
  }) as never)
}

function checkboxFor(name: string): HTMLElement {
  return screen.getByRole('checkbox', { name })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSearchParams = new URLSearchParams('customerId=cus-1')
  mockUseBackendChrome.mockReturnValue({
    payload: { grantedFeatures: ['staff.timesheets.rates.view'] },
  } as never)
  installApi()
})

describe('report create — default project selection', () => {
  it('leaves a project with no entries in the period unticked', async () => {
    render(<TimeTrackingReportCreatePage />)

    await waitFor(() => expect(checkboxFor('Alpha')).toHaveAttribute('aria-checked', 'true'))
    expect(checkboxFor('Beta')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/0 entries in period/)).toBeInTheDocument()
  })

  it('ticks a project that has entries in the period', async () => {
    render(<TimeTrackingReportCreatePage />)

    await waitFor(() => expect(checkboxFor('Alpha')).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByText(/3 entries in period/)).toBeInTheDocument()
  })

  it('never ticks anything before the entry counts arrive', async () => {
    installApi({ holdCandidatePreview: true })
    render(<TimeTrackingReportCreatePage />)

    await waitFor(() => expect(checkboxFor('Beta')).toBeInTheDocument())
    expect(checkboxFor('Alpha')).toHaveAttribute('aria-checked', 'false')
    expect(checkboxFor('Beta')).toHaveAttribute('aria-checked', 'false')

    await act(async () => {
      releaseCandidatePreview?.()
    })
    await waitFor(() => expect(checkboxFor('Alpha')).toHaveAttribute('aria-checked', 'true'))
  })

  it('keeps a hand-ticked empty project ticked once the counts arrive', async () => {
    installApi({ holdCandidatePreview: true })
    render(<TimeTrackingReportCreatePage />)

    await waitFor(() => expect(checkboxFor('Beta')).toBeInTheDocument())
    fireEvent.click(checkboxFor('Beta'))
    await waitFor(() => expect(checkboxFor('Beta')).toHaveAttribute('aria-checked', 'true'))

    await act(async () => {
      releaseCandidatePreview?.()
    })

    await waitFor(() => expect(checkboxFor('Alpha')).toHaveAttribute('aria-checked', 'true'))
    expect(checkboxFor('Beta')).toHaveAttribute('aria-checked', 'true')
  })

  it('honours an explicit ?projectIds= preselection, empty period or not', async () => {
    mockSearchParams = new URLSearchParams(`customerId=cus-1&projectIds=${BETA_ID}`)
    render(<TimeTrackingReportCreatePage />)

    await waitFor(() => expect(checkboxFor('Beta')).toHaveAttribute('aria-checked', 'true'))
    expect(checkboxFor('Alpha')).toHaveAttribute('aria-checked', 'false')
  })
})
