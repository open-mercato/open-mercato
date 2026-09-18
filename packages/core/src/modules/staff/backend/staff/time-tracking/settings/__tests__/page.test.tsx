/**
 * @jest-environment jsdom
 */
/**
 * Screen 16. Two things are worth a rendered test rather than a helper test:
 * the worked examples must move the moment the control moves (note 1), and the
 * retro-rounding action must behave like an action — confirmed, gated, and never
 * fired from a rule that has not been saved.
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import TimeTrackingSettingsPage from '../page'

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

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: jest.fn() }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({ useConfirmDialog: jest.fn() }))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return { ...actual, apiCall: jest.fn() }
})

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const mockUseBackendChrome = useBackendChrome as jest.MockedFunction<typeof useBackendChrome>
const mockUseConfirmDialog = useConfirmDialog as jest.MockedFunction<typeof useConfirmDialog>
const mockFlash = flash as jest.MockedFunction<typeof flash>

const confirmMock = jest.fn(async () => true)

let settings = {
  rounding: { unitMinutes: 15 as 0 | 5 | 10 | 15, direction: 'up' as 'up' | 'nearest' },
  defaults: { billable: true, chainStartFromPreviousEnd: true },
  targets: { dailyHours: 8 as number | null },
  warnings: { overlap: true, runningTimer: true },
  access: { assignmentGraceDays: 14 },
}

let impactResponse: unknown = {
  windowDays: 90,
  rounding: { unitMinutes: 15, direction: 'up' },
  projected: { entryCount: 1284, rawMinutes: 94455, roundedMinutes: 96750, deltaMinutes: 2295 },
  current: { entryCount: 1284, rawMinutes: 94455, roundedMinutes: 96750, deltaMinutes: 2295 },
  lockedEntryCount: 0,
}

let reapplyResponse: unknown = { ok: true, progressJobId: 'job-1', candidateCount: 1284 }

const putBodies: unknown[] = []

function ok<T>(result: T) {
  return { ok: true, status: 200, result, response: {} as Response, cacheStatus: null }
}

function installRouter() {
  mockApiCall.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/settings/rounding-impact')) return ok(impactResponse) as never
    if (url.includes('/settings/reapply-rounding')) return ok(reapplyResponse) as never
    if (url.includes('/timesheets/settings')) {
      if (init?.method === 'PUT') {
        putBodies.push(JSON.parse(String(init.body)))
        return ok(JSON.parse(String(init.body))) as never
      }
      return ok(settings) as never
    }
    throw new Error(`[internal] unexpected request ${url}`)
  })
}

function renderPage() {
  return render(<TimeTrackingSettingsPage />)
}

const examples = () => screen.getByTestId('rounding-examples').textContent ?? ''

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] })
  putBodies.length = 0
  settings = {
    rounding: { unitMinutes: 15, direction: 'up' },
    defaults: { billable: true, chainStartFromPreviousEnd: true },
    targets: { dailyHours: 8 },
    warnings: { overlap: true, runningTimer: true },
    access: { assignmentGraceDays: 14 },
  }
  reapplyResponse = { ok: true, progressJobId: 'job-1', candidateCount: 1284 }
  confirmMock.mockResolvedValue(true)
  mockUseConfirmDialog.mockReturnValue({ confirm: confirmMock, ConfirmDialogElement: null } as never)
  mockUseBackendChrome.mockReturnValue({
    payload: { grantedFeatures: ['staff.timesheets.settings.manage'] },
  } as never)
  installRouter()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('time tracking settings page', () => {
  it('renders the mockup examples for the stored rule', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())
    expect(examples()).toBe('1:02 → 1:15 · 1:16 → 1:30 · 0:03 → 0:15 · 2:00 → 2:00')
  })

  it('recomputes the examples live when the unit changes, before anything is saved', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('radio', { name: '5 min' }))

    await waitFor(() => expect(examples()).toBe('1:02 → 1:05 · 1:16 → 1:20 · 0:03 → 0:05 · 2:00 → 2:00'))
    expect(putBodies).toHaveLength(0)
  })

  it('recomputes the examples when the direction changes', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('radio', { name: 'To nearest' }))

    await waitFor(() => expect(examples()).toBe('1:02 → 1:00 · 1:16 → 1:15 · 0:03 → 0:00 · 2:00 → 2:00'))
  })

  it('shows the 90 day impact for the candidate rule', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    await waitFor(() => expect(screen.getByTestId('rounding-impact')).toBeInTheDocument())
    const text = screen.getByTestId('rounding-impact').textContent ?? ''
    expect(text).toContain('1284')
    expect(text).toContain('1612:30')
    expect(text).toContain('+38:15')
  })

  it('asks the impact endpoint for the candidate rule rather than the stored one', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('radio', { name: 'None' }))

    await waitFor(() =>
      expect(
        mockApiCall.mock.calls.some(([input]) => String(input).includes('unitMinutes=0')),
      ).toBe(true),
    )
  })

  it('saves every group, including the access grace window that had no UI before', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Access grace period after an assignment ends'), {
      target: { value: '30' },
    })
    fireEvent.click(screen.getByTestId('save-settings'))

    await waitFor(() => expect(putBodies).toHaveLength(1))
    expect(putBodies[0]).toEqual({
      rounding: { unitMinutes: 15, direction: 'up' },
      defaults: { billable: true, chainStartFromPreviousEnd: true },
      targets: { dailyHours: 8 },
      warnings: { overlap: true, runningTimer: true },
      access: { assignmentGraceDays: 30 },
    })
  })

  it('keeps Save disabled until something changes and while a field is unsaveable', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    expect(screen.getByTestId('save-settings')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Daily hours target'), { target: { value: '30' } })
    expect(screen.getByTestId('save-settings')).toBeDisabled()
    expect(screen.getByText('Enter a number of hours between 0 and 24, or leave the field empty.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Daily hours target'), { target: { value: '6' } })
    expect(screen.getByTestId('save-settings')).not.toBeDisabled()
  })

  it('keeps an emptied daily target as a real null', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Daily hours target'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('save-settings'))

    await waitFor(() => expect(putBodies).toHaveLength(1))
    expect((putBodies[0] as { targets: { dailyHours: number | null } }).targets.dailyHours).toBeNull()
  })

  it('refuses to reapply rounding from a rule that has not been saved', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    expect(screen.getByTestId('reapply-rounding')).not.toBeDisabled()

    fireEvent.click(screen.getByRole('radio', { name: '5 min' }))

    await waitFor(() => expect(screen.getByTestId('reapply-rounding')).toBeDisabled())
  })

  it('confirms before queueing the retro-rounding job', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByTestId('reapply-rounding'))

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(
      mockApiCall.mock.calls.some(([input]) => String(input).includes('reapply-rounding')),
    ).toBe(false)
  })

  it('queues the job and reports the count once confirmed', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('reapply-rounding'))

    await waitFor(() =>
      expect(
        mockApiCall.mock.calls.some(([input]) => String(input).includes('reapply-rounding')),
      ).toBe(true),
    )
    await waitFor(() =>
      expect(mockFlash).toHaveBeenCalledWith(expect.stringContaining('1284'), 'success'),
    )
  })

  it('says so plainly when there is nothing to restate', async () => {
    reapplyResponse = { ok: true, progressJobId: null, candidateCount: 0 }
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('reapply-rounding'))

    await waitFor(() =>
      expect(mockFlash).toHaveBeenCalledWith('There is nothing to recalculate.', 'info'),
    )
  })

  it('degrades to a stated message when the impact preview fails', async () => {
    mockApiCall.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/settings/rounding-impact')) {
        return { ok: false, status: 500, result: null, response: {} as Response, cacheStatus: null } as never
      }
      return ok(settings) as never
    })

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('The impact preview is unavailable.')).toBeInTheDocument(),
    )
  })

  it('states that the rules are global, so nobody looks for a per-project override', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    expect(
      screen.getByText('These rules are global — they cannot be set per customer or per project.'),
    ).toBeInTheDocument()
  })

  it('renders read-only for a caller without the manage feature', async () => {
    mockUseBackendChrome.mockReturnValue({ payload: { grantedFeatures: ['staff.timesheets.view'] } } as never)

    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    expect(screen.getByTestId('reapply-rounding')).toBeDisabled()
    expect(screen.getByLabelText('Daily hours target')).toBeDisabled()
    expect(screen.getByTestId('save-settings')).toBeDisabled()
  })
})
