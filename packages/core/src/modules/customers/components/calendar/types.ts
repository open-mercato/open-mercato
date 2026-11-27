import type { CalendarInteractionPayload } from '@open-mercato/core/helpers/calendar/interactionPayload'

export { calendarInteractionPayloadSchema, type CalendarInteractionPayload } from '@open-mercato/core/helpers/calendar/interactionPayload'

export type CalendarView = 'day' | 'week' | 'month' | 'agenda'

export type CalendarCategory = 'meeting' | 'event' | 'task' | 'other'

export type CalendarItemStatus = 'planned' | 'done' | 'canceled'

export type CalendarPlatform = 'zoom' | 'meet' | 'slack' | 'teams'

export type CalendarLocationKind = 'url' | 'venue' | 'platform'

export type CalendarTab = 'all' | 'meetings' | 'events'

export type CalendarRangePreset = 'thisWeek' | 'next7' | 'thisMonth' | 'next30'

export type CalendarRange = { from: Date; to: Date }

export type CalendarParticipant = { userId?: string; name?: string; email?: string; status?: string }

export interface CalendarItem {
  id: string
  title: string
  interactionType: string
  category: CalendarCategory
  status: CalendarItemStatus
  start: Date
  end: Date
  allDay: boolean
  location: string | null
  platform: CalendarPlatform | null
  locationKind: CalendarLocationKind | null
  participants: CalendarParticipant[]
  ownerUserId: string | null
  entityId: string | null
  dealId: string | null
  color: string | null
  isRecurringOccurrence: boolean
  updatedAt: string | null
  raw: CalendarInteractionPayload
}

export interface CalendarFiltersValue {
  types: string[]
  status: string | null
  ownerUserId: string | null
}

export interface TimeGridProps {
  days: 1 | 7
  anchor: Date
  items: CalendarItem[]
  conflictIds: Set<string>
  conflictDescriptions?: ReadonlyMap<string, string>
  showWeekends: boolean
  showConflicts: boolean
  aiSummaries: boolean
  canManage?: boolean
  highlightItemId?: string | null
  /** Dictionary icon per interaction type (`lucide:*`), used by the dense-slot overflow list. */
  typeIcons?: Record<string, string | null>
  onItemClick(item: CalendarItem): void
  onJoin(item: CalendarItem): void
  /** Cancels a planned event from the block peek; omitted when the host has no cancel flow. */
  onCancelItem?(item: CalendarItem): void | Promise<void>
  onNavigate(deltaDays: number): void
  onCreate?: () => void
  onCreateRange?(start: Date, end: Date): void
}

export interface MonthGridProps {
  conflictDescriptions?: ReadonlyMap<string, string>
  anchor: Date
  items: CalendarItem[]
  onItemClick(item: CalendarItem): void
  onDayOpen(date: Date): void
}

export interface AgendaListProps {
  conflictDescriptions?: ReadonlyMap<string, string>
  anchor: Date
  horizonDays: number
  items: CalendarItem[]
  typeLabels?: Record<string, string>
  onItemClick(item: CalendarItem): void
}

export interface UpcomingCard {
  item: CalendarItem
  kind: 'today' | 'conflicted' | 'cancelled' | 'future'
  conflictCount: number
}

export interface UpcomingCardsProps {
  cards: UpcomingCard[]
  canManage?: boolean
  onJoin(item: CalendarItem): void
  onSeeConflict(item: CalendarItem): void
  onOpen(item: CalendarItem): void
  onEdit(item: CalendarItem): void
  onCancel(item: CalendarItem): void
}

export interface CalendarHeaderProps {
  view: CalendarView
  anchor: Date
  onNewEvent?: () => void
}

export interface CalendarToolbarProps {
  view: CalendarView
  anchor: Date
  range: CalendarRange
  preset: CalendarRangePreset | null
  search: string
  filters: CalendarFiltersValue
  typeOptions: Array<{ value: string; label: string }>
  ownerOptions: Array<{ value: string; label: string }>
  onToday(): void
  onPresetChange(preset: CalendarRangePreset): void
  onAnchorChange(date: Date): void
  onSearchChange(value: string): void
  onFiltersChange(value: CalendarFiltersValue): void
  onOpenSettings(): void
}

export interface CalendarTabsProps {
  tab: CalendarTab
  counts: { all: number; meetings: number; events: number }
  view: CalendarView
  onTabChange(tab: CalendarTab): void
  onViewChange(view: CalendarView): void
}

export interface CalendarFooterProps {
  timezoneLabel: string
  onOpenShortcuts?: () => void
}
