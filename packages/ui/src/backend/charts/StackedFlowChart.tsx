"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { getChartColor } from './ChartUtils'
import { EmptyState } from '../../primitives/empty-state'
import { EmptyStateIllustration } from '../../primitives/empty-state-illustration'

export type StackedFlowChartBucket = {
  /** X-axis label, e.g. a month name. */
  label: string
  /** Value per series key; missing keys count as 0. */
  values: Record<string, number>
}

export type StackedFlowChartProps = {
  data: StackedFlowChartBucket[]
  /** Fixed series order, bottom-up; colors follow this order. */
  series: string[]
  /** Optional color per series; defaults to the categorical chart palette. */
  colors?: Record<string, string>
  valueFormatter?: (value: number) => string
  height?: number
  showLegend?: boolean
  className?: string
  emptyMessage?: string
}

const SEGMENT_GAP = 6
const SEGMENT_RADIUS = 8
const TOTAL_LABEL_SPACE = 28
const AXIS_LABEL_SPACE = 26
const RIBBON_OPACITY = 0.14

function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = React.useState(0)
  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      setWidth((current) => (Math.abs(current - next) > 1 ? next : current))
    })
    observer.observe(node)
    setWidth(node.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

function defaultFormatter(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

type HoverState = {
  seriesKey: string
  columnIndex: number
  x: number
  y: number
}

export function StackedFlowChart({
  data,
  series,
  colors,
  valueFormatter = defaultFormatter,
  height = 280,
  showLegend = true,
  className,
  emptyMessage,
}: StackedFlowChartProps) {
  const [containerRef, width] = useContainerWidth()
  const [hover, setHover] = React.useState<HoverState | null>(null)
  const [legendKey, setLegendKey] = React.useState<string | null>(null)
  const activeKey = hover?.seriesKey ?? legendKey

  const totals = React.useMemo(
    () => data.map((bucket) => series.reduce((sum, key) => sum + Math.max(0, bucket.values[key] ?? 0), 0)),
    [data, series],
  )
  const maxTotal = Math.max(...totals, 0)

  const colorFor = React.useCallback(
    (key: string) => colors?.[key] ?? getChartColor(series.indexOf(key)),
    [colors, series],
  )

  if (data.length === 0 || maxTotal <= 0) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height }}>
        {emptyMessage ? <EmptyState variant="subtle" size="sm" illustration={<EmptyStateIllustration kind="mercato-records" className="size-24" />} title={emptyMessage} /> : null}
      </div>
    )
  }

  const plotTop = TOTAL_LABEL_SPACE
  const plotBottom = height - AXIS_LABEL_SPACE
  const plotHeight = plotBottom - plotTop
  const slotWidth = width / data.length
  const barWidth = Math.min(Math.max(slotWidth * 0.42, 40), 168)

  type Segment = { key: string; x: number; top: number; bottom: number }
  const columns: { x: number; centerX: number; total: number; segments: Segment[] }[] = data.map((bucket, index) => {
    const centerX = slotWidth * index + slotWidth / 2
    const x = centerX - barWidth / 2
    const visible = series.filter((key) => (bucket.values[key] ?? 0) > 0)
    const gaps = SEGMENT_GAP * Math.max(0, visible.length - 1)
    const scale = maxTotal > 0 ? (plotHeight - gaps) / maxTotal : 0
    let cursor = plotBottom
    const segments: Segment[] = []
    for (const key of visible) {
      const segmentHeight = Math.max((bucket.values[key] ?? 0) * scale, 3)
      segments.push({ key, x, top: cursor - segmentHeight, bottom: cursor })
      cursor -= segmentHeight + SEGMENT_GAP
    }
    return { x, centerX, total: totals[index] ?? 0, segments }
  })

  const ribbons: { key: string; path: string }[] = []
  for (let index = 0; index < columns.length - 1; index += 1) {
    const left = columns[index]
    const right = columns[index + 1]
    for (const key of series) {
      const from = left.segments.find((segment) => segment.key === key)
      const to = right.segments.find((segment) => segment.key === key)
      if (!from || !to) continue
      const x1 = left.x + barWidth
      const x2 = right.x
      if (x2 <= x1) continue
      const bend = (x2 - x1) * 0.45
      ribbons.push({
        key,
        path: [
          `M ${x1} ${from.top}`,
          `C ${x1 + bend} ${from.top}, ${x2 - bend} ${to.top}, ${x2} ${to.top}`,
          `L ${x2} ${to.bottom}`,
          `C ${x2 - bend} ${to.bottom}, ${x1 + bend} ${from.bottom}, ${x1} ${from.bottom}`,
          'Z',
        ].join(' '),
      })
    }
  }

  const hoverValue = hover ? data[hover.columnIndex]?.values[hover.seriesKey] ?? 0 : 0
  const hoverTotal = hover ? totals[hover.columnIndex] ?? 0 : 0
  const hoverShare = hover && hoverTotal > 0 ? Math.round((hoverValue / hoverTotal) * 100) : null

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div ref={containerRef} className="relative min-h-0 w-full flex-1">
        {width > 0 ? (
          <svg width={width} height={height} role="img" className="block" onMouseLeave={() => setHover(null)}>
            {ribbons.map((ribbon, index) => (
              <path
                key={`ribbon-${index}`}
                d={ribbon.path}
                fill={colorFor(ribbon.key)}
                fillOpacity={activeKey ? (ribbon.key === activeKey ? RIBBON_OPACITY * 2 : RIBBON_OPACITY * 0.4) : RIBBON_OPACITY}
              />
            ))}
            {columns.map((column, columnIndex) => (
              <g key={`column-${columnIndex}`}>
                {column.segments.map((segment) => (
                  <rect
                    key={segment.key}
                    x={segment.x}
                    y={segment.top}
                    width={barWidth}
                    height={segment.bottom - segment.top}
                    rx={Math.min(SEGMENT_RADIUS, (segment.bottom - segment.top) / 2)}
                    fill={colorFor(segment.key)}
                    fillOpacity={activeKey && segment.key !== activeKey ? 0.3 : 1}
                    onMouseEnter={() => setHover({ seriesKey: segment.key, columnIndex, x: column.centerX, y: segment.top })}
                    onMouseMove={() => setHover({ seriesKey: segment.key, columnIndex, x: column.centerX, y: segment.top })}
                  />
                ))}
                <text
                  x={column.centerX}
                  y={plotTop - 10}
                  textAnchor="middle"
                  className={cn(
                    'text-sm font-semibold tabular-nums',
                    column.total > 0 ? 'fill-foreground' : 'fill-muted-foreground opacity-60',
                  )}
                >
                  {valueFormatter(column.total)}
                </text>
                <text
                  x={column.centerX}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground text-xs"
                >
                  {data[columnIndex]?.label}
                </text>
              </g>
            ))}
          </svg>
        ) : null}
        {hover ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: hover.x, top: Math.max(hover.y - 6, 0) }}
            role="status"
          >
            <span className="flex items-center gap-1.5">
              <span className="size-2 flex-none rounded-sm" style={{ backgroundColor: colorFor(hover.seriesKey) }} aria-hidden="true" />
              <span className="text-muted-foreground">{hover.seriesKey}</span>
              <span className="font-semibold tabular-nums text-foreground">{valueFormatter(hoverValue)}</span>
              {hoverShare !== null ? <span className="tabular-nums text-muted-foreground">({hoverShare}%)</span> : null}
            </span>
          </div>
        ) : null}
      </div>
      {showLegend ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {series.map((key) => (
            <span
              key={key}
              className={cn(
                'inline-flex cursor-default items-center gap-1.5 text-xs text-muted-foreground transition-opacity',
                activeKey && activeKey !== key && 'opacity-40',
              )}
              onMouseEnter={() => setLegendKey(key)}
              onMouseLeave={() => setLegendKey(null)}
            >
              <span className="size-2 rounded-sm" style={{ backgroundColor: colorFor(key) }} aria-hidden="true" />
              {key}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
