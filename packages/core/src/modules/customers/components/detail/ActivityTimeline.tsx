'use client'
import * as React from 'react'
import { Check, ListTodo, Pencil, Phone, Mail, Trash2, Users, StickyNote, User } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDisplayTime } from '@open-mercato/ui/primitives/date-format'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { cn } from '@open-mercato/shared/lib/utils'
import { AiActionChips } from './AiActionChips'
import type { InteractionSummary } from './types'
import { isCanceledInteractionStatus, isOpenInteractionStatus } from '../../lib/interactionStatus'
import { toLocalZonedDate } from '../../lib/localDay'
import { formatZonedDateParts } from '../../lib/displayDate'

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
  task: ListTodo,
}

interface ActivityTimelineProps {
  activities: InteractionSummary[]
  onEdit?: (activity: InteractionSummary) => void
  onMarkDone?: (activityId: string, updatedAt?: string | null) => void | Promise<void>
  onDelete?: (activity: InteractionSummary) => void | Promise<void>
  canDelete?: (activity: InteractionSummary) => boolean
}

export function ActivityTimeline({ activities, onEdit, onMarkDone, onDelete, canDelete }: ActivityTimelineProps) {
  const t = useT()

  if (activities.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        {t('customers.timeline.empty', 'No activities match the current filters.')}
      </div>
    )
  }

  return (
    <div>
      {activities.map((activity, index) => {
        const dateStr = activity.scheduledAt ?? activity.occurredAt
        const activityYear = dateStr ? new Date(dateStr).getFullYear() : null
        const prevDateStr = index > 0 ? (activities[index - 1].scheduledAt ?? activities[index - 1].occurredAt) : null
        const prevYear = prevDateStr ? new Date(prevDateStr).getFullYear() : null
        const showYearSeparator = activityYear !== null && prevYear !== null && activityYear !== prevYear

        return (
          <React.Fragment key={activity.id}>
            {showYearSeparator && (
              <div className="flex items-center gap-3 py-3 px-5">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-semibold text-muted-foreground">
                  {t('customers.activities.yearSeparator', '{year}', { year: activityYear })}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
            <TimelineEntry
              activity={activity}
              t={t}
              withBorder={index < activities.length - 1}
              onEdit={onEdit}
              onMarkDone={onMarkDone}
              onDelete={!canDelete || canDelete(activity) ? onDelete : undefined}
            />
          </React.Fragment>
        )
      })}
    </div>
  )
}

function TimelineEntry({
  activity,
  t,
  withBorder,
  onEdit,
  onMarkDone,
  onDelete,
}: {
  activity: InteractionSummary
  t: TranslateFn
  withBorder: boolean
  onEdit?: (activity: InteractionSummary) => void
  onMarkDone?: (activityId: string, updatedAt?: string | null) => void | Promise<void>
  onDelete?: (activity: InteractionSummary) => void | Promise<void>
}) {
  const locale = useLocale()
  const dateStr = activity.scheduledAt ?? activity.occurredAt
  const TypeIcon = TYPE_ICONS[activity.interactionType]
  const title = activity.title ?? activity.body ?? activity.interactionType
  const duration = activity.duration ? ` (${activity.duration} min)` : ''
  const isOpen = isOpenInteractionStatus(activity.status)
  const isCanceled = isCanceledInteractionStatus(activity.status)
  const [markingDone, setMarkingDone] = React.useState(false)
  const deletingRef = React.useRef(false)

  const handleMarkDone = React.useCallback(async (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation()
    if (!onMarkDone || markingDone) return
    setMarkingDone(true)
    try {
      await onMarkDone(activity.id, activity.updatedAt)
    } finally {
      setMarkingDone(false)
    }
  }, [activity.id, activity.updatedAt, markingDone, onMarkDone])

  const handleDelete = React.useCallback(async () => {
    if (!onDelete || deletingRef.current) return
    deletingRef.current = true
    try {
      await onDelete(activity)
    } finally {
      deletingRef.current = false
    }
  }, [activity, onDelete])

  return (
    <div
      className={`@container py-2.5 ${withBorder ? 'border-b border-border/60' : ''} ${onEdit ? 'cursor-pointer hover:bg-accent/40 transition-colors' : ''}`}
      onClick={() => onEdit?.(activity)}
      role={onEdit ? 'button' : undefined}
      tabIndex={onEdit ? 0 : undefined}
      onKeyDown={onEdit ? (e) => { if (e.key === 'Enter') onEdit(activity) } : undefined}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 @md:flex-nowrap">
        {/* Column 1: Date */}
        <div className="flex basis-full items-baseline gap-1.5 @md:block @md:w-19 @md:shrink-0 @md:basis-auto">
          <span className="block text-xs font-semibold leading-tight text-foreground">
            {dateStr ? formatRelativeDate(dateStr, t, locale) : t('customers.timeline.date.unknown', 'Unknown date')}
          </span>
          <span className="block text-xs leading-tight text-muted-foreground">
            {dateStr ? formatTime(dateStr, locale) : null}
          </span>
        </div>

        {/* Column 2: Type icon */}
        <div className="flex size-8 items-center justify-center rounded-md bg-muted shrink-0">
          {TypeIcon ? <TypeIcon className="size-3.5 text-muted-foreground" /> : null}
        </div>

        {/* Column 3: Content */}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-start justify-end gap-2">
            <div className="flex min-w-32 flex-1 flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  'block text-xs font-semibold leading-tight',
                  isCanceled ? 'text-muted-foreground line-through' : 'text-foreground',
                )}
              >
                {title}{duration}
              </span>
              {isCanceled ? (
                <StatusBadge variant="neutral" className="shrink-0">
                  {t('customers.interactions.status.canceled', 'Canceled')}
                </StatusBadge>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {isOpen && onMarkDone ? (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={markingDone}
                  onClick={handleMarkDone}
                  className="h-7 text-xs"
                >
                  <Check className="size-3.5" />
                  {t('customers.activities.actions.markDone', 'Mark done')}
                </Button>
              ) : null}
              {onEdit || onDelete ? (
                <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} role="presentation">
                  <RowActions
                    items={[
                      ...(onEdit ? [{
                        id: 'edit',
                        label: t('customers.timeline.edit', 'Edit'),
                        icon: <Pencil />,
                        onSelect: () => onEdit(activity),
                      }] : []),
                      ...(onDelete ? [{
                        id: 'delete',
                        label: t('customers.activities.actions.delete', 'Delete activity'),
                        icon: <Trash2 />,
                        destructive: true,
                        onSelect: () => { void handleDelete() },
                      }] : []),
                    ]}
                  />
                </div>
              ) : null}
            </div>
          </div>

          {activity.body && activity.title && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {activity.body}
            </p>
          )}

          {activity.authorName && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <User className="size-2.5 shrink-0" />
              <span>{t('customers.timeline.author', 'by {{name}}', { name: activity.authorName })}</span>
            </div>
          )}

          <AiActionChips activityType={activity.interactionType} />
        </div>
      </div>
    </div>
  )
}

function formatRelativeDate(isoString: string, t: TranslateFn, locale: string): string {
  try {
    const date = new Date(isoString)
    const zoned = toLocalZonedDate(date)
    const now = toLocalZonedDate(new Date())
    // Compare calendar dates (not time-based diff) to correctly handle same-day future times
    const dateDay = new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate())
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const diffDays = Math.round((nowDay.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return t('customers.timeline.date.today', 'today')
    if (diffDays === 1) return t('customers.timeline.date.yesterday', 'yesterday')
    return formatZonedDateParts(date, { day: 'numeric', month: 'short' }, locale)
  } catch {
    return ''
  }
}

function formatTime(isoString: string, locale: string): string {
  try {
    return formatDisplayTime(new Date(isoString), locale) ?? ''
  } catch {
    return ''
  }
}
