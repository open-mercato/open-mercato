"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export type LineChartDataItem = Record<string, string | number | null | undefined>

export type LineChartProps = {
  title?: string
  data: LineChartDataItem[]
  index: string
  categories: string[]
  loading?: boolean
  error?: string | null
  colors?: string[]
  showArea?: boolean
  valueFormatter?: (value: number) => string
  showLegend?: boolean
  showGridLines?: boolean
  curveType?: 'linear' | 'natural' | 'monotone' | 'step'
  connectNulls?: boolean
  className?: string
  emptyMessage?: string
  categoryLabels?: Record<string, string>
  /** Render only the plot (no card border, padding or title) so a host card can own the chrome. */
  bare?: boolean
  /** Height utility for the plot area; defaults to `h-52`. */
  heightClassName?: string
  /** Recharts draw-in animation; pass false for charts that re-render on interaction. */
  animate?: boolean
  /** Fill opacity of the area under each line when `showArea` is on; defaults to 0.2. */
  areaOpacity?: number
  /** Recharts keyboard/focus layer; pass false for decorative charts so the plot never takes focus. */
  accessibilityLayer?: boolean
}

function defaultValueFormatter(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

const LineChartImpl = dynamic(() => import('./LineChartImpl'), {
  ssr: false,
  loading: () => (
    <div className="flex h-48 items-center justify-center">
      <Spinner className="h-6 w-6 text-muted-foreground" />
    </div>
  ),
})

export function LineChart({
  title,
  data,
  index,
  categories,
  loading,
  error,
  colors,
  showArea = false,
  valueFormatter = defaultValueFormatter,
  showLegend = true,
  showGridLines = true,
  curveType = 'monotone',
  connectNulls = true,
  className = '',
  emptyMessage = 'No data available',
  categoryLabels,
  bare = false,
  heightClassName = 'h-52',
  animate = true,
  areaOpacity = 0.2,
  accessibilityLayer = true,
}: LineChartProps) {
  const wrapperClassName = bare ? className : `rounded-lg border bg-card p-4 ${className}`
  const stateClassName = bare ? `flex items-center justify-center ${heightClassName}` : 'flex h-48 items-center justify-center'
  if (error) {
    return (
      <div className={wrapperClassName}>
        {title && !bare && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className={stateClassName}>
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={wrapperClassName}>
        {title && !bare && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className={stateClassName}>
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className={wrapperClassName}>
        {title && !bare && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className={stateClassName}>
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={wrapperClassName}>
      {title && !bare && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      <div className={`${heightClassName} w-full`}>
        <LineChartImpl
          data={data}
          index={index}
          categories={categories}
          colors={colors}
          showArea={showArea}
          valueFormatter={valueFormatter}
          showLegend={showLegend}
          showGridLines={showGridLines}
          curveType={curveType}
          connectNulls={connectNulls}
          categoryLabels={categoryLabels}
          animate={animate}
          areaOpacity={areaOpacity}
          accessibilityLayer={accessibilityLayer}
        />
      </div>
    </div>
  )
}

export default LineChart
