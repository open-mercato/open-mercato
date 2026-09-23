/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const activeTimerState: {
  running: boolean
  projectId: string | null
  isLoading: boolean
} = { running: false, projectId: null, isLoading: false }

jest.mock('../useActiveTimesheetTimer', () => ({
  useActiveTimesheetTimer: () => ({
    staffMemberId: 'staff-1',
    entryId: null,
    running: activeTimerState.running,
    startedAt: null,
    projectId: activeTimerState.projectId,
    projectName: null,
    projectColor: null,
    notes: null,
    isLoading: activeTimerState.isLoading,
    isFetching: false,
    error: null,
    refresh: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
}))
jest.mock('../startTimer', () => ({ startTimerEntry: jest.fn() }))

// Settled-and-empty: this spec is about the hint, not the seed. A stored default
// would seed the picker and the "no project picked" branch would never render.
jest.mock('../useTimesheetPreference', () => ({
  useTimesheetPreference: () => ({
    lastProjectId: null,
    updatedAt: null,
    isLoading: false,
    isFetching: false,
    error: null,
    save: jest.fn().mockResolvedValue(undefined),
  }),
}))

import { TimerBar } from '../TimerBar'

const PROJECTS = [
  { id: 'p-1', name: 'Apollo', code: 'AP', color: 'blue' },
  { id: 'p-2', name: 'Borealis', code: 'BO', color: 'green' },
]

function renderTimerBar(projects: typeof PROJECTS) {
  return renderWithProviders(
    <TimerBar projects={projects} staffMemberId="staff-1" onTimerStopped={jest.fn()} />,
  )
}

function getStartButton() {
  return screen.getByRole('button', { name: 'Start timer' })
}

describe('TimerBar disabled Start hint', () => {
  beforeEach(() => {
    activeTimerState.running = false
    activeTimerState.projectId = null
    activeTimerState.isLoading = false
  })

  it('explains that a project must be picked when projects are assigned', () => {
    renderTimerBar(PROJECTS)

    const start = getStartButton()
    expect(start).toBeDisabled()

    const describedBy = start.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      'Pick a project to start the timer',
    )
  })

  it('tells the user to ask an admin when no projects are assigned at all', () => {
    renderTimerBar([])

    const start = getStartButton()
    expect(start).toBeDisabled()

    const describedBy = start.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      'No projects assigned yet — ask an admin to assign you to one',
    )
  })

  it('drops the hint and enables Start once a project is picked', async () => {
    renderTimerBar(PROJECTS)

    // Open the picker and choose a project — the same path a real user takes.
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))
    fireEvent.click(await screen.findByRole('button', { name: /Apollo/ }))

    const start = getStartButton()
    expect(start).toBeEnabled()
    expect(start.getAttribute('aria-describedby')).toBeNull()
    expect(screen.queryByText('Pick a project to start the timer')).toBeNull()
  })

  it('renders no hint while a timer is already running', () => {
    activeTimerState.running = true
    activeTimerState.projectId = 'p-1'
    renderTimerBar(PROJECTS)

    // The running state swaps Start for Stop, so there is nothing to explain.
    expect(screen.getByRole('button', { name: 'Stop timer' })).toBeEnabled()
    expect(screen.queryByText('Pick a project to start the timer')).toBeNull()
  })
})
