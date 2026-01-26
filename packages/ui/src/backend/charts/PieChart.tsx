"use client"

import * as React from 'react'
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Label,
} from 'recharts'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'

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
  const getSliceColor = (idx: number): string => {
    return resolveChartColor(colors?.[idx], idx)
  }

  const total = React.useMemo(() => {
    return data.reduce((sum, item) => sum + item.value, 0)
  }, [data])

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

  const innerRadius = variant === 'donut' ? '60%' : 0
  const outerRadius = '80%'

  return (
    <div className={wrapperClass}>
      {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsPieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="40%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((_, idx) => (
                <Cell key={`cell-${idx}`} fill={getSliceColor(idx)} />
              ))}
              {showLabel && variant === 'donut' && (
                <Label
                  value={valueFormatter(total)}
                  position="center"
                  className="fill-foreground text-2xl font-bold"
                />
              )}
            </Pie>
            {showTooltip && (
              <Tooltip
                content={
                  <ChartTooltipContent
                    valueFormatter={valueFormatter}
                    hideLabel
                  />
                }
              />
            )}
            <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value) => (
                <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: '12px' }}>{value}</span>
              )}
            />
          </RechartsPieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default PieChart
