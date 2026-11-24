"use client"

import * as React from 'react'
import { Activity, Download, MoreHorizontal } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { cn } from '@open-mercato/shared/lib/utils'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import {
  ActivityFeed,
  ActivityFeedFileChip,
  ActivityFeedItem,
  ActivityFeedStatusChip,
} from '@open-mercato/ui/primitives/activity-feed'
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
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { BlockAction } from '../contracts/shared'
import type { TimelineItem, TimelineProps } from '../contracts/timeline'
import { groupTimelineByDay } from './grouping'

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

function TimelineAvatar({ item }: { item: TimelineItem }) {
  if (item.author) {
    return <Avatar size="sm" label={item.author.name} src={item.author.avatarSrc} />
  }
  const hasIcon = resolveRegisteredLucideIcon(item.icon) !== null
  return (
    <span
      data-slot="timeline-item-icon"
      className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground"
    >
      {hasIcon ? <BlockIcon name={item.icon} className="size-4" /> : <Activity aria-hidden="true" className="size-4" />}
    </span>
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
          size="sm"
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
  renderItemBody: TimelineProps['renderItemBody']
  onItemAction: TimelineProps['onItemAction']
  t: TranslateFn
}

function TimelineEntry({ item, locale, renderItemBody, onItemAction, t }: TimelineEntryProps) {
  const relative = formatRelativeTime(item.occurredAt, { locale })
  const full = formatFullDateTime(item.occurredAt, locale)
  const body = renderItemBody ? renderItemBody(item) : item.body
  const hasBody = body !== undefined && body !== null && body !== false
  const hasAttachments = Boolean(item.attachments?.length)
  const actions = item.actions ?? []

  return (
    <ActivityFeedItem
      data-timeline-item-id={item.id}
      avatar={<TimelineAvatar item={item} />}
      titleWeight="regular"
      title={
        <>
          {item.author ? (
            <span data-slot="timeline-item-author" className="text-foreground">
              {item.author.name}
            </span>
          ) : null}
          {item.author ? ' ' : null}
          <span
            data-slot="timeline-item-title"
            className={item.author ? 'text-muted-foreground' : 'text-foreground'}
          >
            {item.title}
          </span>
        </>
      }
      timestamp={
        <time dateTime={item.occurredAt} title={full}>
          {relative ?? full}
        </time>
      }
      actions={
        actions.length > 0 && onItemAction ? (
          <TimelineItemMenu item={item} actions={actions} onItemAction={onItemAction} t={t} />
        ) : undefined
      }
    >
      {hasBody ? <div className="w-full min-w-0 text-sm text-foreground">{body}</div> : null}
      {hasAttachments
        ? item.attachments?.map((attachment) => (
            <span
              key={`${attachment.name}-${attachment.href ?? ''}`}
              data-slot="timeline-attachment"
              className="inline-flex items-center gap-1"
            >
              <ActivityFeedFileChip name={attachment.name} size={attachment.format} />
              {isSafeDownloadHref(attachment.href) ? (
                <IconButton
                  asChild
                  variant="ghost"
                  size="sm"
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
          ))
        : null}
      {item.status ? (
        <ActivityFeedStatusChip status={item.status.tone}>{item.status.label}</ActivityFeedStatusChip>
      ) : null}
    </ActivityFeedItem>
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

  const entryProps = { locale, renderItemBody, onItemAction, t }
  const isEmpty = status === 'empty' || ((status === undefined || status === 'ready') && items.length === 0)

  let content: React.ReactNode
  if (status === 'loading') {
    content = <LoadingMessage label={t('ui.blocks.timeline.loading', 'Loading activity')} />
  } else if (status === 'error') {
    content = <ErrorMessage label={errorMessage ?? t('ui.blocks.timeline.error', 'Could not load activity')} />
  } else if (isEmpty) {
    content =
      emptyState ?? <EmptyState title={t('ui.blocks.timeline.empty', 'No activity yet')} />
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
            <ActivityFeed>
              {group.items.map((item) => (
                <TimelineEntry key={item.id} item={item} {...entryProps} />
              ))}
            </ActivityFeed>
          </section>
        ))}
      </div>
    )
  } else {
    content = (
      <ActivityFeed>
        {items.map((item) => (
          <TimelineEntry key={item.id} item={item} {...entryProps} />
        ))}
      </ActivityFeed>
    )
  }

  const showMore = hasMore && onLoadMore && status !== 'loading' && status !== 'error' && !isEmpty

  return (
    <div data-slot="timeline" className={cn('flex flex-col gap-4', className)}>
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
                size="2xs"
                variant={active ? 'secondary' : 'ghost'}
                aria-pressed={active}
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
        <div className="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
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
