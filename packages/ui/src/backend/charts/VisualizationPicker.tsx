"use client"

import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cn } from '@open-mercato/shared/lib/utils'

export type VisualizationKind = 'kpi' | 'line' | 'bar' | 'donut' | 'table' | 'breakdown' | 'leader' | 'funnel' | 'statusStrip' | 'target'

/** Thumbnail kinds: every chart type plus record lists and text-first widgets. */
export type WidgetIllustrationKind = VisualizationKind | 'list' | 'text'

export type VisualizationOption = {
  value: VisualizationKind
  label: string
  /** Shown instead of the label hint when the option cannot be used with the current data. */
  disabledReason?: string | null
  recommended?: boolean
}

export type VisualizationPickerProps = {
  options: VisualizationOption[]
  value: VisualizationKind
  onValueChange: (value: VisualizationKind) => void
  /** Fires while a tile is hovered or focused so the host can preview it; `null` when the pointer leaves. */
  onPreviewChange?: (value: VisualizationKind | null) => void
  recommendedLabel: string
  'aria-label': string
  className?: string
}

const GRID_LINES = [20, 40, 60, 80]

/** Deterministic per-widget variation so a catalog of ten KPI tiles does not show ten identical pictures. */
type IllustrationVariant = {
  /** Uniform numbers in [0, 1), stable for the seed. */
  next: () => number
  /** Picks one of the given values. */
  pick: <T,>(values: readonly T[]) => T
}

function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createVariant(seed: string): IllustrationVariant {
  let state = hashSeed(seed) || 1
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  return { next, pick: (values) => values[Math.floor(next() * values.length)] as never }
}

function IllustrationGrid() {
  return (
    <g className="text-border" aria-hidden="true">
      {GRID_LINES.map((position) => (
        <React.Fragment key={position}>
          <line x1={position * 1.6} y1={0} x2={position * 1.6} y2={100} stroke="currentColor" strokeWidth={0.5} />
          <line x1={0} y1={position} x2={160} y2={position} stroke="currentColor" strokeWidth={0.5} />
        </React.Fragment>
      ))}
    </g>
  )
}

function Marker({ cx, cy }: { cx: number; cy: number }) {
  return <circle cx={cx} cy={cy} r={3.5} className="fill-card stroke-chart-1" strokeWidth={2} />
}

function seriesPoints(variant: IllustrationVariant, count: number, x0: number, x1: number, yTop: number, yBottom: number, trend: number): Array<[number, number]> {
  const step = (x1 - x0) / (count - 1)
  let level = 0.35 + variant.next() * 0.3
  return Array.from({ length: count }, (_, index) => {
    level = Math.min(0.95, Math.max(0.05, level + trend / count + (variant.next() - 0.5) * 0.35))
    return [x0 + index * step, yBottom - level * (yBottom - yTop)]
  })
}

function toPolyline(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

const KPI_VALUES = ['824 122', '214', '3 851', '16', '1 454', '92%', '47', '12,4 k', '368', '5 207'] as const

function BarIllustration(variant: IllustrationVariant) {
  const heights = Array.from({ length: 5 }, () => 14 + Math.round(variant.next() * 46))
  const highlight = Math.floor(variant.next() * heights.length)
  return (
    <>
      {heights.map((height, index) => (
        <rect key={index} x={50 + index * 20} y={82 - height} width={14} height={height} rx={2} className={index === highlight ? 'fill-chart-1' : 'fill-chart-1/30'} />
      ))}
      <line x1={46} y1={82} x2={146} y2={82} className="stroke-muted-foreground/60" strokeWidth={1} />
      <Marker cx={57 + highlight * 20} cy={82 - heights[highlight]} />
    </>
  )
}

function LineIllustration(variant: IllustrationVariant) {
  const trend = variant.pick([0.5, 0.2, -0.3, 0.8])
  const main = seriesPoints(variant, 7, 48, 140, 24, 80, trend)
  const shadow = seriesPoints(variant, 7, 48, 140, 30, 82, trend * 0.4)
  const last = main[main.length - 1]
  const area = `${toPolyline(main)} 140,82 48,82`
  return (
    <>
      <polygon points={area} className="fill-chart-1/10" />
      <polyline points={toPolyline(shadow)} className="fill-none stroke-muted-foreground/40" strokeWidth={1.5} strokeLinejoin="round" strokeDasharray="3 3" />
      <polyline points={toPolyline(main)} className="fill-none stroke-chart-1" strokeWidth={2} strokeLinejoin="round" />
      <Marker cx={last[0]} cy={last[1]} />
    </>
  )
}

function DonutIllustration(variant: IllustrationVariant) {
  const circumference = 2 * Math.PI * 26
  const first = 0.2 + variant.next() * 0.35
  const second = 0.1 + variant.next() * 0.25
  return (
    <>
      <circle cx={90} cy={52} r={26} className="fill-none stroke-muted-foreground/25" strokeWidth={12} />
      <circle cx={90} cy={52} r={26} className="fill-none stroke-chart-1/40" strokeWidth={12} strokeDasharray={`${circumference * second} ${circumference}`} transform={`rotate(${-90 + first * 360} 90 52)`} />
      <circle cx={90} cy={52} r={26} className="fill-none stroke-chart-1" strokeWidth={12} strokeDasharray={`${circumference * first} ${circumference}`} transform="rotate(-90 90 52)" />
      <text x={90} y={56} textAnchor="middle" className="fill-foreground text-xs font-medium tabular-nums">{Math.round(first * 100)}%</text>
    </>
  )
}

function KpiIllustration(variant: IllustrationVariant) {
  const value = variant.pick(KPI_VALUES)
  const up = variant.next() > 0.3
  const points = seriesPoints(variant, 8, 96, 150, 40, 70, up ? 0.6 : -0.5)
  return (
    <>
      <rect x={50} y={22} width={40} height={5} rx={2.5} className="fill-muted-foreground/40" />
      <text x={12} y={78} textAnchor="start" className="fill-foreground text-2xl tabular-nums">{value}</text>
      <polyline points={up ? '14,88 17,84 20,88' : '14,84 17,88 20,84'} className={up ? 'fill-none stroke-status-success-icon' : 'fill-none stroke-status-error-icon'} strokeWidth={1.5} strokeLinejoin="round" />
      <rect x={24} y={84} width={16} height={3} rx={1.5} className={up ? 'fill-status-success-icon/70' : 'fill-status-error-icon/70'} />
      <rect x={44} y={84} width={26} height={3} rx={1.5} className="fill-muted-foreground/30" />
      <polygon points={`${toPolyline(points)} 150,72 96,72`} className="fill-chart-1/15" />
      <polyline points={toPolyline(points)} className="fill-none stroke-chart-1" strokeWidth={1.5} strokeLinejoin="round" />
    </>
  )
}

function TableIllustration(variant: IllustrationVariant) {
  const first = 120 + Math.round(variant.next() * 800)
  const second = Math.round(first * (0.3 + variant.next() * 0.5))
  return (
    <>
      <rect x={46} y={18} width={100} height={66} rx={4} className="fill-muted/60 stroke-border" strokeWidth={1} />
      <rect x={54} y={26} width={36} height={4} rx={2} className="fill-muted-foreground/40" />
      <rect x={112} y={26} width={26} height={4} rx={2} className="fill-muted-foreground/40" />
      <rect x={50} y={36} width={92} height={14} rx={3} className="fill-card stroke-chart-1" strokeWidth={1.25} />
      <rect x={56} y={41} width={30} height={4} rx={2} className="fill-chart-1" />
      <text x={136} y={47} textAnchor="end" className="fill-foreground text-xs tabular-nums">{first}</text>
      <rect x={54} y={58} width={28} height={4} rx={2} className="fill-muted-foreground/40" />
      <text x={136} y={63} textAnchor="end" className="fill-muted-foreground text-xs tabular-nums">{second}</text>
      <rect x={54} y={72} width={22} height={4} rx={2} className="fill-muted-foreground/30" />
    </>
  )
}

const LIST_TONES = ['fill-chart-1', 'fill-status-warning-icon', 'fill-status-success-icon', 'fill-status-error-icon'] as const

function ListIllustration(variant: IllustrationVariant) {
  const tone = variant.pick(LIST_TONES)
  const widths = [26, 46, 66].map(() => 30 + Math.round(variant.next() * 22))
  return (
    <>
      {[26, 46, 66].map((y, index) => (
        <React.Fragment key={y}>
          <circle cx={54} cy={y + 4} r={5} className={index === 0 ? tone : 'fill-muted-foreground/30'} />
          <rect x={66} y={y} width={widths[index]} height={4} rx={2} className={index === 0 ? 'fill-foreground/70' : 'fill-muted-foreground/40'} />
          <rect x={66} y={y + 7} width={widths[index] * 0.6} height={3} rx={1.5} className="fill-muted-foreground/25" />
          <rect x={126} y={y + 2} width={14} height={4} rx={2} className="fill-muted-foreground/30" />
        </React.Fragment>
      ))}
    </>
  )
}

function TextIllustration(variant: IllustrationVariant) {
  const widths = [88, 80, 52].map((base) => base - Math.round(variant.next() * 20))
  return (
    <>
      <rect x={50} y={24} width={60} height={6} rx={3} className="fill-foreground/70" />
      <rect x={50} y={40} width={widths[0]} height={4} rx={2} className="fill-muted-foreground/40" />
      <rect x={50} y={50} width={widths[1]} height={4} rx={2} className="fill-muted-foreground/40" />
      <rect x={50} y={60} width={widths[2]} height={4} rx={2} className="fill-muted-foreground/40" />
      <rect x={50} y={72} width={6} height={6} rx={3} className="fill-chart-1" />
      <rect x={60} y={73} width={40} height={4} rx={2} className="fill-muted-foreground/30" />
    </>
  )
}

function BreakdownIllustration(variant: IllustrationVariant) {
  const shares = [0.95, 0.5 + variant.next() * 0.3, 0.2 + variant.next() * 0.25]
  return (
    <>
      {shares.map((share, index) => (
        <React.Fragment key={index}>
          <rect x={50} y={26 + index * 20} width={30 + Math.round(variant.next() * 24)} height={4} rx={2} className="fill-muted-foreground/40" />
          <rect x={50} y={34 + index * 20} width={92} height={5} rx={2.5} className="fill-muted-foreground/15" />
          <rect x={50} y={34 + index * 20} width={Math.round(92 * share)} height={5} rx={2.5} className={index === 0 ? 'fill-chart-1' : 'fill-chart-1/40'} />
        </React.Fragment>
      ))}
    </>
  )
}

function LeaderIllustration(variant: IllustrationVariant) {
  const lead = 3 + Math.floor(variant.next() * 2)
  return (
    <>
      <rect x={50} y={26} width={50 + Math.round(variant.next() * 20)} height={9} rx={3} className="fill-foreground/80" />
      <rect x={50} y={42} width={34} height={4} rx={2} className="fill-muted-foreground/40" />
      {Array.from({ length: 5 }, (_, index) => (
        <rect key={index} x={50 + index * 19} y={58} width={16} height={7} rx={3} className={index < lead ? 'fill-chart-1' : 'fill-muted-foreground/20'} />
      ))}
      <rect x={50} y={74} width={58} height={4} rx={2} className="fill-muted-foreground/30" />
    </>
  )
}

function FunnelIllustration(variant: IllustrationVariant) {
  let width = 96
  const widths = Array.from({ length: 4 }, () => {
    const current = width
    width = Math.max(18, Math.round(width * (0.55 + variant.next() * 0.25)))
    return current
  })
  return (
    <>
      {widths.map((barWidth, index) => (
        <rect key={index} x={98 - barWidth / 2} y={24 + index * 15} width={barWidth} height={10} rx={3} className={index === 0 ? 'fill-chart-1' : index === 1 ? 'fill-chart-1/60' : index === 2 ? 'fill-chart-1/40' : 'fill-chart-1/25'} />
      ))}
    </>
  )
}

function StatusStripIllustration(variant: IllustrationVariant) {
  const tones = ['fill-status-success-icon', 'fill-status-warning-icon', 'fill-status-error-icon', 'fill-muted-foreground/50']
  return (
    <>
      {tones.map((tone, index) => (
        <React.Fragment key={index}>
          <rect x={48 + index * 25} y={34} width={21} height={36} rx={4} className="fill-card stroke-border" strokeWidth={1} />
          <circle cx={54 + index * 25} cy={42} r={2} className={tone} />
          <rect x={52 + index * 25} y={50} width={8 + Math.round(variant.next() * 6)} height={6} rx={2} className="fill-foreground/70" />
          <rect x={52 + index * 25} y={61} width={13} height={3} rx={1.5} className="fill-muted-foreground/30" />
        </React.Fragment>
      ))}
    </>
  )
}

function TargetIllustration(variant: IllustrationVariant) {
  const progress = 0.35 + variant.next() * 0.5
  return (
    <>
      <rect x={50} y={28} width={48} height={9} rx={3} className="fill-foreground/80" />
      <rect x={112} y={31} width={30} height={4} rx={2} className="fill-muted-foreground/40" />
      <rect x={50} y={52} width={92} height={7} rx={3.5} className="fill-muted-foreground/15" />
      <rect x={50} y={52} width={Math.round(92 * progress)} height={7} rx={3.5} className="fill-chart-1" />
      <line x1={142} y1={47} x2={142} y2={64} className="stroke-foreground/70" strokeWidth={1.5} />
      <rect x={50} y={72} width={26} height={6} rx={3} className="fill-status-success-icon/60" />
    </>
  )
}

const ILLUSTRATIONS: Record<WidgetIllustrationKind, (variant: IllustrationVariant) => React.ReactElement> = {
  kpi: KpiIllustration,
  line: LineIllustration,
  bar: BarIllustration,
  donut: DonutIllustration,
  table: TableIllustration,
  breakdown: BreakdownIllustration,
  leader: LeaderIllustration,
  funnel: FunnelIllustration,
  statusStrip: StatusStripIllustration,
  target: TargetIllustration,
  list: ListIllustration,
  text: TextIllustration,
}

export type VisualizationIllustrationProps = {
  kind: WidgetIllustrationKind
  /** Stable key (usually the widget id) that varies the picture; omit for the canonical sample. */
  seed?: string
  /** Widget icon drawn in a chip in the top-left corner so tiles of one kind stay distinguishable. */
  icon?: IllustrationIcon
  className?: string
}

/** Any component that renders an `<svg>` and forwards svg attributes (lucide icons do). */
export type IllustrationIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>

export function VisualizationIllustration({ kind, seed, icon: Icon, className }: VisualizationIllustrationProps) {
  const variant = createVariant(seed ?? kind)
  return (
    <svg viewBox="0 0 160 100" className={cn('size-full', className)} aria-hidden="true" focusable="false">
      <IllustrationGrid />
      {ILLUSTRATIONS[kind](variant)}
      {Icon ? (
        <>
          <rect x={10} y={10} width={30} height={30} rx={7} className="fill-card stroke-border" strokeWidth={1} />
          <Icon x={16} y={16} width={18} height={18} className="text-muted-foreground" />
        </>
      ) : null}
    </svg>
  )
}

/**
 * Chart-type chooser rendered as illustrated tiles. Unlike a plain select it previews the
 * hovered type through `onPreviewChange`, flags the best fit for the current data, and says
 * why an unavailable type cannot be used instead of only greying it out.
 */
export function VisualizationPicker({
  options,
  value,
  onValueChange,
  onPreviewChange,
  recommendedLabel,
  className,
  ...props
}: VisualizationPickerProps) {
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(next) => onValueChange(next as VisualizationKind)}
      aria-label={props['aria-label']}
      className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3', className)}
      onMouseLeave={() => onPreviewChange?.(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onPreviewChange?.(null)
      }}
    >
      {options.map((option) => {
        const disabled = !!option.disabledReason
        return (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={disabled}
            data-slot="visualization-option"
            onMouseEnter={() => { if (!disabled) onPreviewChange?.(option.value) }}
            onFocus={() => { if (!disabled) onPreviewChange?.(option.value) }}
            className={cn(
              'group relative flex flex-col items-stretch gap-2 rounded-xl border border-border bg-card p-2 text-left transition-colors',
              'hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'data-[state=checked]:border-chart-1 data-[state=checked]:ring-1 data-[state=checked]:ring-chart-1',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <span className="relative flex aspect-video overflow-hidden rounded-lg bg-muted/40">
              <VisualizationIllustration kind={option.value} />
              {option.recommended && !disabled ? (
                <span className="absolute right-1.5 top-1.5 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs font-medium text-foreground">{recommendedLabel}</span>
              ) : null}
            </span>
            <span className="truncate px-1 pb-0.5 text-sm font-medium text-foreground">{option.label}</span>
            {disabled ? (
              <span className="px-1 text-xs text-muted-foreground">{option.disabledReason}</span>
            ) : null}
          </RadioGroupPrimitive.Item>
        )
      })}
    </RadioGroupPrimitive.Root>
  )
}

export default VisualizationPicker
