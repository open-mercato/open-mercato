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

let mockScopeVersion = 1
let mockScope: { tenantId: string | null; organizationId: string | null } = { tenantId: null, organizationId: null }

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockScopeVersion,
  useOrganizationScopeDetail: () => mockScope,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: jest.fn() }))

const mockAfterSave = jest.fn()
const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => {
  const result = await operation()
  mockAfterSave()
  return result
})

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (input: { operation: () => Promise<unknown> }) => mockRunMutation(input),
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

let putGate: Promise<void> | null = null

let putOutcome: 'saved' | 'tenantScopeChanged' = 'saved'

function ok<T>(result: T) {
  return { ok: true, status: 200, result, response: {} as Response, cacheStatus: null }
}

function tenantScopeChanged() {
  return {
    ok: false,
    status: 409,
    result: { error: 'The selected tenant changed before the request was processed.', code: 'tenant_scope_changed' },
    response: {} as Response,
    cacheStatus: null,
  }
}

function installRouter() {
  mockApiCall.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/settings/rounding-impact')) return ok(impactResponse) as never
    if (url.includes('/settings/reapply-rounding')) return ok(reapplyResponse) as never
    if (url.includes('/timesheets/settings')) {
      if (init?.method === 'PUT') {
        putBodies.push(JSON.parse(String(init.body)))
        if (putGate) await putGate
        if (putOutcome === 'tenantScopeChanged') return tenantScopeChanged() as never
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
  putGate = null
  putOutcome = 'saved'
  mockScopeVersion = 1
  mockScope = { tenantId: null, organizationId: null }
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

  it('keeps an unsaved edit and its Save state when the organization scope settles after the first load', async () => {
    const view = renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Daily hours target'), { target: { value: '6' } })
    expect(screen.getByTestId('save-settings')).not.toBeDisabled()

    settings = { ...settings, targets: { dailyHours: 5 } }
    mockScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
    mockScopeVersion = 2
    view.rerender(<TimeTrackingSettingsPage />)
    await waitFor(() => {
      const settingsGets = mockApiCall.mock.calls.filter(([url, init]) =>
        String(url).endsWith('/timesheets/settings') && init?.method !== 'PUT')
      expect(settingsGets).toHaveLength(2)
    })
    await waitFor(() => expect(screen.getByTestId('save-settings')).not.toBeDisabled())

    expect(screen.getByLabelText('Daily hours target')).toHaveValue('6')
  })

  it('re-seeds a dirty draft when the scope changes to a different tenant', async () => {
    mockScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
    const view = renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Daily hours target'), { target: { value: '6' } })
    expect(screen.getByTestId('save-settings')).not.toBeDisabled()

    settings = { ...settings, targets: { dailyHours: 5 } }
    mockScope = { tenantId: 'tenant-b', organizationId: 'org-b' }
    mockScopeVersion = 2
    view.rerender(<TimeTrackingSettingsPage />)

    await waitFor(() => expect(screen.getByLabelText('Daily hours target')).toHaveValue('5'))
    expect(screen.getByTestId('save-settings')).toBeDisabled()
  })

  it('does not apply a save response that resolves after the tenant scope changed', async () => {
    mockScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
    const view = renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Daily hours target'), { target: { value: '6' } })
    let releasePut: () => void = () => undefined
    putGate = new Promise<void>((resolve) => {
      releasePut = resolve
    })
    fireEvent.click(screen.getByTestId('save-settings'))
    await waitFor(() => expect(putBodies).toHaveLength(1))

    settings = { ...settings, targets: { dailyHours: 5 } }
    mockScope = { tenantId: 'tenant-b', organizationId: 'org-b' }
    mockScopeVersion = 2
    view.rerender(<TimeTrackingSettingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Daily hours target')).toHaveValue('5'))

    releasePut()
    await waitFor(() => expect(screen.getByTestId('save-settings')).toBeDisabled())
    await waitFor(() => {
      const settingsGets = mockApiCall.mock.calls.filter(([url, init]) =>
        String(url).endsWith('/timesheets/settings') && init?.method !== 'PUT')
      expect(settingsGets).toHaveLength(3)
    })
    expect(screen.getByLabelText('Daily hours target')).toHaveValue('5')
  })

  it('pins the save to the tenant the form was edited in', async () => {
    mockScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Daily hours target'), { target: { value: '6' } })
    fireEvent.click(screen.getByTestId('save-settings'))

    await waitFor(() => expect(putBodies).toHaveLength(1))
    const putCall = mockApiCall.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(String(putCall?.[0])).toBe('/api/staff/timesheets/settings?expectedTenantId=tenant-a')
  })

  it('does not send a save when the tenant changes before the request goes out', async () => {
    mockScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
    const view = renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Daily hours target'), { target: { value: '6' } })

    let releaseBeforeSave: () => void = () => undefined
    const beforeSaveGate = new Promise<void>((resolve) => {
      releaseBeforeSave = resolve
    })
    mockRunMutation.mockImplementationOnce(async ({ operation }) => {
      await beforeSaveGate
      return operation()
    })
    fireEvent.click(screen.getByTestId('save-settings'))

    mockScope = { tenantId: 'tenant-b', organizationId: 'org-b' }
    mockScopeVersion = 2
    view.rerender(<TimeTrackingSettingsPage />)
    releaseBeforeSave()

    await waitFor(() =>
      expect(mockFlash).toHaveBeenCalledWith(
        'The tenant changed before the settings were saved. Nothing was saved.',
        'warning',
      ),
    )
    expect(putBodies).toHaveLength(0)
  })

  it('reports a save the server refused because the tenant changed', async () => {
    mockScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Daily hours target'), { target: { value: '6' } })

    putOutcome = 'tenantScopeChanged'
    fireEvent.click(screen.getByTestId('save-settings'))

    await waitFor(() =>
      expect(mockFlash).toHaveBeenCalledWith(
        'The tenant changed before the settings were saved. Nothing was saved.',
        'warning',
      ),
    )
    expect(putBodies).toHaveLength(1)
    expect(mockFlash).not.toHaveBeenCalledWith('Settings saved.', 'success')
    expect(mockFlash).not.toHaveBeenCalledWith('Failed to save the settings.', 'error')
    expect(mockAfterSave).not.toHaveBeenCalled()
  })

  it('discards the edit and shows the reloaded tenant as saved after the server refused a save before the scope event arrived', async () => {
    mockScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
    renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Daily hours target'), { target: { value: '6' } })

    settings = { ...settings, targets: { dailyHours: 5 } }
    putOutcome = 'tenantScopeChanged'
    fireEvent.click(screen.getByTestId('save-settings'))

    await waitFor(() => {
      const settingsGets = mockApiCall.mock.calls.filter(([url, init]) =>
        String(url).endsWith('/timesheets/settings') && init?.method !== 'PUT')
      expect(settingsGets).toHaveLength(2)
    })
    await waitFor(() => expect(screen.getByLabelText('Daily hours target')).toHaveValue('5'))
    expect(screen.getByTestId('save-settings')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('re-seeds a pristine form when the organization scope changes', async () => {
    const view = renderPage()
    await waitFor(() => expect(screen.getByTestId('rounding-examples')).toBeInTheDocument())

    settings = { ...settings, targets: { dailyHours: 5 } }
    mockScopeVersion = 2
    view.rerender(<TimeTrackingSettingsPage />)

    await waitFor(() => expect(screen.getByLabelText('Daily hours target')).toHaveValue('5'))
    expect(screen.getByTestId('save-settings')).toBeDisabled()
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
