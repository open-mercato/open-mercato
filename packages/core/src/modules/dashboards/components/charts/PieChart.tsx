"use client"

import * as React from 'react'
import { Card, Title, DonutChart } from '@tremor/react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export type PieChartDataItem = {
  name: string
  value: number
}

export type PieChartProps = {
  title?: string
  data: PieChartDataItem[]
  loading?: boolean
  error?: string | null
  colors?: string[]
  variant?: 'pie' | 'donut'
  valueFormatter?: (value: number) => string
  showLabel?: boolean
  showTooltip?: boolean
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

export function PieChart({
  title,
  data,
  loading,
  error,
  colors,
  variant = 'donut',
  valueFormatter = defaultValueFormatter,
  showLabel = true,
  showTooltip = true,
  className = '',
  emptyMessage = 'No data available',
}: PieChartProps) {
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
      <DonutChart
        data={data}
        category="value"
        index="name"
        colors={colors as any}
        valueFormatter={valueFormatter}
        label={showLabel ? undefined : ''}
        showTooltip={showTooltip}
        variant={variant}
        className="h-48"
      />
    </Card>
  )
}

export default PieChart
