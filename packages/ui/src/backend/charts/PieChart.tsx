"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { resolveChartColor } from './ChartUtils'

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

const PieChartImpl = dynamic(() => import('./PieChartImpl'), {
  ssr: false,
  loading: () => (
    <div className="flex h-48 items-center justify-center">
      <Spinner className="h-6 w-6 text-muted-foreground" />
    </div>
  ),
})

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

  return (
    <div className={wrapperClass}>
      {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      <div className="h-48 w-full">
        <PieChartImpl
          data={data}
          colors={colors}
          variant={variant}
          valueFormatter={valueFormatter}
          showLabel={showLabel}
          showTooltip={showTooltip}
          total={total}
        />
      </div>
      <ul className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1.5">
        {data.map((item, idx) => (
          <li key={`${item.name}-${idx}`} className="flex min-w-0 items-center gap-1.5">
            <span
              className="size-2.5 flex-none rounded-sm"
              style={{ backgroundColor: resolveChartColor(colors?.[idx], idx) }}
              aria-hidden="true"
            />
            <span className="max-w-40 truncate text-xs text-muted-foreground" title={item.name}>{item.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default PieChart
