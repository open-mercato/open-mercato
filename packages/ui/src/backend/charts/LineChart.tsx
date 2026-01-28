"use client"

import * as React from 'react'
import {
  LineChart as RechartsLineChart,
  AreaChart as RechartsAreaChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'

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
  categoryLabels,
}: LineChartProps) {
  const getLineColor = (idx: number): string => {
    return resolveChartColor(colors?.[idx], idx)
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

  const ChartComponent = showArea ? RechartsAreaChart : RechartsLineChart

  return (
    <div className={`rounded-lg border bg-card p-4 ${className}`}>
      {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent
            data={data}
            margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          >
            {showGridLines && (
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
            )}
            <XAxis
              dataKey={index}
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={valueFormatter}
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              content={<ChartTooltipContent valueFormatter={valueFormatter} categoryLabels={categoryLabels} />}
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
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
            {showArea
              ? categories.map((category, idx) => (
                  <Area
                    key={category}
                    type={curveType}
                    dataKey={category}
                    stroke={getLineColor(idx)}
                    fill={getLineColor(idx)}
                    fillOpacity={0.2}
                    strokeWidth={2}
                    connectNulls={connectNulls}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                ))
              : categories.map((category, idx) => (
                  <Line
                    key={category}
                    type={curveType}
                    dataKey={category}
                    stroke={getLineColor(idx)}
                    strokeWidth={2}
                    connectNulls={connectNulls}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                ))}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default LineChart
