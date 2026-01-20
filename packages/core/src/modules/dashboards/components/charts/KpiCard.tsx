"use client"

import * as React from 'react'
import { Card, Metric, Text, BadgeDelta } from '@tremor/react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export type KpiTrend = {
  value: number
  direction: 'up' | 'down' | 'unchanged'
}

export type KpiCardProps = {
  title: string
  value: number | null
  trend?: KpiTrend
  loading?: boolean
  error?: string | null
  formatValue?: (value: number) => string
  prefix?: string
  suffix?: string
  className?: string
}

function defaultFormatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatPercentageChange(value: number): string {
  const formatted = Math.abs(value).toFixed(1)
  return `${formatted}%`
}

function mapDirectionToDeltaType(direction: 'up' | 'down' | 'unchanged'): 'increase' | 'decrease' | 'unchanged' {
  if (direction === 'up') return 'increase'
  if (direction === 'down') return 'decrease'
  return 'unchanged'
}

export function KpiCard({
  title,
  value,
  trend,
  loading,
  error,
  formatValue = defaultFormatValue,
  prefix = '',
  suffix = '',
  className = '',
}: KpiCardProps) {
  if (error) {
    return (
      <Card className={`${className}`}>
        <Text className="text-sm text-muted-foreground">{title}</Text>
        <div className="mt-2">
          <Text className="text-sm text-destructive">{error}</Text>
        </div>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card className={`${className}`}>
        <Text className="text-sm text-muted-foreground">{title}</Text>
        <div className="mt-4 flex items-center justify-center">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      </Card>
    )
  }

  if (value === null) {
    return (
      <Card className={`${className}`}>
        <Text className="text-sm text-muted-foreground">{title}</Text>
        <Metric className="mt-2">--</Metric>
      </Card>
    )
  }

  return (
    <Card className={`${className}`}>
      <Text className="text-sm text-muted-foreground">{title}</Text>
      <div className="mt-2 flex items-baseline gap-2">
        <Metric>
          {prefix}
          {formatValue(value)}
          {suffix}
        </Metric>
        {trend && (
          <BadgeDelta
            deltaType={mapDirectionToDeltaType(trend.direction)}
            size="sm"
          >
            {formatPercentageChange(trend.value)}
          </BadgeDelta>
        )}
      </div>
    </Card>
  )
}

export default KpiCard
