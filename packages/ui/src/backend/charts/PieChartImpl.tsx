"use client"

import * as React from 'react'
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
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
          cy="50%"
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
              content={(props) => {
                const viewBox = props.viewBox
                const cx = viewBox && 'cx' in viewBox && typeof viewBox.cx === 'number' ? viewBox.cx : 0
                const cy = viewBox && 'cy' in viewBox && typeof viewBox.cy === 'number' ? viewBox.cy : 0
                return (
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-foreground text-2xl font-bold"
                  >
                    {valueFormatter(total)}
                  </text>
                )
              }}
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
      </RechartsPieChart>
    </ResponsiveContainer>
  )
}
