"use client"

import * as React from 'react'

export type SparklineBand = {
  lower: number
  upper: number
  centre?: number
}

export type SparklineProps = {
  values: number[]
  ariaLabel: string
  className?: string
  width?: number
  height?: number
  /** Natural process limits drawn as a shaded band behind the line, with an optional centre line. */
  band?: SparklineBand
  /** Number of leading points that belong to complete periods; the rest is drawn as a dotted tail. */
  completeCount?: number
  /** Point indexes to mark with a dot (e.g. XmR signals). */
  highlightIndexes?: number[]
  /**
   * One label per point (e.g. the date of each bucket). When given, the chart becomes inspectable:
   * moving the pointer or the arrow keys over it shows the label and value of the nearest point.
   */
  pointLabels?: string[]
  /** Formats the value shown for the inspected point; defaults to a plain number. */
  formatValue?: (value: number) => string
}

type Point = { x: number; y: number }

function buildScale(values: number[], band: SparklineBand | undefined, height: number) {
  const padding = 2
  const usableHeight = Math.max(height - padding * 2, 0)
  let min = values[0]
  let max = values[0]
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  if (band) {
    min = Math.min(min, band.lower)
    max = Math.max(max, band.upper)
  }
  const range = max - min
  return (value: number) => {
    const ratio = range === 0 ? 0.5 : (value - min) / range
    return padding + (1 - ratio) * usableHeight
  }
}

function buildPoints(values: number[], width: number, scaleY: (value: number) => number): Point[] {
  const count = values.length
  if (count === 1) {
    return [{ x: width / 2, y: scaleY(values[0]) }]
  }
  const stepX = width / (count - 1)
  return values.map((value, index) => ({ x: stepX * index, y: scaleY(value) }))
}

// The chart stretches to its container (`preserveAspectRatio="none"`), which would turn circles into
// ovals. A near-zero line with round caps and a non-scaling stroke stays a true dot at any size.
const DOT_PROPS = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' } as const

function dotPath(point: Point): string {
  return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)} l 0.01 0`
}

function toPath(points: Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')
}

export function Sparkline({
  values,
  ariaLabel,
  className = '',
  width = 96,
  height = 28,
  band,
  completeCount,
  highlightIndexes,
  pointLabels,
  formatValue,
}: SparklineProps) {
  const gradientId = React.useId().replace(/:/g, '')
  const [inspected, setInspected] = React.useState<number | null>(null)
  if (!values || values.length === 0) {
    return null
  }

  const scaleY = buildScale(values, band, height)
  const points = buildPoints(values, width, scaleY)
  const solidCount = completeCount === undefined
    ? points.length
    : Math.min(Math.max(completeCount, 1), points.length)
  const solidPoints = points.slice(0, solidCount)
  const tailPoints = solidCount < points.length ? points.slice(solidCount - 1) : []
  const linePath = toPath(solidPoints)

  const firstPoint = solidPoints[0]
  const lastSolid = solidPoints[solidPoints.length - 1]
  const areaPath = `${linePath} L ${lastSolid.x.toFixed(2)} ${height} L ${firstPoint.x.toFixed(2)} ${height} Z`

  const interactive = !!pointLabels && pointLabels.length === values.length
  const lastIndex = values.length - 1
  const inspectAt = (clientX: number, target: Element) => {
    const rect = target.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    setInspected(Math.round(ratio * lastIndex))
  }
  const inspectedPoint = inspected !== null ? points[inspected] : undefined

  const chart = (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={interactive ? 'block size-full cursor-crosshair outline-none' : className}
      {...(interactive
        ? {
            tabIndex: 0,
            onMouseMove: (event: React.MouseEvent<SVGSVGElement>) => inspectAt(event.clientX, event.currentTarget),
            onMouseEnter: (event: React.MouseEvent<SVGSVGElement>) => inspectAt(event.clientX, event.currentTarget),
            onMouseLeave: () => setInspected(null),
            onBlur: () => setInspected(null),
            onKeyDown: (event: React.KeyboardEvent<SVGSVGElement>) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              setInspected((current) => {
                const start = current ?? (event.key === 'ArrowLeft' ? lastIndex + 1 : -1)
                return Math.min(lastIndex, Math.max(0, start + (event.key === 'ArrowLeft' ? -1 : 1)))
              })
            },
          }
        : {})}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {band ? (
        <g data-slot="sparkline-band">
          <rect
            x={0}
            y={scaleY(band.upper)}
            width={width}
            height={Math.max(scaleY(band.lower) - scaleY(band.upper), 0)}
            fill="currentColor"
            fillOpacity={0.08}
          />
          {band.centre !== undefined ? (
            <line
              x1={0}
              x2={width}
              y1={scaleY(band.centre)}
              y2={scaleY(band.centre)}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </g>
      ) : null}
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {tailPoints.length > 1 ? (
        <path
          data-slot="sparkline-incomplete"
          d={toPath(tailPoints)}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.6}
          strokeWidth={1.5}
          strokeDasharray="2 3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {highlightIndexes?.map((index) => {
        const point = points[index]
        if (!point) return null
        return <path key={index} data-slot="sparkline-highlight" d={dotPath(point)} {...DOT_PROPS} strokeWidth={5} />
      })}
      {inspectedPoint ? (
        <g data-slot="sparkline-inspected">
          <line x1={inspectedPoint.x} x2={inspectedPoint.x} y1={0} y2={height} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={dotPath(inspectedPoint)} {...DOT_PROPS} strokeWidth={7} />
        </g>
      ) : null}
    </svg>
  )

  if (!interactive) return chart

  const inspectedValue = inspected !== null ? values[inspected] : undefined
  const position = inspected !== null && lastIndex > 0 ? (inspected / lastIndex) * 100 : 50
  return (
    <div className={`relative ${className}`} data-slot="sparkline-interactive">
      {chart}
      {inspected !== null && inspectedValue !== undefined ? (
        <div
          role="status"
          className="pointer-events-none absolute top-1 z-10 flex -translate-x-1/2 items-baseline gap-2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
          style={{ left: `${Math.min(88, Math.max(12, position))}%` }}
        >
          <span className="text-muted-foreground">{pointLabels?.[inspected]}</span>
          <span className="tabular-nums">{formatValue ? formatValue(inspectedValue) : inspectedValue.toLocaleString()}</span>
        </div>
      ) : null}
    </div>
  )
}

export default Sparkline
