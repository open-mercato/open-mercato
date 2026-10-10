/**
 * @jest-environment jsdom
 */
import type { z } from 'zod'
import { getComponentEntry } from '@open-mercato/shared/modules/widgets/component-registry'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { timeEntryDialogPropsSchema } from '../TimeEntryDialog'
import { timeEntriesSummaryFooterPropsSchema } from '../TimeEntriesSummaryFooter'
import { kanbanCardPropsSchema } from '../KanbanCard'
import { kanbanColumnPropsSchema } from '../KanbanColumn'
import { timesheetCalendarPropsSchema } from '../TimesheetCalendar'
import { reportSheetPropsSchema } from '../ReportSheet'
import { projectCardPropsSchema } from '../../timesheets-projects-ui/ProjectCard'
import { timerBarPropsSchema } from '../../timesheets-ui/TimerBar'
import { listViewPropsSchema } from '../../timesheets-ui/ListView'
import { gridViewPropsSchema } from '../../../backend/staff/time-tracking/timesheet/GridView'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

const hosts = extensionPoints.hosts

const published: Array<[string, string, z.ZodTypeAny]> = [
  ['timeEntryDialogPropsSchema', hosts.timeEntryDialogComponent.componentId, timeEntryDialogPropsSchema],
  ['timeEntriesSummaryFooterPropsSchema', hosts.entriesSummaryFooterComponent.componentId, timeEntriesSummaryFooterPropsSchema],
  ['kanbanCardPropsSchema', hosts.kanbanCardComponent.componentId, kanbanCardPropsSchema],
  ['kanbanColumnPropsSchema', hosts.kanbanColumnComponent.componentId, kanbanColumnPropsSchema],
  ['timesheetCalendarPropsSchema', hosts.timesheetCalendarComponent.componentId, timesheetCalendarPropsSchema],
  ['reportSheetPropsSchema', hosts.reportSheetComponent.componentId, reportSheetPropsSchema],
  ['projectCardPropsSchema', hosts.projectCardComponent.componentId, projectCardPropsSchema],
  ['timerBarPropsSchema', hosts.timerBarComponent.componentId, timerBarPropsSchema],
  ['listViewPropsSchema', hosts.timesheetListComponent.componentId, listViewPropsSchema],
  ['gridViewPropsSchema', hosts.timesheetGridComponent.componentId, gridViewPropsSchema],
]

describe('published time-tracking component props schemas', () => {
  it.each(published)('%s is the exact schema registered for its handle', (_name, componentId, schema) => {
    expect(typeof schema.safeParse).toBe('function')
    expect(getComponentEntry(componentId)?.metadata?.propsSchema).toBe(schema)
  })

  it('covers every replaceable handle exactly once', () => {
    expect(new Set(published.map(([, componentId]) => componentId)).size).toBe(10)
  })

  it('accepts minimal dialog props and rejects a non-function callback', () => {
    const onOpenChange = () => {}
    expect(timeEntryDialogPropsSchema.safeParse({ open: true, onOpenChange }).success).toBe(true)
    expect(timeEntryDialogPropsSchema.safeParse({ open: true, onOpenChange: 'nope' }).success).toBe(false)
  })

  it('treats an omitted optional callback as absent, not as a mismatch', () => {
    const onOpenChange = () => {}
    expect(timeEntryDialogPropsSchema.safeParse({ open: false, onOpenChange, onSaved: 'nope' }).success).toBe(false)
    expect(timeEntryDialogPropsSchema.safeParse({ open: false, onOpenChange, onSaved: () => {} }).success).toBe(true)
  })
})
