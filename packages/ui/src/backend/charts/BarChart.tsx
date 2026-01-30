"use client"

import * as React from 'react'
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'

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
  const getBarColor = (idx: number): string => {
    return resolveChartColor(colors?.[idx], idx)
  }

  const hasWrapper = !!title
  const wrapperClass = hasWrapper ? `rounded-lg border bg-card p-4 ${className}` : className

  if (error) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      </div>
    )
  }

  const isHorizontal = layout === 'horizontal'
  const chartHeight = isHorizontal ? Math.max(200, data.length * 28) : 200

  const chartContent = (
    <ResponsiveContainer width="100%" height={chartHeight}>
        <RechartsBarChart
          data={data}
          layout={isHorizontal ? 'vertical' : 'horizontal'}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          {showGridLines && (
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          )}
          <XAxis
            type={isHorizontal ? 'number' : 'category'}
            dataKey={isHorizontal ? undefined : index}
            tickFormatter={isHorizontal ? valueFormatter : undefined}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            type={isHorizontal ? 'category' : 'number'}
            dataKey={isHorizontal ? index : undefined}
            tickFormatter={isHorizontal ? undefined : valueFormatter}
            width={isHorizontal ? 90 : 50}
            interval={0}
            tick={{ fontSize: 10 }}
          />
          <Tooltip
            content={
              <ChartTooltipContent
                valueFormatter={valueFormatter}
                categoryLabels={categoryLabels}
                labelFormatter={(label, payload) => {
                  const entry = payload?.[0] as { payload?: BarChartDataItem } | undefined
                  const item = entry?.payload
                  return item?.[index] ? String(item[index]) : label
                }}
              />
            }
            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
          />
          {showLegend && categories.length > 1 && (
            <Legend verticalAlign="top" height={36} />
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
  )

  return (
    <div className={wrapperClass}>
      {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      {chartContent}
    </div>
  )
}

export default BarChart
