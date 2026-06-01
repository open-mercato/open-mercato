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
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'
import type { PieChartProps } from './PieChart'

type ImplProps = Pick<
  PieChartProps,
  'data' | 'colors' | 'variant' | 'valueFormatter' | 'showLabel' | 'showTooltip'
> & {
  valueFormatter: (value: number) => string
  total: number
}

export default function PieChartImpl({
  data,
  colors,
  variant = 'donut',
  valueFormatter,
  showLabel = true,
  showTooltip = true,
  total,
}: ImplProps) {
  const getSliceColor = (idx: number): string => resolveChartColor(colors?.[idx], idx)
  const innerRadius = variant === 'donut' ? '60%' : 0
  const outerRadius = '80%'

  return (
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
  )
}
