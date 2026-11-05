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
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'
import type { LineChartProps } from './LineChart'

type ImplProps = Pick<
  LineChartProps,
  | 'data'
  | 'index'
  | 'categories'
  | 'colors'
  | 'showArea'
  | 'valueFormatter'
  | 'showLegend'
  | 'showGridLines'
  | 'curveType'
  | 'connectNulls'
  | 'categoryLabels'
> & {
  valueFormatter: (value: number) => string
}

export default function LineChartImpl({
  data,
  index,
  categories,
  colors,
  showArea = false,
  valueFormatter,
  showLegend = true,
  showGridLines = true,
  curveType = 'monotone',
  connectNulls = true,
  categoryLabels,
}: ImplProps) {
  const getLineColor = (idx: number): string => resolveChartColor(colors?.[idx], idx)
  const ChartComponent = showArea ? RechartsAreaChart : RechartsLineChart

  return (
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
  )
}
