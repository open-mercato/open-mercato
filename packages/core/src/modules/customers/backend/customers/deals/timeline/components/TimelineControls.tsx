"use client"

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import {
  isDealTimelineBucket,
  isDealTimelineGroupBy,
  type DealTimelineBucket,
  type DealTimelineGroupBy,
} from '../../../../../lib/dealsTimeline'

export type TimelineControlsProps = {
  bucket: DealTimelineBucket
  groupBy: DealTimelineGroupBy
  rangeLabel: string
  onBucketChange: (bucket: DealTimelineBucket) => void
  onGroupByChange: (groupBy: DealTimelineGroupBy) => void
  onPrevious: () => void
  onToday: () => void
  onNext: () => void
}

export function TimelineControls({
  bucket,
  groupBy,
  rangeLabel,
  onBucketChange,
  onGroupByChange,
  onPrevious,
  onToday,
  onNext,
}: TimelineControlsProps): React.ReactElement {
  const t = useT()
  const groupByLabel = translateWithFallback(t, 'customers.deals.timeline.groupBy.label', 'Group by')
  const columnsLabel = translateWithFallback(t, 'customers.deals.timeline.columns.label', 'Columns')
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{groupByLabel}</span>
        <SegmentedControl
          size="sm"
          aria-label={groupByLabel}
          value={groupBy}
          onValueChange={(value) => {
            if (isDealTimelineGroupBy(value)) onGroupByChange(value)
          }}
        >
          <SegmentedControlItem value="owner">
            {translateWithFallback(t, 'customers.deals.timeline.groupBy.owner', 'Owner')}
          </SegmentedControlItem>
          <SegmentedControlItem value="stage">
            {translateWithFallback(t, 'customers.deals.timeline.groupBy.stage', 'Stage')}
          </SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{columnsLabel}</span>
        <SegmentedControl
          size="sm"
          aria-label={columnsLabel}
          value={bucket}
          onValueChange={(value) => {
            if (isDealTimelineBucket(value)) onBucketChange(value)
          }}
        >
          <SegmentedControlItem value="week">
            {translateWithFallback(t, 'customers.deals.timeline.columns.week', 'Week')}
          </SegmentedControlItem>
          <SegmentedControlItem value="month">
            {translateWithFallback(t, 'customers.deals.timeline.columns.month', 'Month')}
          </SegmentedControlItem>
          <SegmentedControlItem value="quarter">
            {translateWithFallback(t, 'customers.deals.timeline.columns.quarter', 'Quarter')}
          </SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div className="flex items-center gap-1 sm:ml-auto">
        <IconButton
          type="button"
          variant="outline"
          size="default"
          aria-label={translateWithFallback(t, 'customers.deals.timeline.nav.previous', 'Previous')}
          onClick={onPrevious}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <Button type="button" variant="outline" size="sm" onClick={onToday}>
          {translateWithFallback(t, 'customers.deals.timeline.nav.today', 'Today')}
        </Button>
        <IconButton
          type="button"
          variant="outline"
          size="default"
          aria-label={translateWithFallback(t, 'customers.deals.timeline.nav.next', 'Next')}
          onClick={onNext}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </IconButton>
        <span className="ml-2 text-sm font-medium text-foreground" aria-live="polite">
          {rangeLabel}
        </span>
      </div>
    </div>
  )
}
