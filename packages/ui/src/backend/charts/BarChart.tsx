"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export type BarChartDataItem = Record<string, string | number | null | undefined>

export type BarChartProps = {
  title?: string
  data: BarChartDataItem[]
  index: string
  categories: string[]
  loading?: boolean
  error?: string | null
  colors?: string[]
  layout?: 'vertical' | 'horizontal'
  valueFormatter?: (value: number) => string
  showLegend?: boolean
  showGridLines?: boolean
  className?: string
  emptyMessage?: string
  categoryLabels?: Record<string, string>
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

const BarChartImpl = dynamic(() => import('./BarChartImpl'), {
  ssr: false,
  loading: () => (
    <div className="flex h-40 sm:h-48 items-center justify-center">
      <Spinner className="h-6 w-6 text-muted-foreground" />
    </div>
  ),
})

export function BarChart({
  title,
  data,
  index,
  categories,
  loading,
  error,
  colors,
  layout = 'vertical',
  valueFormatter = defaultValueFormatter,
  showLegend = true,
  showGridLines = true,
  className = '',
  emptyMessage = 'No data available',
  categoryLabels,
}: BarChartProps) {
  const hasWrapper = !!title
  const wrapperClass = hasWrapper ? `rounded-lg border bg-card p-4 ${className}` : className

  if (error) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-40 sm:h-48 items-center justify-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-40 sm:h-48 items-center justify-center">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-40 sm:h-48 items-center justify-center">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={wrapperClass}>
      {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      <BarChartImpl
        data={data}
        index={index}
        categories={categories}
        colors={colors}
        layout={layout}
        valueFormatter={valueFormatter}
        showLegend={showLegend}
        showGridLines={showGridLines}
        categoryLabels={categoryLabels}
      />
    </div>
  )
}

export default BarChart
