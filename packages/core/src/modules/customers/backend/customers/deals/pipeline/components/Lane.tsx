"use client"

import * as React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import type { RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import type { FilterOptionTone } from '@open-mercato/shared/lib/query/advanced-filter'
import { DealCard, type DealCardData } from './DealCard'
import { LaneCurrencyBreakdown } from './LaneCurrencyBreakdown'
import { LaneResizeHandle } from './LaneResizeHandle'

export type LaneStage = {
  id: string
  label: string
  tone: FilterOptionTone | null
}

export type LaneAggregateProp = {
  count: number
  totalInBaseCurrency: number
  byCurrency: Array<{ currency: string; total: number; count: number }>
  baseCurrencyCode: string | null
  /** `true` when every currency in `byCurrency` was convertible to the base currency. */
  convertedAll: boolean
  /** Currencies present in `byCurrency` that lack an FX rate to base — excluded from totals. */
  missingRateCurrencies: string[]
}

type LaneProps = {
  stage: LaneStage
  deals: DealCardData[]
  /** Server-side aggregate for accurate counts/totals across all deals in this stage, not just loaded ones */
  aggregate?: LaneAggregateProp | null
  selectedDealIds: Set<string>
  buildMenuItems: (deal: DealCardData) => RowActionItem[]
  activeDragDealId?: string | null
  isLoadingMore?: boolean
  /** Pixel width override (when the user has resized the column). Falls back to the default class. */
  width?: number | null
  onToggleSelect: (dealId: string) => void
  onComposeActivity: (dealId: string, type: 'call' | 'email' | 'note') => void
  onOpenDetail: (dealId: string) => void
  onQuickAddClick: (stageId: string) => void
  onLoadMore?: (stageId: string) => void
  /** Drag-resize callbacks. When provided, a vertical drag handle is rendered on the lane edge. */
  onResize?: (stageId: string, deltaPx: number) => void
  onResizeEnd?: (stageId: string) => void
  onResetWidth?: (stageId: string) => void
}

// 4px color bar tone — uses saturated icon tokens so the bar is visibly colored, not pale
const ACCENT_TONE_CLASS: Record<FilterOptionTone, string> = {
  success: 'bg-status-success-icon',
  error: 'bg-status-error-icon',
  warning: 'bg-status-warning-icon',
  info: 'bg-status-info-icon',
  neutral: 'bg-status-neutral-icon',
  brand: 'bg-brand-violet',
  pink: 'bg-status-pink-icon',
}

// Count pill bg uses very-light status background, text uses status text color
const COUNT_BADGE_TONE_CLASS: Record<FilterOptionTone, string> = {
  success: 'bg-status-success-bg text-status-success-text',
  error: 'bg-status-error-bg text-status-error-text',
  warning: 'bg-status-warning-bg text-status-warning-text',
  info: 'bg-status-info-bg text-status-info-text',
  neutral: 'bg-status-neutral-bg text-status-neutral-text',
  brand: 'bg-brand-violet/14 text-brand-violet',
  pink: 'bg-status-pink-bg text-status-pink-text',
}

function getAccentClass(tone: FilterOptionTone | null): string {
  if (tone && tone in ACCENT_TONE_CLASS) return ACCENT_TONE_CLASS[tone]
  return 'bg-border'
}

function getCountBadgeClass(tone: FilterOptionTone | null): string {
  if (tone && tone in COUNT_BADGE_TONE_CLASS) return COUNT_BADGE_TONE_CLASS[tone]
  return 'bg-muted text-muted-foreground'
}

function compactCurrency(amount: number): string {
  if (amount >= 1_000_000) {
    const value = amount / 1_000_000
    return value >= 100 ? `${Math.round(value)}M` : `${value.toFixed(1).replace(/\.0$/, '')}M`
  }
  if (amount >= 1_000) {
    const value = amount / 1_000
    return value >= 100 ? `${Math.round(value)}k` : `${value.toFixed(1).replace(/\.0$/, '')}k`
  }
  return String(Math.round(amount))
}

type CurrencyRow = { currency: string; total: number; count: number }

type LaneStats = {
  count: number
  /** Headline amount and the currency it is denominated in (largest single currency, raw, never converted). */
  primaryAmount: number
  primaryCurrency: string | null
  /** Per-currency rows sorted desc by total — the popover renders these one per line. */
  rows: CurrencyRow[]
  /** Sum of `rows` converted to base currency (zero when no base is configured / nothing converted). */
  totalInBaseCurrency: number
  baseCurrencyCode: string | null
  convertedAll: boolean
  missingRateCurrencies: string[]
}

/**
 * Build display stats.
 * - If a server aggregate is provided, prefer it (covers all deals, converts to tenant base currency).
 * - Otherwise fall back to summing loaded deals (used before aggregate query loads).
 *
 * The headline currency on the lane header is intentionally the LARGEST raw currency
 * (not the base-currency converted total) because the converted total can be misleading
 * when FX rates are missing — operators see a smaller number than the headline suggests.
 * The base-currency converted total is reserved for the breakdown popover footer, where
 * a partial-conversion indicator can disclose what's excluded.
 */
function buildLaneStats(deals: DealCardData[], aggregate?: LaneAggregateProp | null): LaneStats {
  if (aggregate) {
    const rows = aggregate.byCurrency
    // Pick the single currency with the largest raw total to surface in the header. This
    // is always honest: the operator sees the actual largest cluster of value rather than
    // a synthetic base-currency total that may be partial.
    const headline = rows.length > 0 ? rows[0] : null
    return {
      count: aggregate.count,
      primaryAmount: headline ? headline.total : 0,
      primaryCurrency: headline ? headline.currency : null,
      rows,
      totalInBaseCurrency: aggregate.totalInBaseCurrency,
      baseCurrencyCode: aggregate.baseCurrencyCode,
      convertedAll: aggregate.convertedAll,
      missingRateCurrencies: aggregate.missingRateCurrencies,
    }
  }
  const totalsByCurrency = new Map<string, { total: number; count: number }>()
  for (const deal of deals) {
    if (typeof deal.valueAmount !== 'number' || !Number.isFinite(deal.valueAmount)) continue
    const code = deal.valueCurrency && deal.valueCurrency.length === 3
      ? deal.valueCurrency.toUpperCase()
      : 'USD'
    const entry = totalsByCurrency.get(code) ?? { total: 0, count: 0 }
    entry.total += deal.valueAmount
    entry.count += 1
    totalsByCurrency.set(code, entry)
  }
  const rows: CurrencyRow[] = Array.from(totalsByCurrency.entries())
    .map(([currency, value]) => ({ currency, total: value.total, count: value.count }))
    .sort((a, b) => b.total - a.total)
  if (rows.length === 0) {
    return {
      count: deals.length,
      primaryAmount: 0,
      primaryCurrency: null,
      rows,
      totalInBaseCurrency: 0,
      baseCurrencyCode: null,
      convertedAll: true,
      missingRateCurrencies: [],
    }
  }
  return {
    count: deals.length,
    primaryAmount: rows[0].total,
    primaryCurrency: rows[0].currency,
    rows,
    totalInBaseCurrency: 0,
    baseCurrencyCode: null,
    // We don't have rates client-side; mark as "not converted" only when there are
    // multiple currencies so the popover can show a "configure FX rates" hint.
    convertedAll: rows.length === 1,
    missingRateCurrencies: rows.length > 1 ? rows.slice(1).map((row) => row.currency) : [],
  }
}

function LaneImpl({
  stage,
  deals,
  aggregate,
  selectedDealIds,
  buildMenuItems,
  activeDragDealId,
  isLoadingMore = false,
  width,
  onToggleSelect,
  onComposeActivity,
  onOpenDetail,
  onQuickAddClick,
  onLoadMore,
  onResize,
  onResizeEnd,
  onResetWidth,
}: LaneProps): React.ReactElement {
  const t = useT()
  const { setNodeRef, isOver } = useDroppable({
    id: `lane:${stage.id}`,
    data: { type: 'lane', stageId: stage.id },
  })
  const isDragActive = !!activeDragDealId
  const sourceLane = isDragActive && deals.some((d) => d.id === activeDragDealId)
  // Highlight drop zone when:
  //  - the lane has the pointer over it during a drag, OR
  //  - any drag is active and this lane is not the source (so all candidate targets are clearly tagged)
  const showDropHighlight = isOver || (isDragActive && !sourceLane)
  const stats = React.useMemo(() => buildLaneStats(deals, aggregate), [deals, aggregate])
  const totalLabel = stats.primaryAmount > 0 && stats.primaryCurrency
    ? `${compactCurrency(stats.primaryAmount)} ${stats.primaryCurrency}`
    : null
  const visibleCount = deals.length
  const totalCount = stats.count
  const hasMoreDeals = totalCount > visibleCount
  const accentClass = getAccentClass(stage.tone)
  const countBadgeClass = getCountBadgeClass(stage.tone)

  const handleQuickAdd = React.useCallback(() => {
    onQuickAddClick(stage.id)
  }, [onQuickAddClick, stage.id])

  return (
    <div
      className="relative flex flex-none flex-col gap-[12px]"
      style={{ width: typeof width === 'number' && Number.isFinite(width) ? `${width}px` : '308px' }}
    >
      <div className="flex flex-col gap-[10px] overflow-clip rounded-[12px] bg-muted/40 px-[17px] py-[14px]">
        <div className={`h-[5px] w-full rounded-[3px] ${accentClass}`} aria-hidden="true" />
        <div className="flex items-center justify-between gap-[7px]">
          <div className="flex min-w-0 items-center gap-[10px]">
            <span className="truncate text-[13px] font-bold uppercase leading-[normal] text-foreground">
              {stage.label}
            </span>
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-[8px] py-[3px] text-[12px] font-bold leading-[normal] ${countBadgeClass}`}
              title={
                hasMoreDeals
                  ? translateWithFallback(
                      t,
                      'customers.deals.kanban.lane.aria.partialCount',
                      'Showing {visible} of {total}',
                      { visible: visibleCount, total: totalCount },
                    )
                  : undefined
              }
            >
              {totalCount}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-[7px]">
            {totalLabel ? (
              <span className="text-[14px] font-bold leading-[normal] text-foreground">
                {totalLabel}
              </span>
            ) : null}
            {stats.rows.length > 1 ? (
              <LaneCurrencyBreakdown
                rows={stats.rows}
                baseCurrencyCode={stats.baseCurrencyCode}
                totalInBaseCurrency={stats.totalInBaseCurrency}
                convertedAll={stats.convertedAll}
                missingRateCurrencies={stats.missingRateCurrencies}
                triggerLabel={`+${stats.rows.length - 1}`}
              />
            ) : null}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleQuickAdd}
        className="flex h-[44px] items-center justify-center gap-[10px] rounded-[12px] border border-dashed border-muted-foreground/60 bg-muted/40 text-[14px] font-semibold leading-[normal] text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={translateWithFallback(
          t,
          'customers.deals.kanban.lane.aria.quickAdd',
          'Quickly add a deal to {stage}',
          { stage: stage.label },
        )}
      >
        <span className="text-[17px] font-bold leading-none">+</span>
        <span>{translateWithFallback(t, 'customers.deals.kanban.cta.quickDeal', 'Quick deal')}</span>
      </button>

      <div
        ref={setNodeRef}
        className={`flex min-h-[40vh] flex-col gap-[12px] rounded-[12px] p-[5px] ${
          isOver
            ? 'bg-accent-indigo/10 outline-dashed outline-2 outline-accent-indigo -outline-offset-[2px]'
            : showDropHighlight
              ? 'bg-muted/40 outline-dashed outline-1 outline-muted-foreground/40 -outline-offset-[2px]'
              : ''
        }`}
      >
        {deals.length === 0 ? (
          <EmptyState
            size="sm"
            title={translateWithFallback(
              t,
              'customers.deals.kanban.lane.empty',
              'No deals in this stage yet.',
            )}
          />
        ) : (
          deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              selected={selectedDealIds.has(deal.id)}
              buildMenuItems={buildMenuItems}
              isActiveDrag={activeDragDealId === deal.id}
              onToggleSelect={onToggleSelect}
              onComposeActivity={onComposeActivity}
              onOpenDetail={onOpenDetail}
            />
          ))
        )}
        {hasMoreDeals && onLoadMore ? (
          <button
            type="button"
            onClick={() => onLoadMore(stage.id)}
            disabled={isLoadingMore}
            className="mt-[3px] inline-flex items-center justify-center gap-[7px] rounded-[10px] border border-dashed border-border bg-muted/30 px-[12px] py-[10px] text-[14px] font-semibold leading-[normal] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={translateWithFallback(
              t,
              'customers.deals.kanban.lane.aria.loadMore',
              'Load more deals in {stage}',
              { stage: stage.label },
            )}
          >
            {isLoadingMore
              ? translateWithFallback(t, 'customers.deals.kanban.lane.loadingMore', 'Loading…')
              : translateWithFallback(
                  t,
                  'customers.deals.kanban.lane.loadMore',
                  'Show more ({remaining})',
                  { remaining: totalCount - visibleCount },
                )}
          </button>
        ) : null}
      </div>
      {onResize ? (
        <LaneResizeHandle
          onResize={(delta) => onResize(stage.id, delta)}
          onResizeEnd={() => onResizeEnd?.(stage.id)}
          onReset={() => onResetWidth?.(stage.id)}
        />
      ) : null}
    </div>
  )
}

// Memoize the lane so changes in a different lane (or in the active drag) don't re-render us.
// Page passes booleans (isDragActive) instead of activeDragDealId so most lanes can skip re-rendering.
export const Lane = React.memo(LaneImpl, (prev, next) => {
  if (prev.stage !== next.stage) return false
  if (prev.deals !== next.deals) return false
  if (prev.aggregate !== next.aggregate) return false
  if (prev.selectedDealIds !== next.selectedDealIds) return false
  if (prev.buildMenuItems !== next.buildMenuItems) return false
  if (prev.activeDragDealId !== next.activeDragDealId) return false
  if (prev.isLoadingMore !== next.isLoadingMore) return false
  if (prev.width !== next.width) return false
  return true
})

export default Lane
