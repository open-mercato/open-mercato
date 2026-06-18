/**
 * @jest-environment jsdom
 *
 * Regression test for issue #3306 — the time-reporting dashboard widget must not
 * load its initial timer state through a serial request waterfall. There are two
 * independent dependency chains: assignments → project details, and self profile →
 * active entries. The heads of both chains must start together, and their dependents
 * must also start together, instead of waiting on each other round-trip by round-trip.
 */
import * as React from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, type TimeReportingSettings } from '../config'

const mockReadApiResult = jest.fn()
const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResult(...args),
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (_key: string, fallback?: string) => fallback ?? _key
  return { useT: () => translate }
})

import TimeReportingWidget from '../widget.client'

type LoadStage = 'assignments' | 'self' | 'projects' | 'entries'

function classifyUrl(url: string): LoadStage {
  if (url.includes('/timesheets/my-projects')) return 'assignments'
  if (url.includes('/team-members/self')) return 'self'
  if (url.includes('/timesheets/time-projects')) return 'projects'
  if (url.includes('/timesheets/time-entries')) return 'entries'
  throw new Error(`[internal] unexpected url in test: ${url}`)
}

type Deferred = { resolve: (value: unknown) => void }

let deferred: Partial<Record<LoadStage, Deferred>>
let callCounts: Record<LoadStage, number>

function callCount(stage: LoadStage): number {
  return callCounts[stage]
}

async function resolveStage(stage: LoadStage, value: unknown): Promise<void> {
  await act(async () => {
    deferred[stage]?.resolve(value)
    await Promise.resolve()
  })
}

function renderWidget(): void {
  const props: DashboardWidgetComponentProps<TimeReportingSettings> = {
    mode: 'view',
    layout: { id: 'layout-1', widgetId: 'staff.timesheets.time_reporting', order: 0 },
    settings: DEFAULT_SETTINGS,
    context: { userId: 'user-1' },
    onSettingsChange: jest.fn(),
    refreshToken: 0,
  }
  render(<TimeReportingWidget {...props} />)
}

describe('staff TimeReportingWidget — issue #3306 parallel load', () => {
  beforeEach(() => {
    deferred = {}
    callCounts = { assignments: 0, self: 0, projects: 0, entries: 0 }
    mockReadApiResult.mockReset()
    mockApiCall.mockReset()
    mockReadApiResult.mockImplementation((input: RequestInfo | URL) => {
      const stage = classifyUrl(String(input))
      callCounts[stage] += 1
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
