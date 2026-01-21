"use client"

import * as React from 'react'
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ChartTooltipContent, CHART_COLORS } from './ChartUtils'

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
  const getBarColor = (idx: number): string => {
    if (colors?.[idx]) {
      return `var(--color-${colors[idx]}-500)`
    }
    return CHART_COLORS[idx % CHART_COLORS.length]
  }

  if (error) {
    return (
      <div className={`rounded-lg border bg-card p-4 ${className}`}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={`rounded-lg border bg-card p-4 ${className}`}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className={`rounded-lg border bg-card p-4 ${className}`}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      </div>
    )
  }

  const isHorizontal = layout === 'horizontal'

  return (
    <div className={`rounded-lg border bg-card p-4 ${className}`}>
      {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsBarChart
            data={data}
            layout={isHorizontal ? 'vertical' : 'horizontal'}
            margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          >
            {showGridLines && (
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={!isHorizontal}
                horizontal={isHorizontal}
                stroke="hsl(var(--border))"
              />
            )}
            {isHorizontal ? (
              <>
                <XAxis
                  type="number"
                  tickFormatter={valueFormatter}
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  dataKey={index}
                  type="category"
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  width={80}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey={index}
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={valueFormatter}
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
              </>
            )}
            <Tooltip
              content={<ChartTooltipContent valueFormatter={valueFormatter} />}
              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }}
            />
            {showLegend && categories.length > 1 && (
              <Legend
                verticalAlign="top"
                height={36}
                formatter={(value) => (
                  <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: '12px' }}>{value}</span>
                )}
              />
            )}
            {categories.map((category, idx) => (
              <Bar
                key={category}
                dataKey={category}
                fill={getBarColor(idx)}
                radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              />
            ))}
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default BarChart
