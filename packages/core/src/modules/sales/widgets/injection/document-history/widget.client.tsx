"use client"

import * as React from "react"
import { Spinner } from "@open-mercato/ui/primitives/spinner"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall"
import { formatRelativeTime, formatDateTime } from "@open-mercato/shared/lib/time"
import { cn } from "@open-mercato/shared/lib/utils"
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { ArrowRightLeft, Zap, MessageSquare, User, Filter, ChevronDown, Check } from 'lucide-react'

export type TimelineEntry = {
  id: string
  occurredAt: string
  kind: "status" | "action" | "comment"
  action: string
  actor: { id: string | null; label: string }
  source: "action_log" | "note"
  metadata?: {
    statusFrom?: string | null
    statusTo?: string | null
    documentKind?: "order" | "quote"
    commandId?: string
  }
}

type StatusOption = {
  value: string
  label: string
  color: string | null
  icon: string | null
}

type TimelineContext = {
  kind: "order" | "quote"
  record: { id: string }
}

const isValidContext = (ctx: unknown): ctx is TimelineContext =>
  ctx !== null &&
  typeof ctx === 'object' &&
  'kind' in ctx &&
  'record' in ctx &&
  ((ctx as TimelineContext).kind === 'order' || (ctx as TimelineContext).kind === 'quote') &&
  typeof (ctx as TimelineContext).record === 'object' &&
  (ctx as TimelineContext).record !== null &&
  'id' in (ctx as TimelineContext).record &&
  typeof (ctx as TimelineContext).record.id === 'string'

const KIND_ICONS = {
  status: ArrowRightLeft,
  action: Zap,
  comment: MessageSquare,
}

const KIND_ICON_COLORS = {
  status: 'text-foreground',
  action: 'text-foreground',
  comment: 'text-foreground',
}

const KIND_BG_COLORS = {
  status: 'bg-muted',
  action: 'bg-muted',
  comment: 'bg-muted',
}

function StatusDot({ color, className }: { color: string | null | undefined; className?: string }) {
  if (!color) return <span className={cn('h-2.5 w-2.5 rounded-full bg-muted-foreground/40 border border-border inline-flex', className)} />
  return (
    <span
      className={cn('h-2.5 w-2.5 rounded-full border border-border/60 inline-flex', className)}
      style={{ backgroundColor: color }}
      aria-hidden
    />
  )
}

function StatusTransition({
  statusFrom,
  statusTo,
  statusMap,
}: {
  statusFrom: string | null | undefined
  statusTo: string | null | undefined
  statusMap: Record<string, StatusOption>
}) {
  const from = statusFrom ? (statusMap[statusFrom] ?? { value: statusFrom, label: statusFrom, color: null, icon: null }) : null
  const to = statusTo ? (statusMap[statusTo] ?? { value: statusTo, label: statusTo, color: null, icon: null }) : null

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {from ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <StatusDot color={from.color} />
          <span>{from.label}</span>
        </span>
      ) : null}
      {from && to ? (
        <ArrowRightLeft className="h-3 w-3 text-muted-foreground/60 shrink-0" />
      ) : null}
      {to ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
          <StatusDot color={to.color} />
          <span>{to.label}</span>
        </span>
      ) : null}
    </div>
  )
}

function TimelineItem({
  entry,
  statusMap,
  isLast,
}: {
  entry: TimelineEntry
  statusMap: Record<string, StatusOption>
  isLast: boolean
}) {
  const KindIcon = KIND_ICONS[entry.kind]
  const relativeTime = formatRelativeTime(entry.occurredAt)
  const absoluteTime = formatDateTime(entry.occurredAt)

  const isStatusChange = entry.kind === 'status' && entry.metadata?.statusTo

  return (
    <div data-testid="timeline-entry" className="relative flex gap-3">
      {/* Vertical connector line */}
      {!isLast && (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" aria-hidden />
      )}

      {/* Icon circle */}
      <div
        className={cn(
          'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border',
          KIND_BG_COLORS[entry.kind],
        )}
      >
        <KindIcon className={cn('h-3 w-3', KIND_ICON_COLORS[entry.kind])} aria-hidden />
      </div>

      {/* Content card */}
      <div className="flex-1 pb-4">
        <div className="group rounded-lg border bg-card p-3 space-y-1.5">
          {/* Header: actor + time */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
              <User className="h-3 w-3 text-muted-foreground" aria-hidden />
              {entry.actor.label}
            </span>
            <span
              className="text-xs text-muted-foreground"
              title={absoluteTime ?? undefined}
            >
              {relativeTime ?? absoluteTime}
            </span>
          </div>

          {/* Body */}
          {isStatusChange ? (
            <StatusTransition
              statusFrom={entry.metadata?.statusFrom}
              statusTo={entry.metadata?.statusTo}
              statusMap={statusMap}
            />
          ) : (
            <div className="text-sm text-foreground">{entry.action}</div>
          )}
        </div>
      </div>
    </div>
  )
}

type FilterKind = 'all' | 'status' | 'action' | 'comment'

type FilterOption = { value: FilterKind; label: string }

function FilterDropdown({ filter, onChange }: { filter: FilterKind; onChange: (kind: FilterKind) => void }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const options: FilterOption[] = [
    { value: 'all', label: t('sales.documents.history.filter.all', 'All') },
    { value: 'status', label: t('sales.documents.history.filter.status', 'Status changes') },
    { value: 'action', label: t('sales.documents.history.filter.actions', 'Actions') },
    { value: 'comment', label: t('sales.documents.history.filter.comments', 'Comments') },
  ]

  const activeLabel = options.find(o => o.value === filter)?.label

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors select-none"
      >
        <Filter className="h-3 w-3" aria-hidden />
        {t('sales.documents.history.filter.label', 'Filters')}
        {filter !== 'all' && (
          <span className="text-muted-foreground">: {activeLabel}</span>
        )}
        <ChevronDown className={cn('h-3 w-3 transition-transform duration-150', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t('sales.documents.history.filter.label', 'Filters')}
          className="absolute left-0 top-full mt-1 z-50 w-48 rounded-md border bg-background p-1 shadow-md"
        >
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={filter === opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Check className={cn('h-3.5 w-3.5 shrink-0', filter === opt.value ? 'opacity-100' : 'opacity-0')} aria-hidden />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export const DocumentHistoryWidget: React.FC<InjectionWidgetComponentProps<unknown, unknown>> = ({ context }) => {
  const t = useT()
  const [entries, setEntries] = React.useState<TimelineEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [statusMap, setStatusMap] = React.useState<Record<string, StatusOption>>({})
  const [filter, setFilter] = React.useState<FilterKind>('all')

  React.useEffect(() => {
    apiCall<{ items?: unknown[] }>('/api/sales/order-statuses?pageSize=100')
      .then((res) => {
        if (res.ok && Array.isArray(res.result?.items)) {
          const map: Record<string, StatusOption> = {}
          for (const item of res.result.items) {
            if (!item || typeof item !== 'object') continue
            const d = item as Record<string, unknown>
            const value = typeof d.value === 'string' ? d.value : null
            if (!value) continue
            map[value] = {
              value,
              label: typeof d.label === 'string' && d.label.length ? d.label : value,
              color: typeof d.color === 'string' && d.color.length ? d.color : null,
              icon: typeof d.icon === 'string' && d.icon.length ? d.icon : null,
            }
          }
          setStatusMap(map)
        }
      })
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    if (!isValidContext(context)) {
      setLoading(false)
      setError(t("sales.documents.history.error", "Failed to load history."))
      return
    }

    setLoading(true)
    setError(null)
    apiCall<{ items: TimelineEntry[] }>(
      `/api/sales/document-history?kind=${context.kind}&id=${context.record.id}`
    )
      .then((res) => {
        if (res.ok && Array.isArray(res.result?.items)) {
          setEntries(res.result.items)
        } else {
          setError(t("sales.documents.history.error", "Failed to load history."))
        }
      })
      .catch(() => setError(t("sales.documents.history.error", "Failed to load history.")))
      .finally(() => setLoading(false))
  }, [context, t])

  const filtered = React.useMemo(
    () => filter === 'all' ? entries : entries.filter(e => e.kind === filter),
    [entries, filter]
  )

  return (
    <div className="space-y-4">
      {/* Filter dropdown */}
      <div>
        <FilterDropdown filter={filter} onChange={setFilter} />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-24">
          <Spinner />
        </div>
      ) : error ? (
        <div className="text-destructive text-sm">{error}</div>
      ) : !filtered.length ? (
        <div className="text-muted-foreground text-sm py-6 text-center">
          {t("sales.documents.history.empty", "No history entries yet.")}
        </div>
      ) : (
        <div className="relative">
          {filtered.map((entry, index) => (
            <TimelineItem
              key={entry.id}
              entry={entry}
              statusMap={statusMap}
              isLast={index === filtered.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default DocumentHistoryWidget
