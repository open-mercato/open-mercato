"use client"

import * as React from 'react'

export type HoursSparklineProps = {
  values: number[]
  color?: string
  width?: number
  height?: number
  ariaLabel: string
  className?: string
}

const DEFAULT_COLOR = '#6366f1'

export function HoursSparkline({
  values,
  color = DEFAULT_COLOR,
  width = 54,
  height = 14,
  ariaLabel,
  className,
}: HoursSparklineProps) {
  const nonEmpty = values.length > 0
  const max = nonEmpty ? Math.max(...values, 0) : 0
  const allZero = !nonEmpty || max === 0

  if (allZero) {
    return (
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className}
      >
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          className="stroke-border"
          strokeWidth={1}
        />
      </svg>
    )
  }

  const stepX = values.length === 1 ? 0 : width / (values.length - 1)
  const points = values.map((value, idx) => {
    const x = values.length === 1 ? width / 2 : idx * stepX
    const y = height - (value / max) * (height - 2) - 1
    return { x, y }
  })

  const linePath = points
    .map((p, idx) => (idx === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`))
    .join(' ')
  const areaPath = `${linePath} L${points[points.length - 1].x},${height} L${points[0].x},${height} Z`

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
    >
      <path d={areaPath} fill={color} opacity={0.15} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
