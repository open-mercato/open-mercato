/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const timerState = {
  running: false,
  projectId: null as string | null,
  isLoading: false,
  error: null as Error | null,
}

const preferenceState = {
  lastProjectId: null as string | null,
  isLoading: false,
  error: null as Error | null,
}

const saveMock = jest.fn().mockResolvedValue(undefined)

jest.mock('../useActiveTimesheetTimer', () => ({
  useActiveTimesheetTimer: () => ({
    staffMemberId: 'staff-1',
    entryId: null,
    running: timerState.running,
    startedAt: null,
    projectId: timerState.projectId,
    projectName: null,
    projectColor: null,
    notes: null,
    isLoading: timerState.isLoading,
    isFetching: false,
    error: timerState.error,
    refresh: jest.fn().mockResolvedValue(undefined),
  }),
}))

jest.mock('../useTimesheetPreference', () => ({
  useTimesheetPreference: () => ({
    lastProjectId: preferenceState.lastProjectId,
    updatedAt: null,
    isLoading: preferenceState.isLoading,
    isFetching: false,
    error: preferenceState.error,
    save: saveMock,
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation()),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
}))
jest.mock('../startTimer', () => ({ startTimerEntry: jest.fn().mockResolvedValue({ id: 'entry-1' }) }))

import { TimerBar } from '../TimerBar'

const PROJECTS = [
  { id: 'p-1', name: 'Apollo', code: 'AP', color: null },
  { id: 'p-2', name: 'Borealis', code: 'BO', color: null },
]

function renderTimerBar(props: { visibleProjectIds?: string[] } = {}) {
  return renderWithProviders(
    <TimerBar
      projects={PROJECTS}
      staffMemberId="staff-1"
      onTimerStopped={jest.fn()}
      visibleProjectIds={props.visibleProjectIds}
    />,
  )
}

function pickerLabel() {
  // The picker button shows the selected project's name, or "Project" when empty.
  return screen.getByRole('button', { name: /Apollo|Borealis|Project/ }).textContent
}

describe('TimerBar picker seeding', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    timerState.running = false
    timerState.projectId = null
    timerState.isLoading = false
    timerState.error = null
    preferenceState.lastProjectId = null
    preferenceState.isLoading = false
    preferenceState.error = null
  })

  it('seeds from the persisted last project', () => {
    preferenceState.lastProjectId = 'p-2'
    renderTimerBar()
    expect(pickerLabel()).toContain('Borealis')
    expect(screen.getByRole('button', { name: 'Start timer' })).toBeEnabled()
  })

  it('seeds from the sole grid-visible project', () => {
    renderTimerBar({ visibleProjectIds: ['p-1'] })
    expect(pickerLabel()).toContain('Apollo')
  })

  it('does not seed when two projects are equally plausible', () => {
    renderTimerBar({ visibleProjectIds: ['p-1', 'p-2'] })
    expect(pickerLabel()).toBe('Project')
    expect(screen.getByRole('button', { name: 'Start timer' })).toBeDisabled()
  })

  describe('race guards', () => {
    it('does not seed while the active-timer lookup is still in flight', () => {
      // The preference has settled but the timer has not. Seeding now would apply
      // rung 2 and then be overtaken by the running timer's project.
      timerState.isLoading = true
      preferenceState.lastProjectId = 'p-2'
      renderTimerBar()
      expect(pickerLabel()).toBe('Project')
    })

    it('does not seed while the preference query is still in flight', () => {
      preferenceState.isLoading = true
      renderTimerBar({ visibleProjectIds: ['p-1'] })
      expect(pickerLabel()).toBe('Project')
    })

    it('does not seed a lower rung when the active-timer lookup failed', async () => {
      // A failed lookup settles `isLoading` but falls back to an empty timer, so
      // rung 1 reads null and rung 2 would win — and latch. Thirty seconds later
      // the refetch recovers, the running timer hides the picker, and the wrong
      // seed only resurfaces after a Stop, booking the next start to the wrong
      // project. That is the exact confusion #3750 exists to fix.
      timerState.error = new Error('lookup failed')
      preferenceState.lastProjectId = 'p-2'
      const { rerender } = renderTimerBar()
      expect(pickerLabel()).toBe('Project')

      // The refetch recovers and reports the timer really was on Apollo.
      timerState.error = null
      timerState.projectId = 'p-1'
      rerender(
        <TimerBar projects={PROJECTS} staffMemberId="staff-1" onTimerStopped={jest.fn()} />,
      )

      await waitFor(() => expect(pickerLabel()).toContain('Apollo'))
    })

    it('re-seeds from scratch when the staff member changes', async () => {
      // A different member id means a different organization. If the component
      // survives that switch without remounting, a latched ref would keep the
      // previous org's project selected while `projects` refreshes to the new
      // org's list. Guarded so it fires only on a real member-to-member change:
      // an unconditional reset runs on mount and clobbers the fresh seed.
      preferenceState.lastProjectId = 'p-2'
      const { rerender } = renderTimerBar()
      expect(pickerLabel()).toContain('Borealis')

      preferenceState.lastProjectId = 'p-1'
      rerender(
        <TimerBar projects={PROJECTS} staffMemberId="staff-2" onTimerStopped={jest.fn()} />,
      )

      await waitFor(() => expect(pickerLabel()).toContain('Apollo'))
    })

    it('does not seed a lower rung when the preference fetch failed', () => {
      // Symmetric with the active-timer guard: a failed fetch settles with
      // `lastProjectId: null`, so rung 2 is skipped and a lower rung would
      // latch before a retry could correct it.
      preferenceState.error = new Error('preference lookup failed')
      renderTimerBar({ visibleProjectIds: ['p-1'] })
      expect(pickerLabel()).toBe('Project')
    })

    it('lets a running timer outrank the persisted preference', () => {
      timerState.projectId = 'p-1'
      preferenceState.lastProjectId = 'p-2'
      renderTimerBar()
      // Not running, but a timer project resolved — rung 1 still wins over rung 2.
      expect(pickerLabel()).toContain('Apollo')
    })

    it('never overwrites a deliberate pick with a late-arriving preference', async () => {
      preferenceState.isLoading = true
      const { rerender } = renderTimerBar()

      fireEvent.click(screen.getByRole('button', { name: 'Project' }))
      fireEvent.click(await screen.findByRole('button', { name: /Borealis/ }))
      expect(pickerLabel()).toContain('Borealis')

      // The preference lands afterwards, naming a different project.
      preferenceState.isLoading = false
      preferenceState.lastProjectId = 'p-1'
      rerender(
        <TimerBar projects={PROJECTS} staffMemberId="staff-1" onTimerStopped={jest.fn()} />,
      )

      await waitFor(() => expect(pickerLabel()).toContain('Borealis'))
    })
  })

  describe('persistence', () => {
    it('stores the project on a successful start', async () => {
      preferenceState.lastProjectId = 'p-1'
      renderTimerBar()

      fireEvent.click(screen.getByRole('button', { name: 'Start timer' }))
      await waitFor(() => expect(saveMock).toHaveBeenCalledWith('p-1'))
    })

    it('does not store on selection alone — an idle mis-click is not a default', async () => {
      renderTimerBar()

      fireEvent.click(screen.getByRole('button', { name: 'Project' }))
      fireEvent.click(await screen.findByRole('button', { name: /Apollo/ }))

      expect(pickerLabel()).toContain('Apollo')
      expect(saveMock).not.toHaveBeenCalled()
    })

    it('does not surface an error when the preference write fails', async () => {
      const { flash } = jest.requireMock('@open-mercato/ui/backend/FlashMessages')
      saveMock.mockRejectedValueOnce(new Error('network'))
      preferenceState.lastProjectId = 'p-1'
      renderTimerBar()

      fireEvent.click(screen.getByRole('button', { name: 'Start timer' }))
      await waitFor(() => expect(saveMock).toHaveBeenCalled())
      // The timer already started; a failed memory write must stay silent.
      expect(flash).not.toHaveBeenCalled()
    })
  })
})
