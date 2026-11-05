"use client"

import * as React from 'react'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import {
  TimeEntriesSummaryFooter,
  type TimeEntriesSummaryFooterProps,
} from '../../../lib/time-tracking-ui/TimeEntriesSummaryFooter'

export type TimeEntriesTableInjectionContext = {
  tableId?: string | null
  title?: string
  entriesSummary?: TimeEntriesSummaryFooterProps
}

function TimeEntriesSummaryFooterWidget({ context }: { context: TimeEntriesTableInjectionContext }) {
  const props = context?.entriesSummary
  if (!props) return null
  return <TimeEntriesSummaryFooter {...props} />
}

const widget: InjectionWidgetModule<TimeEntriesTableInjectionContext> = {
  metadata: {
    id: 'staff.injection.time-entries-summary-footer',
    title: 'Time entries totals',
    description: 'Totals for the filtered time entries, rendered inside the entries table footer.',
    features: ['staff.timesheets.view'],
  },
  Widget: TimeEntriesSummaryFooterWidget,
}

export default widget
