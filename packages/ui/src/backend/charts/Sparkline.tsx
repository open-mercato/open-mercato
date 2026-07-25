"use client"

import * as React from 'react'

export type SparklineProps = {
  values: number[]
  ariaLabel: string
  className?: string
  width?: number
  height?: number
}

function buildPoints(values: number[], width: number, height: number): Array<{ x: number; y: number }> {
  const count = values.length
  const padding = 2
  const usableHeight = Math.max(height - padding * 2, 0)

  if (count === 1) {
    return [{ x: width / 2, y: height / 2 }]
  }

  let min = values[0]
  let max = values[0]
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  const range = max - min

  const stepX = count > 1 ? width / (count - 1) : 0

  return values.map((value, index) => {
    const x = stepX * index
    const ratio = range === 0 ? 0.5 : (value - min) / range
    const y = padding + (1 - ratio) * usableHeight
    return { x, y }
  })
}

function toPath(points: Array<{ x: number; y: number }>): string {
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
}: SparklineProps) {
  if (!values || values.length === 0) {
    return null
  }

  const points = buildPoints(values, width, height)
  const linePath = toPath(points)

  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]
  const areaPath = `${linePath} L ${lastPoint.x.toFixed(2)} ${height} L ${firstPoint.x.toFixed(2)} ${height} Z`

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
    >
      <path d={areaPath} fill="currentColor" fillOpacity={0.12} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default Sparkline
