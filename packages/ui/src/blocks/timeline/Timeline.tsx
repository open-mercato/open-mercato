"use client"

import * as React from 'react'
import {
  Activity,
  ArrowRight,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  Download,
  History,
  Mail,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  StickyNote,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { cn } from '@open-mercato/shared/lib/utils'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { ActivityFeedFileChip, ActivityFeedStatusChip } from '@open-mercato/ui/primitives/activity-feed'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownList,
  DropdownTrigger,
} from '@open-mercato/ui/primitives/dropdown'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { BlockAction } from '../contracts/shared'
import type { TimelineChange, TimelineItem, TimelineProps, TimelineTarget } from '../contracts/timeline'
import { groupTimelineByDay, groupTimelineByPeriod } from './grouping'

type TranslateFn = ReturnType<typeof useT>

function BlockIcon({ name, className }: { name: string | undefined; className: string }) {
  const Icon = resolveRegisteredLucideIcon(name)
  if (!Icon) return null
  return <Icon aria-hidden="true" className={className} />
}

function isSafeDownloadHref(href: string | undefined): href is string {
  if (!href) return false
  if (href.startsWith('/')) return !href.startsWith('//')
  try {
    const protocol = new URL(href).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function formatFullDateTime(value: string, locale: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatClockTime(value: string, locale: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date)
}

const KIND_ICONS: Record<string, LucideIcon> = {
  note: StickyNote,
  email: Mail,
  call: Phone,
  meeting: CalendarDays,
  file: Paperclip,
  task: CheckSquare,
  'stage-change': TrendingUp,
  created: Plus,
}

const CHANGES_PREVIEW = 3
const BODY_CLAMP_LENGTH = 240

function TimelineNode({ item }: { item: TimelineItem }) {
  const Registered = resolveRegisteredLucideIcon(item.icon)
  const Icon = Registered ?? KIND_ICONS[item.kind] ?? Activity
  return (
    <span
      data-slot="timeline-item-icon"
      className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground"
    >
      <Icon aria-hidden="true" className="size-4" />
    </span>
  )
}

function TimelineTargetChip({ target }: { target: TimelineTarget }) {
  const content = (
    <>
      {target.avatarSrc ? (
        <Avatar size="xs" label={target.label} src={target.avatarSrc} />
      ) : target.icon ? (
        <BlockIcon name={target.icon} className="size-4 text-muted-foreground" />
      ) : null}
      <span className="min-w-0 truncate">{target.label}</span>
    </>
  )
  const className = 'inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-1 align-top text-sm text-foreground'
  if (target.href && isSafeDownloadHref(target.href)) {
    return (
      <a
        data-slot="timeline-item-target"
        href={target.href}
        className={cn(className, 'relative outline-none after:absolute after:inset-x-0 after:-inset-y-1 hover:bg-muted focus-visible:shadow-focus')}
      >
        {content}
      </a>
    )
  }
  return (
    <span data-slot="timeline-item-target" className={className}>
      {content}
    </span>
  )
}

function TimelineChanges({ changes, t }: { changes: TimelineChange[]; t: TranslateFn }) {
  const [expanded, setExpanded] = React.useState(false)
  const collapsible = changes.length > CHANGES_PREVIEW
  const visible = collapsible && !expanded ? changes.slice(0, CHANGES_PREVIEW) : changes
  return (
    <div data-slot="timeline-item-changes" className="mt-2 flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {visible.map((change, index) => (
          <li key={change.key ?? `${change.label}-${index}`} className="flex min-w-0 items-start gap-2 text-sm">
            <span data-slot="timeline-change-label" className="flex w-36 shrink-0 items-start gap-2 text-muted-foreground">
              <span className="flex h-5 w-4 shrink-0 items-center justify-center">
                {change.icon ? <BlockIcon name={change.icon} className="size-4" /> : <span aria-hidden="true" className="size-1 rounded-full bg-current" />}
              </span>
              <span className="min-w-0 break-words">{change.label}</span>
            </span>
            <span className="flex h-5 shrink-0 items-center text-muted-foreground">
              <ArrowRight aria-hidden="true" className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              {change.from !== undefined && change.from !== null ? (
                <span data-slot="timeline-change-from" className="order-last min-w-0 break-words text-muted-foreground line-through">{change.from}</span>
              ) : null}
              <span data-slot="timeline-change-to" className="min-w-0 break-words text-foreground">{change.to}</span>
            </span>
          </li>
        ))}
      </ul>
      {collapsible ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown aria-hidden="true" className={cn('transition-transform', expanded && 'rotate-180')} />
            {expanded
              ? t('ui.blocks.timeline.hideChanges', 'Hide changes')
              : t('ui.blocks.timeline.showChanges', 'Show all changes')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function TimelineBody({ body, custom, t }: { body: React.ReactNode; custom: boolean; t: TranslateFn }) {
  const [expanded, setExpanded] = React.useState(false)
  const [overflowing, setOverflowing] = React.useState(true)
  const textRef = React.useRef<HTMLDivElement>(null)
  const clampable = typeof body === 'string' && body.length > BODY_CLAMP_LENGTH

  React.useEffect(() => {
    const node = textRef.current
    if (!clampable || expanded || !node || typeof ResizeObserver === 'undefined') return
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [clampable, expanded])

  if (custom) {
    return (
      <div data-slot="timeline-item-body" className="mt-2 min-w-0 text-sm text-foreground">
        {body}
      </div>
    )
  }

  return (
    <div data-slot="timeline-item-body" className="mt-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
      <div ref={textRef} className={cn('min-w-0 whitespace-pre-line break-words', clampable && !expanded && 'line-clamp-3')}>{body}</div>
      {clampable && (expanded || overflowing) ? (
        <Button
          type="button"
          variant="muted"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 -ml-2 px-2 font-normal"
        >
          {expanded ? t('ui.blocks.timeline.collapseBody', 'Show less') : t('ui.blocks.timeline.expandBody', 'Show more')}
        </Button>
      ) : null}
    </div>
  )
}

type ItemMenuProps = {
  item: TimelineItem
  actions: BlockAction[]
  onItemAction: NonNullable<TimelineProps['onItemAction']>
  t: TranslateFn
}

function TimelineItemMenu({ item, actions, onItemAction, t }: ItemMenuProps) {
  const [open, setOpen] = React.useState(false)
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)

  const runAction = React.useCallback(
    async (actionKey: string) => {
      setOpen(false)
      setPendingKey(actionKey)
      try {
        await onItemAction(item.id, actionKey)
      } catch {
        return
      } finally {
        setPendingKey(null)
      }
    },
    [item.id, onItemAction],
  )

  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <IconButton
          variant="ghost"
          className="-my-1"
          disabled={pendingKey !== null}
          aria-label={t('ui.blocks.timeline.itemActions', 'Item actions')}
        >
          {pendingKey !== null ? <Spinner size="sm" /> : <MoreHorizontal aria-hidden="true" />}
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-56">
        <DropdownList>
          {actions.map((action) => {
            const icon = action.icon ? <BlockIcon name={action.icon} className="size-4" /> : undefined
            return (
              <DropdownItem
                key={action.key}
                value={action.key}
                size={action.disabledReason ? 56 : 36}
                disabled={action.disabled}
                leading={icon}
                description={action.disabledReason}
                className={cn(action.tone === 'destructive' && 'text-destructive')}
                onSelect={() => {
                  void runAction(action.key)
                }}
              >
                {action.label}
              </DropdownItem>
            )
          })}
        </DropdownList>
      </DropdownContent>
    </Dropdown>
  )
}

type TimelineEntryProps = {
  item: TimelineItem
  locale: string
  timeFormat: 'relative' | 'clock'
  renderItemBody: TimelineProps['renderItemBody']
  onItemAction: TimelineProps['onItemAction']
  t: TranslateFn
}

function TimelineEntry({ item, locale, timeFormat, renderItemBody, onItemAction, t }: TimelineEntryProps) {
  const full = formatFullDateTime(item.occurredAt, locale)
  const timeLabel =
    (timeFormat === 'clock' ? formatClockTime(item.occurredAt, locale) : formatRelativeTime(item.occurredAt, { locale })) ?? full
  const body = renderItemBody ? renderItemBody(item) : item.body
  const hasBody = body !== undefined && body !== null && body !== false
  const hasAttachments = Boolean(item.attachments?.length)
  const actions = item.actions ?? []

  return (
    <li data-timeline-item-id={item.id} data-slot="timeline-item" className="group/timeline-item relative flex gap-3 pb-6 last:pb-0">
      <span aria-hidden="true" className="absolute top-6 bottom-0 left-3 w-px bg-border group-last/timeline-item:hidden" />
      <TimelineNode item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div data-slot="timeline-item-sentence" className="min-w-0 flex-1 break-words text-sm leading-6">
            {item.author ? (
              <>
                <Avatar size={24} label={item.author.name} src={item.author.avatarSrc} className="mr-2 align-top font-normal" />
                <span data-slot="timeline-item-author" className="text-foreground">
                  {item.author.name}
                </span>{' '}
              </>
            ) : null}
            <span data-slot="timeline-item-title" className={item.author ? 'text-muted-foreground' : 'text-foreground'}>
              {item.title}
            </span>
            {item.target ? (
              <>
                {' '}
                <TimelineTargetChip target={item.target} />
              </>
            ) : null}
            {'\u2002'}
            <time dateTime={item.occurredAt} title={full} suppressHydrationWarning className="whitespace-nowrap text-xs text-muted-foreground">
              {timeLabel}
            </time>
          </div>
          {actions.length > 0 && onItemAction ? (
            <TimelineItemMenu item={item} actions={actions} onItemAction={onItemAction} t={t} />
          ) : null}
        </div>
        {item.changes && item.changes.length > 0 ? <TimelineChanges changes={item.changes} t={t} /> : null}
        {hasBody ? <TimelineBody body={body} custom={Boolean(renderItemBody)} t={t} /> : null}
        {hasAttachments ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {item.attachments?.map((attachment) => (
              <span
                key={`${attachment.name}-${attachment.href ?? ''}`}
                data-slot="timeline-attachment"
                className="inline-flex items-center gap-1"
              >
                <ActivityFeedFileChip name={attachment.name} size={attachment.format} nameWeight="regular" className="shadow-none" />
                {isSafeDownloadHref(attachment.href) ? (
                  <IconButton
                    asChild
                    variant="ghost"
                    aria-label={t('ui.blocks.timeline.downloadAttachment', 'Download')}
                  >
                    <a
                      data-slot="timeline-attachment-download"
                      href={attachment.href}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download aria-hidden="true" />
                    </a>
                  </IconButton>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
        {item.status ? (
          <div className="mt-2">
            <ActivityFeedStatusChip status={item.status.tone} className="font-normal shadow-none">{item.status.label}</ActivityFeedStatusChip>
          </div>
        ) : null}
      </div>
    </li>
  )
}

function TimelineList({ items, entryProps }: { items: TimelineItem[]; entryProps: Omit<TimelineEntryProps, 'item'> }) {
  return (
    <ol data-slot="timeline-list" className="flex flex-col">
      {items.map((item) => (
        <TimelineEntry key={item.id} item={item} {...entryProps} />
      ))}
    </ol>
  )
}

function TimelinePeriodSection({
  label,
  count,
  items,
  entryProps,
}: {
  label: string
  count: number
  items: TimelineItem[]
  entryProps: Omit<TimelineEntryProps, 'item'>
}) {
  const t = entryProps.t
  const [open, setOpen] = React.useState(true)
  const contentId = React.useId()
  return (
    <section data-slot="timeline-day-group" className="flex flex-col gap-3">
      {label ? (
        <h3 data-slot="timeline-day-label" className="sticky top-0 z-20 bg-background">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={() => setOpen((value) => !value)}
            className="flex min-h-8 w-full items-center justify-between gap-3 rounded-sm py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:shadow-focus"
          >
            <span data-slot="timeline-period-name" className="min-w-0 text-left">{label}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span data-slot="timeline-period-count" aria-hidden="true" className="tabular-nums">
                {count}
              </span>
              <span className="sr-only">{t('ui.blocks.timeline.entryCount', 'Entries: {count}', { count })}</span>
              <ChevronDown aria-hidden="true" className={cn('size-4 transition-transform', !open && '-rotate-90')} />
            </span>
          </button>
        </h3>
      ) : null}
      <div id={contentId} hidden={!open}>
        <TimelineList items={items} entryProps={entryProps} />
      </div>
    </section>
  )
}

const SKELETON_ROWS = [
  { key: 'first', sentence: 'w-2/3', detail: 'w-1/2' },
  { key: 'second', sentence: 'w-1/2', detail: null },
  { key: 'third', sentence: 'w-3/5', detail: 'w-1/3' },
]

function TimelineSkeleton({ label }: { label: string }) {
  return (
    <div data-slot="timeline-skeleton" className="flex flex-col">
      <span className="sr-only">{label}</span>
      {SKELETON_ROWS.map((row, index) => (
        <div key={row.key} className="relative flex gap-3 pb-6 last:pb-0">
          {index < SKELETON_ROWS.length - 1 ? (
            <span aria-hidden="true" className="absolute top-6 bottom-0 left-3 w-px bg-border" />
          ) : null}
          <Skeleton className="relative z-10 size-6 shrink-0" />
          <div className="flex min-w-0 max-w-xl flex-1 flex-col gap-3 py-1">
            <Skeleton className={cn('h-4', row.sentence)} />
            {row.detail ? <Skeleton className={cn('h-4', row.detail)} /> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

export function Timeline({
  items,
  groupBy,
  filters,
  activeFilterKey,
  hasMore,
  onItemAction,
  onFilterChange,
  onLoadMore,
  renderItemBody,
  header,
  status,
  errorMessage,
  onRetry,
  emptyState,
  className,
}: TimelineProps) {
  const t = useT()
  const locale = useLocale()
  const [loadingMore, setLoadingMore] = React.useState(false)

  const handleLoadMore = React.useCallback(async () => {
    if (!onLoadMore) return
    setLoadingMore(true)
    try {
      await onLoadMore()
    } catch {
      return
    } finally {
      setLoadingMore(false)
    }
  }, [onLoadMore])

  const entryProps: Omit<TimelineEntryProps, 'item'> = {
    locale,
    timeFormat: groupBy === 'day' ? 'clock' : 'relative',
    renderItemBody,
    onItemAction,
    t,
  }
  const isEmpty = status === 'empty' || ((status === undefined || status === 'ready') && items.length === 0)

  let content: React.ReactNode
  if (status === 'loading') {
    content = <TimelineSkeleton label={t('ui.blocks.timeline.loading', 'Loading activity')} />
  } else if (status === 'error') {
    content = (
      <ErrorMessage
        label={errorMessage ?? t('ui.blocks.timeline.error', 'Could not load activity')}
        className="max-w-xl rounded-md"
        action={
          onRetry ? (
            <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={onRetry}>
              {t('ui.blocks.timeline.retry', 'Try again')}
            </Button>
          ) : undefined
        }
      />
    )
  } else if (isEmpty) {
    content = emptyState ?? (
      <EmptyState
        size="sm"
        icon={<History aria-hidden="true" className="size-5" />}
        title={t('ui.blocks.timeline.empty', 'No activity yet')}
        description={t('ui.blocks.timeline.emptyDescription', 'Notes, calls, emails and field changes will show up here.')}
        className="items-start px-0 text-left"
      />
    )
  } else if (groupBy === 'day') {
    const groups = groupTimelineByDay(items, locale, new Date(), (key, fallback) => t(key, fallback))
    content = (
      <div className="flex flex-col gap-6">
        {groups.map((group, index) => (
          <section key={`${index}-${group.dayKey}`} data-slot="timeline-day-group" className="flex flex-col gap-3">
            {group.label ? (
              <h3 data-slot="timeline-day-label" className="text-xs text-muted-foreground">
                {group.label}
              </h3>
            ) : null}
            <TimelineList items={group.items} entryProps={entryProps} />
          </section>
        ))}
      </div>
    )
  } else if (groupBy === 'period') {
    const groups = groupTimelineByPeriod(items, locale, new Date(), (key, fallback) => t(key, fallback))
    content = (
      <div className="flex flex-col gap-6">
        {groups.map((group, index) => {
          const previousYear = index > 0 ? groups[index - 1].year : null
          const showYear = group.year !== null && group.year !== previousYear
          return (
            <React.Fragment key={`${index}-${group.periodKey}`}>
              {showYear ? (
                <h2 data-slot="timeline-year-label" className="text-base text-foreground">
                  {group.year}
                </h2>
              ) : null}
              <TimelinePeriodSection label={group.label} count={group.items.length} items={group.items} entryProps={entryProps} />
            </React.Fragment>
          )
        })}
      </div>
    )
  } else {
    content = <TimelineList items={items} entryProps={entryProps} />
  }

  const showMore = hasMore && onLoadMore && status !== 'loading' && status !== 'error' && !isEmpty

  return (
    <div data-slot="timeline" aria-busy={status === 'loading' ? true : undefined} className={cn('flex flex-col gap-4', className)}>
      {header}
      {filters && filters.length > 0 ? (
        <div
          role="group"
          aria-label={t('ui.blocks.timeline.filters', 'Filter activity')}
          className="flex flex-wrap items-center gap-2"
        >
          {filters.map((filter) => {
            const active = filter.key === activeFilterKey
            return (
              <Button
                key={filter.key}
                type="button"
                size="sm"
                variant={active ? 'secondary' : 'ghost'}
                aria-pressed={active}
                className="font-normal"
                onClick={() => onFilterChange?.(filter.key)}
              >
                {filter.label}
                {filter.count !== undefined ? (
                  <span className="text-muted-foreground">{filter.count}</span>
                ) : null}
              </Button>
            )
          })}
        </div>
      ) : null}
      {content}
      {showMore ? (
        <div data-slot="timeline-more" className="flex justify-start pl-9">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-sm:h-10"
            disabled={loadingMore}
            onClick={() => {
              void handleLoadMore()
            }}
          >
            {loadingMore ? <Spinner size="sm" /> : null}
            {t('ui.blocks.timeline.showMore', 'Show more')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
