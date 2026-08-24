/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { KanbanCard } from '../lib/time-tracking-ui/KanbanCard'
import { KanbanColumn } from '../lib/time-tracking-ui/KanbanColumn'
import { ReportSheet } from '../lib/time-tracking-ui/ReportSheet'
import { TimesheetCalendar } from '../lib/time-tracking-ui/TimesheetCalendar'
import { TimesheetPeriodFooter } from '../lib/time-tracking-ui/TimesheetPeriodFooter'
import type { BoardStatus, BoardTask } from '../lib/time-tracking-ui/kanbanBoardData'
import type { TimesheetSummary } from '../lib/time-tracking-ui/timesheetData'

/**
 * Proves the two things an injection host has to get right.
 *
 * 1. **An empty spot is invisible.** Every component below is rendered twice: once
 *    with `InjectionSpot` behaving as it does with no registered widget (renders
 *    `null`), and once with a sentinel element in its place. Stripping the
 *    sentinels from the second render must reproduce the first render byte for
 *    byte — which is only true when the spots contribute no wrapper, no
 *    whitespace and no layout node of their own. The first render is therefore
 *    also the markup these components produced before the spots existed.
 * 2. **The spots are the declared ones, in the expected place.** The sentinel
 *    render records the spot ids and the element each one landed in.
 */

const mockSpotState: { renderSentinels: boolean; ids: string[] } = {
  renderSentinels: false,
  ids: [],
}

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => {
  const react = jest.requireActual<typeof import('react')>('react')
  return {
    __esModule: true,
    InjectionSpot: ({ spotId }: { spotId: string }) => {
      mockSpotState.ids.push(spotId)
      return mockSpotState.renderSentinels ? react.createElement('i', { 'data-spot': spotId }) : null
    },
    useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
    useInjectionSpotEvents: () => ({ triggerEvent: async () => ({ ok: true }), widgets: [] }),
  }
})

jest.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  useDraggable: () => ({ setNodeRef: () => {}, attributes: {}, listeners: {}, isDragging: false }),
}))

const SENTINEL_PATTERN = /<i data-spot="[^"]*"><\/i>/g

type SpotRenderResult = { html: string; spotIds: string[] }

function renderOnce(element: React.ReactElement, renderSentinels: boolean): SpotRenderResult {
  mockSpotState.renderSentinels = renderSentinels
  mockSpotState.ids = []
  const view = render(React.createElement(I18nProvider, { locale: 'en', dict: {} }, element))
  const result = { html: view.container.innerHTML, spotIds: [...mockSpotState.ids] }
  view.unmount()
  return result
}

function expectSpotsAreInvisible(element: React.ReactElement, expectedSpotIds: string[]) {
  const empty = renderOnce(element, false)
  const withSentinels = renderOnce(element, true)
  expect([...new Set(withSentinels.spotIds)].sort()).toEqual([...expectedSpotIds].sort())
  expect(withSentinels.html).toContain('data-spot')
  expect(withSentinels.html.replace(SENTINEL_PATTERN, '')).toBe(empty.html)
  expect(empty.html).not.toContain('data-spot')
}

const SUMMARY: TimesheetSummary = {
  totalMinutes: 480,
  billableMinutes: 360,
  targetMinutes: 480,
  deltaMinutes: 0,
  workingDays: 1,
}

const STATUS: BoardStatus = {
  id: 'status-1',
  name: 'In progress',
  slug: 'in-progress',
  color: null,
  position: 1,
  isDefault: true,
  isDone: false,
}

const TASK: BoardTask = {
  id: 'task-1',
  title: 'Write the migration',
  reference: 'TSK-1',
  timeProjectId: 'project-1',
  parentTaskId: null,
  taskStatusId: 'status-1',
  assigneeStaffMemberId: null,
  position: 1,
  ownMinutes: 60,
  loggedMinutes: 90,
  childCount: 0,
  closedAt: null,
  updatedAt: null,
  tagIds: [],
}

describe('staff time-tracking injection spots render nothing when empty', () => {
  it('timesheet period footer', () => {
    expectSpotsAreInvisible(
      React.createElement(TimesheetPeriodFooter, { summary: SUMMARY, dailyHours: 8 }),
      ['staff.timesheet:period-footer'],
    )
  })

  it('timesheet calendar day cells', () => {
    expectSpotsAreInvisible(
      React.createElement(TimesheetCalendar, {
        monthAnchors: ['2026-08-01'],
        days: new Map(),
        scaleMinutes: null,
        todayDate: '2026-08-24',
        onAddEntry: () => {},
        onSelectEntry: () => {},
      }),
      ['staff.timesheet:day-cell-actions'],
    )
  })

  it('report sheet', () => {
    expectSpotsAreInvisible(
      React.createElement(ReportSheet, {
        reportId: 'report-1',
        reference: 'RPT-1',
        customerName: 'Acme',
        periodLabel: '2026-08-01 \u2013 2026-08-31',
        issuedByLabel: null,
        issuedAtLabel: null,
        currencyCode: 'PLN',
        showRates: false,
        groups: [],
        totals: { billableMinutes: 360, nonbillableMinutes: 120, totalAmount: null },
        roundingLabel: 'off',
      }),
      ['staff.time_report.sheet:before-lines', 'staff.time_report.sheet:after-totals'],
    )
  })

  it('kanban column header', () => {
    expectSpotsAreInvisible(
      React.createElement(KanbanColumn, {
        status: STATUS,
        tasks: [],
        total: 0,
        canQuickAdd: false,
        loadingMore: false,
        activeDragTaskId: null,
        pendingTaskIds: new Set<string>(),
        runningTimerTaskId: null,
        assigneeNames: new Map<string, string>(),
        tagsByTaskId: new Map(),
        subtasksByTaskId: new Map(),
        quickAddPending: false,
        onQuickAdd: async () => {},
        onLoadMore: () => {},
        onOpenTask: () => {},
        onStartTimer: () => {},
        onStopTimer: () => {},
        onAddTime: () => {},
      }),
      ['staff.time_task.board:column-header'],
    )
  })

  it('kanban card badges and footer', () => {
    expectSpotsAreInvisible(
      React.createElement(KanbanCard, {
        task: TASK,
        assigneeName: null,
        tags: [],
        subtasks: null,
        timerRunning: false,
        pending: false,
        isActiveDrag: false,
        onOpen: () => {},
        onStartTimer: () => {},
        onStopTimer: () => {},
        onAddTime: () => {},
      }),
      ['staff.time_task.board:card-badges', 'staff.time_task.board:card-footer'],
    )
  })
})
