"use client"

import * as React from 'react'
import { Card, Title, LineChart as TremorLineChart, AreaChart as TremorAreaChart } from '@tremor/react'
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
}: LineChartProps) {
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

  const ChartComponent = showArea ? TremorAreaChart : TremorLineChart

  return (
    <Card className={className}>
      {title && <Title className="mb-4">{title}</Title>}
      <ChartComponent
        data={data}
        index={index}
        categories={categories}
        colors={colors as any}
        valueFormatter={valueFormatter}
        showLegend={showLegend}
        showGridLines={showGridLines}
        curveType={curveType}
        connectNulls={connectNulls}
        className="h-48"
      />
    </Card>
  )
}

export default LineChart
