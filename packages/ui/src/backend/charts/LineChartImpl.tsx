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
  Legend,
  ResponsiveContainer,
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
  | 'axisValueFormatter'
  | 'showLegend'
  | 'showGridLines'
  | 'curveType'
  | 'connectNulls'
  | 'categoryLabels'
  | 'animate'
  | 'areaOpacity'
  | 'accessibilityLayer'
> & {
  valueFormatter: (value: number) => string
}

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' }

export default function LineChartImpl({
  data,
  index,
  categories,
  colors,
  showArea = false,
  valueFormatter,
  axisValueFormatter,
  showLegend = true,
  showGridLines = true,
  curveType = 'monotone',
  connectNulls = true,
  categoryLabels,
  animate = true,
  areaOpacity = 0.2,
  accessibilityLayer = true,
}: ImplProps) {
  const gradientId = React.useId().replace(/:/g, '')
  const getLineColor = (idx: number): string => resolveChartColor(colors?.[idx], idx)
  const ChartComponent = showArea ? RechartsAreaChart : RechartsLineChart
  // Recharts calls tickFormatter(value, index); shield formatters whose second
  // parameter means something else (e.g. a currency symbol) from the index.
  const formatTick = (value: number) => (axisValueFormatter ?? valueFormatter)(value)

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ChartComponent
        data={data}
        margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        accessibilityLayer={accessibilityLayer}
      >
        {showArea ? (
          <defs>
            {categories.map((category, idx) => (
              <linearGradient key={category} id={`${gradientId}-${idx}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={getLineColor(idx)} stopOpacity={0.25} />
                <stop offset="100%" stopColor={getLineColor(idx)} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
        ) : null}
        {showGridLines && (
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeOpacity={0.7}
          />
        )}
        <XAxis
          dataKey={index}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={formatTick}
          allowDecimals={false}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={56}
        />
        <Tooltip
          content={<ChartTooltipContent valueFormatter={valueFormatter} categoryLabels={categoryLabels} />}
          cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.35 }}
        />
        {showLegend && categories.length > 1 && (
          <Legend
            verticalAlign="top"
            height={36}
            iconType="circle"
            iconSize={8}
            formatter={(value) => (
              <span style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>{value}</span>
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
                fill={`url(#${gradientId}-${idx})`}
                fillOpacity={Math.min(1, areaOpacity / 0.2)}
                strokeWidth={2}
                strokeLinecap="round"
                connectNulls={connectNulls}
                isAnimationActive={animate}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
              />
            ))
          : categories.map((category, idx) => (
              <Line
                key={category}
                type={curveType}
                dataKey={category}
                stroke={getLineColor(idx)}
                strokeWidth={2}
                strokeLinecap="round"
                connectNulls={connectNulls}
                isAnimationActive={animate}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
              />
            ))}
      </ChartComponent>
    </ResponsiveContainer>
  )
}
