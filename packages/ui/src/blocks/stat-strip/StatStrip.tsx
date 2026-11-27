"use client"

import * as React from 'react'
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, ChartNoAxesColumn, Minus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import type { BlockTone } from '../contracts/shared'
import {
  isStatItemInteractive,
  type StatDelta,
  type StatDeltaDirection,
  type StatDeltaSentiment,
  type StatItem,
  type StatItemAction,
  type StatStripColumns,
  type StatStripProps,
  type StatStripSize,
  type StatStripVariant,
} from '../contracts/stat-strip'

type ColumnCount = 1 | 2 | 3 | 4 | 5 | 6
type SpanCount = 1 | 2 | 3 | 4 | 5 | 6

const DEFAULT_SKELETON_COUNT = 4
const MAX_AUTO_COLUMNS = 6
const TREND_WIDTH = 64
const TREND_HEIGHT = 24
const TREND_INSET = 3

const COLUMN_CLASS: Record<ColumnCount, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 @3xs:grid-cols-2',
  3: 'grid-cols-1 @3xs:grid-cols-2 @xl:grid-cols-3',
  4: 'grid-cols-1 @3xs:grid-cols-2 @3xl:grid-cols-4',
  5: 'grid-cols-1 @3xs:grid-cols-2 @xl:grid-cols-3 @5xl:grid-cols-5',
  6: 'grid-cols-1 @3xs:grid-cols-2 @xl:grid-cols-3 @6xl:grid-cols-6',
}

const PAIR_SPAN_CLASS: Partial<Record<SpanCount, string>> = {
  1: '',
  2: '@3xs:col-span-2',
}

const TRIPLE_SPAN_CLASS: Partial<Record<SpanCount, string>> = {
  1: '@xl:col-span-1',
  2: '@xl:col-span-2',
  3: '@xl:col-span-3',
}

const WIDE_SPAN_CLASS: Record<4 | 5 | 6, Partial<Record<SpanCount, string>>> = {
  4: { 1: '@3xl:col-span-1', 2: '@3xl:col-span-2', 3: '@3xl:col-span-3', 4: '@3xl:col-span-4' },
  5: {
    1: '@5xl:col-span-1',
    2: '@5xl:col-span-2',
    3: '@5xl:col-span-3',
    4: '@5xl:col-span-4',
    5: '@5xl:col-span-5',
  },
  6: {
    1: '@6xl:col-span-1',
    2: '@6xl:col-span-2',
    3: '@6xl:col-span-3',
    4: '@6xl:col-span-4',
    5: '@6xl:col-span-5',
    6: '@6xl:col-span-6',
  },
}

const ROOT_CLASS: Record<StatStripVariant, string> = {
  card: '@container w-full overflow-hidden rounded-card border border-border bg-card text-card-foreground',
  plain: '@container w-full',
}

const GRID_CLASS: Record<StatStripVariant, string> = {
  card: '-mb-px -mr-px grid',
  plain: 'grid gap-x-6 gap-y-4',
}

const CELL_CLASS: Record<StatStripVariant, string> = {
  card: 'flex min-w-0 border-b border-r border-border',
  plain: 'flex min-w-0',
}

const STATIC_PADDING_CLASS: Record<StatStripVariant, Record<StatStripSize, string>> = {
  card: { default: 'p-4', compact: 'p-3' },
  plain: { default: '', compact: '' },
}

const CONTROL_PADDING_CLASS: Record<StatStripVariant, Record<StatStripSize, string>> = {
  card: { default: 'p-4', compact: 'p-3' },
  plain: { default: '-m-2 rounded-md p-2', compact: '-m-2 rounded-md p-2' },
}

const FOCUS_RING_CLASS: Record<StatStripVariant, string> = {
  card: 'inset-1',
  plain: 'inset-0',
}

const SELECTED_BAR_CLASS: Record<StatStripVariant, string> = {
  card: 'inset-y-0 left-0 w-0.5 @3xs:inset-x-0 @3xs:top-auto @3xs:bottom-0 @3xs:h-0.5 @3xs:w-auto',
  plain: 'inset-x-2 bottom-0 h-0.5 rounded-full',
}

const VALUE_SIZE_CLASS: Record<StatStripSize, string> = {
  default: 'text-xl leading-7 @sm:text-2xl @sm:leading-8 @4xl:text-3xl @4xl:leading-9',
  compact: 'text-xl leading-7',
}

const SKELETON_VALUE_ROW_CLASS: Record<StatStripSize, string> = {
  default: 'h-7 @sm:h-8 @4xl:h-9',
  compact: 'h-7',
}

const ICON_TONE_CLASS: Record<BlockTone, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-status-info-icon',
  success: 'text-status-success-icon',
  warning: 'text-status-warning-icon',
  error: 'text-status-error-icon',
}

const DOT_TONE_CLASS: Record<BlockTone, string | null> = {
  neutral: null,
  info: 'bg-status-info-icon',
  success: 'bg-status-success-icon',
  warning: 'bg-status-warning-icon',
  error: 'bg-status-error-icon',
}

const CHIP_CLASS: Record<StatDeltaSentiment, string> = {
  positive: 'bg-status-success-bg text-status-success-text',
  negative: 'bg-status-error-bg text-status-error-text',
  neutral: 'bg-muted text-muted-foreground',
}

const CHIP_ICON_CLASS: Record<StatDeltaSentiment, string> = {
  positive: 'text-status-success-icon',
  negative: 'text-status-error-icon',
  neutral: 'text-muted-foreground',
}

const TREND_CLASS: Record<StatDeltaSentiment, string> = {
  positive: 'text-status-success-icon',
  negative: 'text-status-error-icon',
  neutral: 'text-muted-foreground',
}

const DELTA_ICON: Record<StatDeltaDirection, typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
}

const SKELETON_VALUE_WIDTHS = ['w-20', 'w-16', 'w-24', 'w-14']

const logger = createLogger('ui')
const reportedUnknownIcons = new Set<string>()

function resolveIcon(name: string | undefined) {
  const Icon = resolveRegisteredLucideIcon(name)
  if (Icon || !name || process.env.NODE_ENV === 'production' || reportedUnknownIcons.has(name)) return Icon
  reportedUnknownIcons.add(name)
  logger.warn('[internal] StatStrip received an icon name that is not in the icon registry', { icon: name })
  return Icon
}

function isPlainLeftClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function resolveColumnCount(columns: StatStripColumns, tileCount: number): ColumnCount {
  if (columns !== 'auto') return columns
  if (tileCount <= 1) return 1
  const fitted = tileCount <= MAX_AUTO_COLUMNS ? tileCount : Math.min(MAX_AUTO_COLUMNS, Math.ceil(tileCount / 2))
  return fitted as ColumnCount
}

function trailingSpan(columns: number, tileCount: number): SpanCount {
  const remainder = tileCount % columns
  return (remainder === 0 ? 1 : columns - remainder + 1) as SpanCount
}

function lastCellSpanClassName(columnCount: ColumnCount, tileCount: number): string {
  if (columnCount === 1) return ''
  const pair = PAIR_SPAN_CLASS[trailingSpan(2, tileCount)]
  if (columnCount === 2) return pair ?? ''
  const triple = TRIPLE_SPAN_CLASS[trailingSpan(3, tileCount)]
  if (columnCount === 3) return cn(pair, triple)
  const wide = WIDE_SPAN_CLASS[columnCount][trailingSpan(columnCount, tileCount)]
  if (columnCount === 4) return cn(pair, wide)
  return cn(pair, triple, wide)
}

function cellClassName(variant: StatStripVariant, columnCount: ColumnCount, tileCount: number, index: number) {
  return cn(CELL_CLASS[variant], index === tileCount - 1 && lastCellSpanClassName(columnCount, tileCount))
}

type TrendPoint = { x: number; y: number }

function buildTrendPoints(trend: number[]): TrendPoint[] {
  const low = Math.min(...trend)
  const high = Math.max(...trend)
  const range = high - low
  const step = (TREND_WIDTH - TREND_INSET * 2) / (trend.length - 1)
  const drawable = TREND_HEIGHT - TREND_INSET * 2
  return trend.map((point, index) => ({
    x: Number((TREND_INSET + index * step).toFixed(2)),
    y: Number((range === 0 ? TREND_HEIGHT / 2 : TREND_HEIGHT - TREND_INSET - ((point - low) / range) * drawable).toFixed(2)),
  }))
}

type TrendProps = { trend: number[]; sentiment: StatDeltaSentiment }

function StatTrendLine({ trend, sentiment }: TrendProps) {
  const points = buildTrendPoints(trend)
  const last = points[points.length - 1]
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `${points[0].x},${TREND_HEIGHT} ${line} ${last.x},${TREND_HEIGHT}`
  return (
    <span
      data-slot="stat-strip-trend"
      data-sentiment={sentiment}
      aria-hidden="true"
      className={cn('hidden h-6 min-w-0 flex-1 flex-wrap content-start justify-end overflow-hidden @sm:flex', TREND_CLASS[sentiment])}
    >
      <span className="h-6 w-3 shrink-0" />
      <svg
        width={TREND_WIDTH}
        height={TREND_HEIGHT}
        viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`}
        fill="none"
        focusable="false"
        className="h-6 w-16 shrink-0"
      >
        <polygon points={area} fill="currentColor" fillOpacity={0.1} />
        <polyline points={line} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last.x} cy={last.y} r={2} fill="currentColor" />
      </svg>
    </span>
  )
}

type DeltaProps = { delta: StatDelta }

function StatDeltaChip({ delta }: DeltaProps) {
  const t = useT()
  const sentiment = delta.sentiment ?? 'neutral'
  const Icon = DELTA_ICON[delta.direction]
  const phrases: Record<StatDeltaDirection, string> = {
    up: t('ui.blocks.statStrip.deltaUp', 'up {label}', { label: delta.label }),
    down: t('ui.blocks.statStrip.deltaDown', 'down {label}', { label: delta.label }),
    flat: t('ui.blocks.statStrip.deltaFlat', 'no change, {label}', { label: delta.label }),
  }
  return (
    <span
      data-slot="stat-strip-delta"
      data-direction={delta.direction}
      data-sentiment={sentiment}
      className={cn(
        'inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-sm px-1 text-sm leading-5 tabular-nums',
        CHIP_CLASS[sentiment],
      )}
    >
      <Icon aria-hidden="true" className={cn('size-3 shrink-0', CHIP_ICON_CLASS[sentiment])} />
      <span aria-hidden="true" className="truncate">
        {delta.label}
      </span>
      <span className="sr-only">{phrases[delta.direction]}</span>
    </span>
  )
}

type ActionProps = {
  itemId: string
  action: StatItemAction
  onItemAction: ((itemId: string) => void) | undefined
}

function StatTileAction({ itemId, action, onItemAction }: ActionProps) {
  const className =
    'group/action -mx-1 -mb-2 mt-auto inline-flex h-10 max-w-full px-1 cursor-pointer items-center gap-1 self-start rounded-sm text-sm leading-5 text-foreground underline-offset-4 outline-none hover:underline focus-visible:shadow-focus sm:h-8'
  const content = (
    <>
      <span className="truncate">{action.label}</span>
      <ArrowRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/action:translate-x-1"
      />
    </>
  )
  if (action.href !== undefined) {
    return (
      <a
        href={action.href}
        data-slot="stat-strip-action"
        className={className}
        onClick={(event) => {
          if (!onItemAction || !isPlainLeftClick(event)) return
          event.preventDefault()
          onItemAction(itemId)
        }}
      >
        {content}
      </a>
    )
  }
  return (
    <button type="button" data-slot="stat-strip-action" className={className} onClick={() => onItemAction?.(itemId)}>
      {content}
    </button>
  )
}

type TileContentProps = {
  item: StatItem
  size: StatStripSize
  selected: boolean
  cue: boolean
  action: React.ReactNode
}

function StatTileContent({ item, size, selected, cue, action }: TileContentProps) {
  const tone = item.tone ?? 'neutral'
  const Icon = resolveIcon(item.icon)
  const dotClass = Icon ? null : DOT_TONE_CLASS[tone]
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
      <span
        data-slot="stat-strip-label"
        className={cn('flex max-w-full items-start gap-2 text-sm leading-5', selected ? 'text-foreground' : 'text-muted-foreground')}
      >
        {Icon ? (
          <span className="flex h-5 shrink-0 items-center">
            <Icon aria-hidden="true" className={cn('size-4', ICON_TONE_CLASS[tone])} />
          </span>
        ) : null}
        {dotClass ? (
          <span className="flex h-5 shrink-0 items-center">
            <span data-slot="stat-strip-tone" data-tone={tone} aria-hidden="true" className={cn('size-2 rounded-full', dotClass)} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 break-words">{item.label}</span>
        {cue ? (
          <span className="flex h-5 shrink-0 items-center">
            <ArrowUpRight
              data-slot="stat-strip-cue"
              aria-hidden="true"
              className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100"
            />
          </span>
        ) : null}
      </span>
      <span className="flex max-w-full items-center">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            data-slot="stat-strip-value"
            className={cn('min-w-0 break-words tabular-nums text-foreground', VALUE_SIZE_CLASS[size])}
          >
            {item.value}
          </span>
          {item.badge ? (
            <span data-slot="stat-strip-badge" className="inline-flex shrink-0">
              <StatusBadge variant={item.badge.tone}>{item.badge.label}</StatusBadge>
            </span>
          ) : null}
        </span>
        {item.trend ? <StatTrendLine trend={item.trend} sentiment={item.delta?.sentiment ?? 'neutral'} /> : null}
      </span>
      {item.delta || item.caption ? (
        <span className="mt-1 flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-5 text-muted-foreground">
          {item.delta ? <StatDeltaChip delta={item.delta} /> : null}
          {item.caption ? (
            <span data-slot="stat-strip-caption" className="min-w-0 break-words">
              {item.caption}
            </span>
          ) : null}
        </span>
      ) : null}
      {action}
    </span>
  )
}

type TileProps = {
  item: StatItem
  variant: StatStripVariant
  size: StatStripSize
  selected: boolean
  onItemClick: ((itemId: string) => void) | undefined
  onItemAction: ((itemId: string) => void) | undefined
}

function StatTile({ item, variant, size, selected, onItemClick, onItemAction }: TileProps) {
  const disabled = item.disabled === true
  const interactive = isStatItemInteractive(item, onItemClick !== undefined)
  const tone = item.tone ?? 'neutral'

  if (!interactive || (disabled && item.href !== undefined)) {
    return (
      <div
        data-slot="stat-strip-tile"
        data-item-id={item.id}
        data-tone={tone}
        aria-disabled={disabled ? 'true' : undefined}
        className={cn(
          'flex min-w-0 flex-1',
          STATIC_PADDING_CLASS[variant][size],
          disabled && 'opacity-60',
        )}
      >
        <StatTileContent
          item={item}
          size={size}
          selected={false}
          cue={false}
          action={
            item.action && !disabled ? (
              <StatTileAction itemId={item.id} action={item.action} onItemAction={onItemAction} />
            ) : null
          }
        />
      </div>
    )
  }

  const controlClassName = cn(
    'group/tile relative flex min-w-0 flex-1 cursor-pointer outline-none transition-colors',
    CONTROL_PADDING_CLASS[variant][size],
    selected && 'bg-accent-indigo/10',
    !selected && 'hover:bg-muted/60',
  )
  const content = (
    <>
      <StatTileContent item={item} size={size} selected={selected} cue action={null} />
      {selected ? (
        <span
          data-slot="stat-strip-selected-bar"
          aria-hidden="true"
          className={cn('pointer-events-none absolute bg-accent-indigo', SELECTED_BAR_CLASS[variant])}
        />
      ) : null}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute rounded-md group-focus-visible/tile:shadow-focus',
          FOCUS_RING_CLASS[variant],
        )}
      />
    </>
  )

  if (item.href !== undefined) {
    return (
      <a
        href={item.href}
        data-slot="stat-strip-tile"
        data-item-id={item.id}
        data-tone={tone}
        data-interactive="true"
        data-selected={selected ? 'true' : undefined}
        aria-current={selected ? 'true' : undefined}
        className={controlClassName}
        onClick={(event) => {
          if (!onItemClick || !isPlainLeftClick(event)) return
          event.preventDefault()
          onItemClick(item.id)
        }}
      >
        {content}
      </a>
    )
  }

  return (
    <button
      type="button"
      data-slot="stat-strip-tile"
      data-item-id={item.id}
      data-tone={tone}
      data-interactive="true"
      data-selected={selected ? 'true' : undefined}
      aria-pressed={selected}
      disabled={disabled}
      className={cn(controlClassName, 'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent')}
      onClick={() => onItemClick?.(item.id)}
    >
      {content}
    </button>
  )
}

type SkeletonProps = {
  label: string
  tileCount: number
  columns: StatStripColumns
  variant: StatStripVariant
  size: StatStripSize
  className: string | undefined
}

function StatStripSkeleton({ label, tileCount, columns, variant, size, className }: SkeletonProps) {
  const columnCount = resolveColumnCount(columns, tileCount)
  return (
    <div data-slot="stat-strip" data-variant={variant} aria-busy="true" className={cn(ROOT_CLASS[variant], className)}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={cn(GRID_CLASS[variant], COLUMN_CLASS[columnCount])}>
        {Array.from({ length: tileCount }, (_, index) => (
          <div
            key={index}
            data-slot="stat-strip-skeleton-tile"
            className={cellClassName(variant, columnCount, tileCount, index)}
          >
            <div className={cn('flex min-w-0 flex-1 flex-col gap-1', STATIC_PADDING_CLASS[variant][size])}>
              <span className="flex h-5 items-center">
                <Skeleton className="h-4 w-24" />
              </span>
              <span className={cn('flex items-center', SKELETON_VALUE_ROW_CLASS[size])}>
                <Skeleton
                  className={cn(size === 'compact' ? 'h-5' : 'h-6', SKELETON_VALUE_WIDTHS[index % SKELETON_VALUE_WIDTHS.length])}
                />
              </span>
              <span className="mt-1 flex h-5 items-center gap-2">
                <Skeleton className="h-5 w-12 rounded-sm" />
                <Skeleton className="h-4 w-20" />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function StatStrip(props: StatStripProps) {
  const t = useT()
  const {
    items,
    onItemClick,
    onItemAction,
    selectedId,
    columns = 'auto',
    variant = 'card',
    size = 'default',
    ariaLabel,
    skeletonCount,
    status,
    errorMessage,
    onRetry,
    emptyState,
    className,
  } = props

  if (status === 'loading') {
    return (
      <StatStripSkeleton
        label={t('ui.blocks.statStrip.loading', 'Loading')}
        tileCount={skeletonCount ?? (items.length > 0 ? items.length : DEFAULT_SKELETON_COUNT)}
        columns={columns}
        variant={variant}
        size={size}
        className={className}
      />
    )
  }

  if (status === 'error') {
    return (
      <ErrorMessage
        label={errorMessage ?? t('ui.blocks.statStrip.error', 'Could not load the figures')}
        className={cn('max-w-xl rounded-md', className)}
        action={
          onRetry ? (
            <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={onRetry}>
              {t('ui.blocks.statStrip.retry', 'Try again')}
            </Button>
          ) : undefined
        }
      />
    )
  }

  if (status === 'empty' || items.length === 0) {
    if (emptyState) return <div className={className}>{emptyState}</div>
    return (
      <EmptyState
        size="sm"
        icon={<ChartNoAxesColumn aria-hidden />}
        title={t('ui.blocks.statStrip.empty', 'No figures yet')}
        description={t('ui.blocks.statStrip.emptyDescription', 'Figures will appear here once there is data to count.')}
        className={cn('items-start px-0 text-left', className)}
      />
    )
  }

  const columnCount = resolveColumnCount(columns, items.length)

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? t('ui.blocks.statStrip.label', 'Key figures')}
      data-slot="stat-strip"
      data-variant={variant}
      data-size={size}
      className={cn(ROOT_CLASS[variant], className)}
    >
      <ul data-slot="stat-strip-list" className={cn(GRID_CLASS[variant], COLUMN_CLASS[columnCount])}>
        {items.map((item, index) => (
          <li key={item.id} className={cellClassName(variant, columnCount, items.length, index)}>
            <StatTile
              item={item}
              variant={variant}
              size={size}
                    selected={selectedId === item.id}
              onItemClick={onItemClick}
              onItemAction={onItemAction}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
