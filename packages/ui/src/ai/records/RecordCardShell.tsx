"use client"

import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag, type TagVariant } from '../../primitives/tag'

export interface RecordCardShellProps {
  kindLabel: string
  kindIcon: React.ReactNode
  title: string
  subtitle?: React.ReactNode
  status?: { label: string; variant: TagVariant } | null
  href?: string
  id?: string
  leading?: React.ReactNode
  children?: React.ReactNode
  className?: string
  dataKind?: string
}

export function RecordCardShell({
  kindLabel,
  kindIcon,
  title,
  subtitle,
  status,
  href,
  id,
  leading,
  children,
  className,
  dataKind,
}: RecordCardShellProps) {
  const t = useT()
  return (
    <div
      data-ai-record-card={dataKind ?? kindLabel.toLowerCase()}
      data-record-id={id}
      className={cn(
        'group/record relative my-2 flex flex-col gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm transition-colors',
        href ? 'hover:border-primary/40 hover:bg-accent/40' : '',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {leading ? (
          <div className="shrink-0">{leading}</div>
        ) : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden>
            {kindIcon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {kindLabel}
            </span>
            {status ? (
              <Tag variant={status.variant} dot>
                {status.label}
              </Tag>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-start gap-2">
            <h4 className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug text-foreground">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="outline-none hover:underline focus-visible:underline"
                >
                  {title}
                </a>
              ) : (
                title
              )}
            </h4>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label={t('ai_assistant.chat.records.openRecord', 'Open record')}
              >
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
          {subtitle ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
      </div>
      {children ? <div className="text-xs text-foreground">{children}</div> : null}
    </div>
  )
}

export interface KeyValueListItem {
  label: string
  value: React.ReactNode
}

export function KeyValueList({ items }: { items: KeyValueListItem[] }) {
  if (items.length === 0) return null
  return (
    <dl className="grid grid-cols-[minmax(80px,auto)_1fr] gap-x-3 gap-y-1">
      {items.map((item, idx) => (
        <React.Fragment key={`${item.label}-${idx}`}>
          <dt className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
            {item.label}
          </dt>
          <dd className="min-w-0 truncate text-foreground">{item.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

export function TagRow({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag, idx) => (
        <Tag key={`${tag}-${idx}`} variant="brand">
          {tag}
        </Tag>
      ))}
    </div>
  )
}

export function statusToTagVariant(status: string | null | undefined): TagVariant {
  if (!status) return 'neutral'
  const s = String(status).toLowerCase().trim()
  if (
    s === 'won' ||
    s === 'win' ||
    s === 'active' ||
    s === 'completed' ||
    s === 'done' ||
    s === 'paid' ||
    s === 'success' ||
    s === 'closed_won' ||
    s === 'closed-won'
  )
    return 'success'
  if (
    s === 'lost' ||
    s === 'failed' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'overdue' ||
    s === 'closed_lost' ||
    s === 'closed-lost'
  )
    return 'error'
  if (s === 'pending' || s === 'in_progress' || s === 'in progress' || s === 'open' || s === 'qualified')
    return 'info'
  if (s === 'at_risk' || s === 'at risk' || s === 'review' || s === 'follow_up')
    return 'warning'
  if (s === 'draft' || s === 'archived' || s === 'inactive')
    return 'neutral'
  return 'info'
}
