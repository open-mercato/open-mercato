/**
 * @jest-environment jsdom
 */
// The inline description editor of the timesheet list. These three cases predate
// the screen-12 redesign and are the reason the editor exists in its current
// shape; T5.3 rebuilt the surface around them and they are asserted unchanged.
//
// New since the redesign: the PUT carries the record version, so a concurrent
// edit of the same entry is a conflict rather than a silent overwrite.
import * as React from 'react'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ListView } from '../ListView'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { buildTimesheetDays, type TimesheetEntry } from '../../time-tracking-ui/timesheetData'
import { projectTarget } from '../../time-tracking-ui/timesheetTargets'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: false, status: 500, result: null, response: {} })),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(
    async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: jest.fn(() => ({ 'x-om-version': 'v1' })),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

// Radix Select measures its trigger; jsdom ships neither observer nor pointer capture.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false)
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {})

const apiCallOrThrowMock = apiCallOrThrow as unknown as jest.Mock
const buildOptimisticLockHeaderMock = buildOptimisticLockHeader as unknown as jest.Mock
const surfaceRecordConflictMock = surfaceRecordConflict as unknown as jest.Mock
const flashMock = flash as unknown as jest.Mock

const WEEK = { from: '2026-06-15', to: '2026-06-21' }
const PROJECT = { id: 'project-1', name: 'Project One', code: null, color: null }

const ENTRY: TimesheetEntry = {
  id: 'entry-1',
  date: '2026-06-19',
  taskId: null,
  taskTitle: 'Cart migration',
  timeProjectId: 'project-1',
  projectLabel: 'Project One',
  description: null,
  startText: '',
  endText: '',
  durationMinutes: 60,
  roundedMinutes: null,
  isBillable: true,
  cost: null,
  currencyCode: null,
  rateOverrideAmount: null,
  isLocked: false,
  lockedReportId: null,
  updatedAt: '2026-06-19T08:00:00.000Z',
  tagIds: [],
  staffMemberId: 'staff-1',
}

function renderList(onEntryUpdated: jest.Mock) {
  render(
    <ListView
      days={buildTimesheetDays(WEEK, [ENTRY])}
      scaleMinutes={480}
      dailyTargetMinutes={480}
      expandedDate="2026-06-19"
      onExpandedDateChange={jest.fn()}
      targets={[projectTarget(PROJECT)]}
      showAuthor={false}
      authorNames={new Map()}
      canManage
      onQuickAdd={jest.fn()}
      onEditEntry={jest.fn()}
      onDuplicateEntry={jest.fn()}
      onEntryUpdated={onEntryUpdated}
      locale="en-GB"
    />,
  )
}

function startEditingAndSubmit(newValue: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add description' }))
  const input = screen.getByPlaceholderText('Add description') as HTMLInputElement
  fireEvent.change(input, { target: { value: newValue } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('timesheet inline description save', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    surfaceRecordConflictMock.mockReturnValue(false)
    buildOptimisticLockHeaderMock.mockReturnValue({ 'x-om-version': 'v1' })
  })

  it('does not treat a failed PUT as success: keeps the editor open, flashes an error, and never calls onEntryUpdated', async () => {
    apiCallOrThrowMock.mockRejectedValue(Object.assign(new Error('Server error'), { status: 500 }))
    const onEntryUpdated = jest.fn()

    renderList(onEntryUpdated)
    startEditingAndSubmit('Updated note')

    await waitFor(() => {
      expect(flashMock).toHaveBeenCalledWith('Failed to save description. Please try again.', 'error')
    })
    expect(onEntryUpdated).not.toHaveBeenCalled()
    // Editor stays open so the user can retry — the input is still present.
    expect(screen.getByPlaceholderText('Add description')).toBeInTheDocument()
  })

  it('treats a 2xx PUT as success: closes the editor and calls onEntryUpdated', async () => {
    apiCallOrThrowMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true }, response: {} })
    const onEntryUpdated = jest.fn()

    renderList(onEntryUpdated)
    startEditingAndSubmit('Updated note')

    await waitFor(() => {
      expect(onEntryUpdated).toHaveBeenCalledTimes(1)
    })
    expect(flashMock).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Add description')).not.toBeInTheDocument()
  })

  it('surfaces the conflict bar on a 409 conflict instead of a generic error and does not call onEntryUpdated', async () => {
    apiCallOrThrowMock.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409 }))
    surfaceRecordConflictMock.mockReturnValue(true)
    const onEntryUpdated = jest.fn()

    renderList(onEntryUpdated)
    startEditingAndSubmit('Updated note')

    await waitFor(() => {
      expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1)
    })
    expect(flashMock).not.toHaveBeenCalled()
    expect(onEntryUpdated).not.toHaveBeenCalled()
  })

  it('sends exactly one write when Enter commits and the resulting blur fires: the disabled input must not re-save a stale version', async () => {
    let settleWrite: (value: unknown) => void = () => {}
    apiCallOrThrowMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleWrite = resolve
        }),
    )
    const onEntryUpdated = jest.fn()

    renderList(onEntryUpdated)
    fireEvent.click(screen.getByRole('button', { name: 'Add description' }))
    const input = screen.getByPlaceholderText('Add description') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Updated note' } })
    // Enter starts the save, `disabled={saving}` blurs the focused input, and the
    // blur handler used to fire a second PUT carrying the pre-save version.
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)

    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      settleWrite({ ok: true, status: 200, result: { ok: true }, response: {} })
    })

    await waitFor(() => {
      expect(onEntryUpdated).toHaveBeenCalledTimes(1)
    })
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    expect(surfaceRecordConflictMock).not.toHaveBeenCalled()
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('sends the entry version with the write, so a concurrent edit conflicts instead of overwriting', async () => {
    apiCallOrThrowMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true }, response: {} })
    renderList(jest.fn())
    startEditingAndSubmit('Updated note')

    await waitFor(() => {
      expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    })
    expect(buildOptimisticLockHeaderMock).toHaveBeenCalledWith('2026-06-19T08:00:00.000Z')
    const [, init] = apiCallOrThrowMock.mock.calls[0]
    expect(JSON.parse(String(init.body))).toEqual({ id: 'entry-1', notes: 'Updated note' })
  })
})
