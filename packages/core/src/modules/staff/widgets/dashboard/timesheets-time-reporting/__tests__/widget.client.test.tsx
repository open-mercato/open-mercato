/**
 * @jest-environment jsdom
 *
 * Regression tests for the time-reporting dashboard widget.
 *
 * - Issue #3306 — the widget must not load its initial timer state through a serial
 *   request waterfall. There are two independent dependency chains: assignments →
 *   project details, and self profile → active entries. The heads of both chains must
 *   start together, and their dependents must also start together, instead of waiting
 *   on each other round-trip by round-trip.
 * - Issue #3507 — a rejected start surfaces the localized server message in an
 *   announced alert (role="alert") instead of the generic English fallback.
 */
import * as React from 'react'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, type TimeReportingSettings } from '../config'

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const SERVER_MESSAGE = 'Inny licznik czasu jest już uruchomiony.'

const mockReadApiResult = jest.fn()
const mockApiCall = jest.fn()
const mockStartTimerEntry = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResult(...args),
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('../../../../lib/timesheets-ui/startTimer', () => ({
  startTimerEntry: (...args: unknown[]) => mockStartTimerEntry(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  // Stable translate reference: the widget's loadState effect depends on `t`,
  // so a fresh function per render would re-trigger the load and keep the
  // widget in its loading state forever (the real useT is memoized).
  const translate = (_key: string, fallback?: string) => fallback ?? _key
  return { useT: () => translate }
})

import TimeReportingWidget from '../widget.client'

function renderWidget(overrides: Partial<DashboardWidgetComponentProps<TimeReportingSettings>> = {}): void {
  const props: DashboardWidgetComponentProps<TimeReportingSettings> = {
    mode: 'view',
    layout: { id: 'layout-1', widgetId: 'staff.timesheets.time_reporting', order: 0 },
    settings: DEFAULT_SETTINGS,
    context: { userId: 'user-1' },
    onSettingsChange: jest.fn(),
    refreshToken: 0,
    ...overrides,
  }
  render(<TimeReportingWidget {...props} />)
}

type LoadStage = 'assignments' | 'self' | 'projects' | 'entries'

function classifyUrl(url: string): LoadStage {
  if (url.includes('/timesheets/my-projects')) return 'assignments'
  if (url.includes('/team-members/self')) return 'self'
  if (url.includes('/timesheets/time-projects')) return 'projects'
  if (url.includes('/timesheets/time-entries')) return 'entries'
  throw new Error(`[internal] unexpected url in test: ${url}`)
}

type Deferred = { resolve: (value: unknown) => void }

describe('staff TimeReportingWidget — issue #3306 parallel load', () => {
  let deferred: Partial<Record<LoadStage, Deferred>>
  let callCounts: Record<LoadStage, number>
  let stageUrls: Partial<Record<LoadStage, string>>

  function callCount(stage: LoadStage): number {
    return callCounts[stage]
  }

  async function resolveStage(stage: LoadStage, value: unknown): Promise<void> {
    await act(async () => {
      deferred[stage]?.resolve(value)
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    deferred = {}
    callCounts = { assignments: 0, self: 0, projects: 0, entries: 0 }
    stageUrls = {}
    mockReadApiResult.mockReset()
    mockApiCall.mockReset()
    mockReadApiResult.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      const stage = classifyUrl(url)
      callCounts[stage] += 1
      stageUrls[stage] = url
      return new Promise((resolve) => {
        deferred[stage] = { resolve }
      })
    })
  })

  it('starts both independent dependency chains concurrently instead of serially', async () => {
    renderWidget()

    // The heads of the two chains fire before either resolves — proving they are not serial.
    await waitFor(() => {
      expect(callCount('assignments')).toBe(1)
      expect(callCount('self')).toBe(1)
    })
    // Their dependents cannot start yet: they need the first-stage results.
    expect(callCount('projects')).toBe(0)
    expect(callCount('entries')).toBe(0)

    await resolveStage('assignments', { items: [{ time_project_id: 'project-1' }] })
    await resolveStage('self', { member: { id: 'member-1' } })

    // The second-stage requests are independent of each other and also start together.
    await waitFor(() => {
      expect(callCount('projects')).toBe(1)
      expect(callCount('entries')).toBe(1)
    })

    await resolveStage('projects', { items: [{ id: 'project-1', name: 'Project One', code: 'P1' }] })
    await resolveStage('entries', { items: [] })

    await waitFor(() => {
      expect(screen.getByText(/Project One/)).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Start Timer' })).toBeTruthy()
  })

  it('renders a running timer from an active entry (behavior preserved)', async () => {
    renderWidget()

    await waitFor(() => {
      expect(callCount('assignments')).toBe(1)
      expect(callCount('self')).toBe(1)
    })
    await resolveStage('assignments', { items: [{ time_project_id: 'project-1' }] })
    await resolveStage('self', { member: { id: 'member-1' } })

    await waitFor(() => {
      expect(callCount('projects')).toBe(1)
      expect(callCount('entries')).toBe(1)
    })
    await resolveStage('projects', { items: [{ id: 'project-1', name: 'Project One', code: 'P1' }] })
    await resolveStage('entries', {
      items: [
        { id: 'entry-9', started_at: '2026-06-18T08:00:00.000Z', ended_at: null, time_project_id: 'project-1' },
      ],
    })

    await waitFor(() => {
      expect(screen.getByText('Timer running')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Stop Timer' })).toBeTruthy()
  })

  it('looks up the active timer by running state rather than today (issue #3717)', async () => {
    renderWidget()

    await waitFor(() => {
      expect(callCount('assignments')).toBe(1)
      expect(callCount('self')).toBe(1)
    })
    await resolveStage('assignments', { items: [] })
    await resolveStage('self', { member: { id: 'member-1' } })

    await waitFor(() => {
      expect(callCount('entries')).toBe(1)
    })

    const entriesUrl = stageUrls.entries ?? ''
    expect(entriesUrl).toContain('running=true')
    // A date-scoped lookup hides a timer started before midnight after the date rolls over.
    expect(entriesUrl).not.toContain('from=')
    expect(entriesUrl).not.toContain('to=')
  })

  it('skips the project-details request and shows the empty state when no projects are assigned', async () => {
    renderWidget()

    await waitFor(() => {
      expect(callCount('assignments')).toBe(1)
      expect(callCount('self')).toBe(1)
    })
    await resolveStage('assignments', { items: [] })
    await resolveStage('self', { member: { id: 'member-1' } })

    // No assignment ids → no project-details round trip, but entries still load for the member.
    await waitFor(() => {
      expect(callCount('entries')).toBe(1)
    })
    expect(callCount('projects')).toBe(0)

    await resolveStage('entries', { items: [] })

    await waitFor(() => {
      expect(screen.getByText('No projects assigned.')).toBeTruthy()
    })
  })
})

describe('staff TimeReportingWidget — issue #3507 start error surfacing', () => {
  beforeEach(() => {
    mockStartTimerEntry.mockReset()
    mockApiCall.mockReset()
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: {} })
    mockReadApiResult.mockReset()
    mockReadApiResult.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/staff/timesheets/my-projects')) {
        return { items: [{ time_project_id: PROJECT_ID }] }
      }
      if (url.includes('/api/staff/timesheets/time-projects')) {
        return { items: [{ id: PROJECT_ID, name: 'Acme', code: null }] }
      }
      if (url.includes('/api/staff/team-members/self')) {
        return { member: { id: MEMBER_ID } }
      }
      if (url.includes('/api/staff/timesheets/time-entries')) {
        return { items: [] }
      }
      return { items: [] }
    })
  })

  it('surfaces the localized server message in an announced alert when start is rejected', async () => {
    // The atomic start-timer route rejects a second concurrent start with a
    // localized 409 message (carried on the thrown error's `status` + message).
    mockStartTimerEntry.mockRejectedValue(Object.assign(new Error(SERVER_MESSAGE), { status: 409 }))

    renderWidget({ settings: { lastProjectId: null } })

    // Wait for the start form to hydrate, then pick the assigned project.
    const projectSelect = (await screen.findByLabelText('Project')) as HTMLSelectElement
    fireEvent.change(projectSelect, { target: { value: PROJECT_ID } })

    fireEvent.click(screen.getByRole('button', { name: 'Start Timer' }))

    // BUG-002: the error is rendered in a live region (role="alert").
    // BUG-001: the live region shows the server's localized reason, not the
    // generic English fallback.
    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toBe(SERVER_MESSAGE)
    })
    expect(screen.queryByText('Failed to start timer')).toBeNull()
  })
})
