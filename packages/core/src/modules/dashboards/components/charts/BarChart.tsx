"use client"

import * as React from 'react'
import { Card, Title, BarChart as TremorBarChart } from '@tremor/react'
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
}: BarChartProps) {
  if (error) {
    return (
      <Card className={className}>
        {title && <Title className="mb-4">{title}</Title>}
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card className={className}>
        {title && <Title className="mb-4">{title}</Title>}
        <div className="flex h-48 items-center justify-center">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      </Card>
    )
  }

  if (!data || data.length === 0) {
    return (
      <Card className={className}>
        {title && <Title className="mb-4">{title}</Title>}
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      </Card>
    )
  }

  return (
    <Card className={className}>
      {title && <Title className="mb-4">{title}</Title>}
      <TremorBarChart
        data={data}
        index={index}
        categories={categories}
        colors={colors as any}
        layout={layout}
        valueFormatter={valueFormatter}
        showLegend={showLegend}
        showGridLines={showGridLines}
        className="h-48"
      />
    </Card>
  )
}

export default BarChart
