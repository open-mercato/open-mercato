"use client"

import * as React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { AlertTriangle, Building2, Calendar, Clock, Mail, Phone, StickyNote } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import type { RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { DealCardMenu } from './DealCardMenu'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export type DealCardPipelineState = {
  openActivitiesCount: number
  daysInCurrentStage: number
  isStuck: boolean
  isOverdue: boolean
}

export type DealCardAssociation = {
  id: string
  label: string
}

export type DealCardOwner = {
  userId: string
  label: string
}

export type DealCardData = {
  id: string
  title: string
  status: string | null
  valueAmount: number | null
  valueCurrency: string | null
  probability: number | null
  expectedCloseAt: string | null
  createdAt: string | null
  /** ISO timestamp of last update — drives the "Updated (newest/oldest)" client-side sort fallback. */
  updatedAt: string | null
  owner: DealCardOwner | null
  primaryCompany: DealCardAssociation | null
  pipelineState: DealCardPipelineState
}

type DealCardProps = {
  deal: DealCardData
  selected: boolean
  /** Stable function called once per render to build the row-action items for this deal */
  buildMenuItems: (deal: DealCardData) => RowActionItem[]
  extraCompaniesCount?: number
  extraOwners?: DealCardOwner[]
  isActiveDrag?: boolean
  onToggleSelect: (dealId: string) => void
  onComposeActivity: (dealId: string, type: 'call' | 'email' | 'note') => void
  onOpenDetail: (dealId: string) => void
}

const ACTIVITY_BADGE_CAP = 9
const ACTIVITY_BADGE_WARNING_THRESHOLD = 9
const AVATAR_STACK_MAX = 3

// Hash-derived avatar accent colors mirroring Figma palette (cyan / violet / orange / slate / green / pink).
// Each tuple is the background colour + safe contrast text colour.
const AVATAR_PALETTE: Array<{ bg: string; text: string }> = [
  { bg: 'oklch(0.72 0.16 220)', text: '#ffffff' }, // cyan
  { bg: 'oklch(0.55 0.2 293)', text: '#ffffff' }, // violet
  { bg: 'oklch(0.74 0.18 60)', text: '#ffffff' }, // orange
  { bg: 'oklch(0.45 0.06 256)', text: '#ffffff' }, // slate
  { bg: 'oklch(0.68 0.18 145)', text: '#ffffff' }, // green
  { bg: 'oklch(0.66 0.21 0)', text: '#ffffff' }, // red/pink
]

function hashAccent(seed: string): { bg: string; text: string } {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0
  }
  const idx = Math.abs(h) % AVATAR_PALETTE.length
  return AVATAR_PALETTE[idx]
}

function splitCurrencyAmount(amount: number, currency: string | null): { display: string; code: string | null } {
  const code = currency && currency.length === 3 ? currency.toUpperCase() : null
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'decimal',
      maximumFractionDigits: 0,
      useGrouping: true,
    })
    return { display: formatter.format(amount), code }
  } catch {
    return { display: String(Math.round(amount)), code }
  }
}

function formatProbability(value: number | null): string | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  return `${Math.min(Math.max(Math.round(value), 0), 100)}%`
}

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: '2-digit',
})

function formatShortDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return shortDateFormatter.format(date)
}

function shortDealRef(id: string): string {
  return `DEAL-${id.slice(0, 6).toUpperCase()}`
}

function DealCardImpl({
  deal,
  selected,
  buildMenuItems,
  extraCompaniesCount = 0,
  extraOwners,
  isActiveDrag = false,
  onToggleSelect,
  onComposeActivity,
  onOpenDetail,
}: DealCardProps): React.ReactElement {
  const menuItems = React.useMemo(() => buildMenuItems(deal), [buildMenuItems, deal])
  const t = useT()
  // useDraggable is significantly cheaper than useSortable: dnd-kit doesn't recompute sibling
  // transforms during a drag. We don't reorder within a lane (sortBy controls order), so we just
  // need a draggable handle that drops into a Lane droppable.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    data: { type: 'deal' },
  })
  const dimmed = isActiveDrag || isDragging

  // Note: no transform CSS — the DragOverlay shows the moving copy, while the source card stays
  // visually in place (just dimmed). This removes per-frame transform recomputation.
  const style: React.CSSProperties = {}

  const activityCount = deal.pipelineState.openActivitiesCount
  const activityBadgeLabel =
    activityCount > 0
      ? activityCount > ACTIVITY_BADGE_CAP
        ? `${ACTIVITY_BADGE_CAP}+`
        : String(activityCount)
      : null
  const activityWarning = activityCount >= ACTIVITY_BADGE_WARNING_THRESHOLD

  const probabilityLabel = formatProbability(deal.probability)
  const dateLabel = formatShortDate(deal.expectedCloseAt ?? deal.createdAt)
  const stageDaysLabel = deal.pipelineState.isOverdue
    ? translateWithFallback(t, 'customers.deals.kanban.card.overdueLabel', 'Overdue')
    : translateWithFallback(t, 'customers.deals.kanban.card.daysInStage', 'in {days}d', {
        days: deal.pipelineState.daysInCurrentStage,
      })

  const showOverdue = deal.pipelineState.isOverdue
  const showStuck = !showOverdue && deal.pipelineState.isStuck

  const handleSelectChange = (next: boolean | 'indeterminate') => {
    if (typeof next === 'boolean' && next !== selected) {
      onToggleSelect(deal.id)
    }
  }

  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('[data-card-action="true"]')) return
    onOpenDetail(deal.id)
  }

  const handleActionClick = (type: 'call' | 'email' | 'note') => (event: React.MouseEvent) => {
    event.stopPropagation()
    onComposeActivity(deal.id, type)
  }

  // dnd-kit's `useDraggable` listeners set pointer capture on the card when a pointerdown lands
  // anywhere inside it. With capture active, the subsequent `click` event's `target` is the card
  // itself rather than the inner button/checkbox the user actually clicked — which made
  // `handleCardClick`'s `closest('[data-card-action="true"]')` check return null, so every click
  // inside Select / Call / Email / Note / kebab navigated to the deal detail instead of running
  // the intended handler.
  //
  // We stop propagation of `onPointerDown` at the `data-card-action="true"` boundary so dnd-kit's
  // listener never sees the pointerdown and never sets capture. React's `onClick` handlers on the
  // children then run normally with the right `event.target`.
  const stopPointerDown = React.useCallback((event: React.PointerEvent) => {
    event.stopPropagation()
  }, [])

  const ariaLabel = translateWithFallback(t, 'customers.deals.kanban.card.aria', 'Deal: {title}', {
    title: deal.title,
  })

  const valuePieces =
    deal.valueAmount !== null && Number.isFinite(deal.valueAmount)
      ? splitCurrencyAmount(deal.valueAmount, deal.valueCurrency)
      : null

  // Probability pill tone mirrors alert state per Figma (orange for stuck, red for overdue)
  const probabilityPillClass = showOverdue
    ? 'bg-status-error-bg text-status-error-text'
    : showStuck
      ? 'bg-status-warning-bg text-status-warning-text'
      : 'bg-muted text-muted-foreground'

  const activityBadgeClass = activityWarning
    ? 'bg-status-warning-bg text-status-warning-text'
    : 'bg-muted text-foreground'

  const ownersStack: DealCardOwner[] = React.useMemo(() => {
    if (!deal.owner) return extraOwners ?? []
    return [deal.owner, ...(extraOwners ?? [])]
  }, [deal.owner, extraOwners])

  const visibleOwners = ownersStack.slice(0, AVATAR_STACK_MAX)
  const ownerOverflow = ownersStack.length - visibleOwners.length

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="article"
      aria-label={ariaLabel}
      onClick={handleCardClick}
      className={`group relative flex w-full flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3.5 shadow-xs transition-shadow ${
        dimmed ? 'cursor-grabbing opacity-30' : 'cursor-grab hover:shadow-sm active:cursor-grabbing'
      } ${selected ? 'ring-2 ring-accent-indigo' : ''}`}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div
          data-card-action="true"
          className={`mr-0.5 mt-0.5 shrink-0 ${
            selected
              ? 'flex'
              : 'hidden group-hover:flex group-focus-within:flex [@media(hover:none)]:flex'
          }`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={stopPointerDown}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={handleSelectChange}
            aria-label={translateWithFallback(t, 'customers.deals.kanban.card.aria.select', 'Select deal')}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="line-clamp-2 text-base font-semibold leading-normal text-foreground">
            {deal.title}
          </h3>
          <span className="text-xs leading-normal text-muted-foreground">{shortDealRef(deal.id)}</span>
        </div>
        <div
          className="flex shrink-0 items-center gap-2"
          data-card-action="true"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={stopPointerDown}
        >
          {activityBadgeLabel ? (
            <span
              className={`inline-flex items-center justify-center rounded-full px-2 py-px text-xs font-bold leading-normal ${activityBadgeClass}`}
              aria-label={translateWithFallback(
                t,
                'customers.deals.kanban.card.aria.openActivities',
                '{count} open activities',
                { count: activityCount },
              )}
            >
              {activityBadgeLabel}
            </span>
          ) : null}
          <DealCardMenu
            items={menuItems}
            ariaLabel={translateWithFallback(
              t,
              'customers.deals.kanban.card.aria.menu',
              'Deal actions',
            )}
          />
        </div>
      </div>

      {showOverdue || showStuck ? (
        <div>
          {showOverdue ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-status-error-bg px-2.5 py-1 text-xs font-semibold leading-normal text-status-error-text">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {translateWithFallback(t, 'customers.deals.kanban.card.statusOverdue', 'OVERDUE')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-status-warning-bg px-2.5 py-1 text-xs font-semibold leading-normal text-status-warning-text">
              <Clock className="size-3.5" aria-hidden="true" />
              {translateWithFallback(t, 'customers.deals.kanban.card.statusStuck', 'STUCK')}
            </span>
          )}
        </div>
      ) : null}

      {/*
        Quick-log activity actions. `customers.activities` are scoped to a parent entity
        (person/company), so without a primary company on this deal the activity composer
        has nowhere to anchor a new record. The page-level handler previously flashed a
        toast and bailed silently, which was confusing — we surface the same constraint
        here as a disabled-with-tooltip state so the operator can fix the underlying data.
      */}
      <div
        data-card-action="true"
        className="hidden items-center gap-1 group-hover:flex group-focus-within:flex [@media(hover:none)]:flex"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={stopPointerDown}
      >
        {(() => {
          const disabled = !deal.primaryCompany
          const disabledTitle = disabled
            ? translateWithFallback(
                t,
                'customers.deals.kanban.card.action.disabledNoCompany',
                'Link a company to this deal before logging activities.',
              )
            : undefined
          const baseClass =
            'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          return (
            <>
              <button
                type="button"
                onClick={handleActionClick('call')}
                disabled={disabled}
                title={disabledTitle}
                aria-disabled={disabled || undefined}
                className={baseClass}
              >
                <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{translateWithFallback(t, 'customers.deals.kanban.card.action.call', 'Call')}</span>
              </button>
              <button
                type="button"
                onClick={handleActionClick('email')}
                disabled={disabled}
                title={disabledTitle}
                aria-disabled={disabled || undefined}
                className={baseClass}
              >
                <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{translateWithFallback(t, 'customers.deals.kanban.card.action.email', 'Email')}</span>
              </button>
              <button
                type="button"
                onClick={handleActionClick('note')}
                disabled={disabled}
                title={disabledTitle}
                aria-disabled={disabled || undefined}
                className={baseClass}
              >
                <StickyNote className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{translateWithFallback(t, 'customers.deals.kanban.card.action.note', 'Note')}</span>
              </button>
            </>
          )
        })()}
      </div>

      <div className="flex items-center justify-between gap-2.5">
        {valuePieces ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold leading-normal text-foreground">
              {valuePieces.display}
            </span>
            {valuePieces.code ? (
              <span className="text-sm font-semibold leading-normal text-muted-foreground">
                {valuePieces.code}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            {translateWithFallback(t, 'customers.deals.kanban.card.noValue', 'No value')}
          </span>
        )}
        {probabilityLabel ? (
          <span
            className={`inline-flex items-center rounded-md px-2.5 py-1 text-sm font-semibold leading-normal ${probabilityPillClass}`}
          >
            {probabilityLabel}
          </span>
        ) : null}
      </div>

      {deal.primaryCompany || extraCompaniesCount > 0 ? (
        <div className="flex items-center gap-1.5">
          {deal.primaryCompany ? (
            <span className="inline-flex max-w-full items-center gap-1.5 overflow-hidden rounded-md bg-muted px-2.5 py-1 text-sm font-semibold leading-normal text-foreground">
              <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{deal.primaryCompany.label}</span>
            </span>
          ) : null}
          {extraCompaniesCount > 0 ? (
            <span
              className="inline-flex shrink-0 items-center rounded-md bg-muted px-2.5 py-1 text-sm font-semibold leading-normal text-muted-foreground"
              aria-label={translateWithFallback(
                t,
                'customers.deals.kanban.card.aria.moreCompanies',
                '{count} more companies',
                { count: extraCompaniesCount },
              )}
            >
              +{extraCompaniesCount}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="h-px w-full bg-border" aria-hidden="true" />

      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 text-sm leading-normal">
          {dateLabel ? (
            <span className="inline-flex items-center gap-2">
              <Calendar
                className={`size-3.5 ${showOverdue ? 'text-status-error-icon' : 'text-muted-foreground'}`}
                aria-hidden="true"
              />
              <span
                className={
                  showOverdue
                    ? 'font-semibold text-status-error-text'
                    : 'font-semibold text-foreground'
                }
              >
                {dateLabel}
              </span>
            </span>
          ) : null}
          <span
            className={
              showOverdue
                ? 'font-semibold text-status-error-text'
                : 'font-normal text-muted-foreground'
            }
          >
            {stageDaysLabel}
          </span>
        </div>
        {ownersStack.length > 0 ? (
          <div className="flex items-center">
            {visibleOwners.map((owner, idx) => {
              const accent = hashAccent(owner.userId)
              return (
                <Avatar
                  key={`${owner.userId}-${idx}`}
                  label={owner.label || owner.userId.slice(0, 2).toUpperCase()}
                  size="sm"
                  style={{ backgroundColor: accent.bg, color: accent.text }}
                  className={`size-7 text-xs font-bold ring-2 ring-card ${idx > 0 ? '-ml-2.5' : ''}`}
                />
              )
            })}
            {ownerOverflow > 0 ? (
              <Avatar
                label={`+${ownerOverflow}`}
                size="sm"
                variant="monochrome"
                className="size-7 -ml-2.5 text-xs font-bold ring-2 ring-card"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// Memoize so cards in lanes far from the drag don't re-render on drag-state changes.
// Custom equality keeps the comparison cheap (we only re-render when something visible changes).
export const DealCard = React.memo(DealCardImpl, (prev, next) => {
  if (prev.deal !== next.deal) return false
  if (prev.selected !== next.selected) return false
  if (prev.isActiveDrag !== next.isActiveDrag) return false
  if (prev.buildMenuItems !== next.buildMenuItems) return false
  if (prev.extraCompaniesCount !== next.extraCompaniesCount) return false
  if (prev.extraOwners !== next.extraOwners) return false
  // Callback identity changes do NOT trigger re-renders — they're stable handlers from the page
  return true
})

export default DealCard
