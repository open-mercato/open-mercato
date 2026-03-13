"use client"

// Backward compatibility: re-export generic components with CRM-specific defaults
// New code should import from @open-mercato/ui/backend/timeline instead

export {
  TimelineItem as GenericTimelineItem,
  formatRelativeTime,
  formatAbsoluteTime,
  formatFieldValue,
  formatDuration,
  formatFileSize,
} from '@open-mercato/ui/backend/timeline/TimelineItem'

export {
  TimelineFilterDropdown as GenericFilterDropdown,
} from '@open-mercato/ui/backend/timeline/TimelineFilterDropdown'

export type { FilterState } from '@open-mercato/ui/backend/timeline/TimelineFilterDropdown'

// CRM-specific TimelineItem wrapper that auto-binds CRM config
import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { TimelineEntry } from './types'
import { dealTimelinePanelConfig } from './config'
import { TimelineItem as GenericTimelineItem } from '@open-mercato/ui/backend/timeline/TimelineItem'
import { TimelineFilterDropdown as GenericFilterDropdown } from '@open-mercato/ui/backend/timeline/TimelineFilterDropdown'
import { ALL_TIMELINE_KINDS, type TimelineEntryKind } from './types'

export type TimelineItemProps = {
  entry: TimelineEntry
  isLast: boolean
  t: TranslateFn
  dealBadge?: React.ReactNode
}

export function TimelineItem({ entry, isLast, t, dealBadge }: TimelineItemProps) {
  return (
    <GenericTimelineItem
      entry={entry}
      isLast={isLast}
      t={t}
      config={dealTimelinePanelConfig}
      badge={dealBadge}
    />
  )
}

export function FilterDropdown({
  selected,
  onChange,
  t,
}: {
  selected: Set<TimelineEntryKind>
  onChange: (next: Set<TimelineEntryKind>) => void
  t: TranslateFn
}) {
  const kindLabels = dealTimelinePanelConfig.kindLabels(t)
  return (
    <GenericFilterDropdown
      allKinds={ALL_TIMELINE_KINDS}
      kindLabels={kindLabels}
      selected={selected}
      onChange={onChange}
      t={t}
    />
  )
}

// Re-export CRM icon/color maps for any direct consumers
export { dealTimelinePanelConfig } from './config'

/** @deprecated Use dealTimelinePanelConfig.kindIcons instead */
export const KIND_ICONS = dealTimelinePanelConfig.kindIcons
/** @deprecated Use dealTimelinePanelConfig.kindBgColors instead */
export const KIND_BG = dealTimelinePanelConfig.kindBgColors
/** @deprecated Use dealTimelinePanelConfig.kindIconColors instead */
export const KIND_ICON_COLOR = dealTimelinePanelConfig.kindIconColors
/** @deprecated Use dealTimelinePanelConfig.resolveActivityIcon instead */
export const resolveActivityIcon = dealTimelinePanelConfig.resolveActivityIcon!
