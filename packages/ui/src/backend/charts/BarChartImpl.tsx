"use client"

import * as React from 'react'
import {
  BarChart as RechartsBarChart,
  Bar,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'
import type { BarChartDataItem, BarChartProps } from './BarChart'

type ImplProps = Pick<
  BarChartProps,
  | 'data'
  | 'index'
  | 'categories'
  | 'colors'
  | 'layout'
  | 'valueFormatter'
  | 'axisValueFormatter'
  | 'showLegend'
  | 'showGridLines'
  | 'categoryLabels'
  | 'animate'
  | 'accessibilityLayer'
  | 'highlight'
> & {
  valueFormatter: (value: number) => string
  /** Fill the host element instead of the fixed default height (bare mode). */
  fillHeight?: boolean
}

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' }
const CATEGORY_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' }

export default function BarChartImpl({
  data,
  index,
  categories,
  colors,
  layout = 'vertical',
  valueFormatter,
  axisValueFormatter,
  showLegend = true,
  showGridLines = true,
  categoryLabels,
  animate = true,
  accessibilityLayer = true,
  fillHeight = false,
  highlight,
}: ImplProps) {
  const isHorizontal = layout === 'horizontal'
  const chartHeight = isHorizontal ? Math.max(200, data.length * 36) : 200
  const getBarColor = (idx: number): string => resolveChartColor(colors?.[idx], idx)
  // Recharts calls tickFormatter(value, index); shield formatters whose second
  // parameter means something else (e.g. a currency symbol) from the index.
  const formatTick = (value: number) => (axisValueFormatter ?? valueFormatter)(value)
  // Selective emphasis: one bar keeps the series color, the rest fade to a
  // quiet tint of the same hue. Single-series charts only.
  const highlightIndex = React.useMemo(() => {
    if (!highlight || categories.length !== 1 || data.length < 2) return null
    if (highlight === 'last') return data.length - 1
    let bestIndex = 0
    let bestValue = Number.NEGATIVE_INFINITY
    data.forEach((item, itemIndex) => {
      const value = Number(item[categories[0]] ?? Number.NEGATIVE_INFINITY)
      if (Number.isFinite(value) && value > bestValue) {
        bestValue = value
        bestIndex = itemIndex
      }
    })
    return bestIndex
  }, [categories, data, highlight])

  const renderHighlightLabel = React.useCallback((rawProps: unknown) => {
    const props = rawProps as { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string; index?: number }
    if (highlightIndex === null || props.index !== highlightIndex) return null
    const x = Number(props.x ?? 0)
    const y = Number(props.y ?? 0)
    const width = Number(props.width ?? 0)
    const height = Number(props.height ?? 0)
    const numeric = Number(props.value)
    if (!Number.isFinite(numeric)) return null
    const label = valueFormatter(numeric)
    if (isHorizontal) {
      return (
        <text x={x + width + 6} y={y + height / 2} dominantBaseline="central" fontSize={11} fontWeight={600} fill="var(--foreground)">
          {label}
        </text>
      )
    }
    return (
      <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--foreground)">
        {label}
      </text>
    )
  }, [highlightIndex, isHorizontal, valueFormatter])

  return (
    <ResponsiveContainer width="100%" height={fillHeight ? '100%' : chartHeight}>
      <RechartsBarChart
        data={data}
        layout={isHorizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        accessibilityLayer={accessibilityLayer}
        barCategoryGap="24%"
      >
        {showGridLines && (
          <CartesianGrid
            horizontal={!isHorizontal}
            vertical={isHorizontal}
            stroke="var(--border)"
            strokeOpacity={0.7}
          />
        )}
        <XAxis
          type={isHorizontal ? 'number' : 'category'}
          dataKey={isHorizontal ? undefined : index}
          tickFormatter={isHorizontal ? formatTick : undefined}
          allowDecimals={false}
          tick={isHorizontal ? AXIS_TICK : CATEGORY_TICK}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          type={isHorizontal ? 'category' : 'number'}
          dataKey={isHorizontal ? index : undefined}
          tickFormatter={isHorizontal ? undefined : formatTick}
          allowDecimals={false}
          width={isHorizontal ? 90 : 50}
          interval={0}
          tick={isHorizontal ? CATEGORY_TICK : AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickMargin={6}
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
          cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
        />
        {showLegend && categories.length > 1 && (
          <Legend verticalAlign="top" height={36} iconType="circle" iconSize={8} />
        )}
        {categories.map((category, idx) => (
          <Bar
            key={category}
            dataKey={category}
            fill={getBarColor(idx)}
            maxBarSize={28}
            radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            isAnimationActive={animate}
          >
            {highlightIndex !== null
              ? data.map((entry, itemIndex) => (
                  <Cell key={`cell-${itemIndex}`} fillOpacity={itemIndex === highlightIndex ? 1 : 0.3} />
                ))
              : null}
            {highlightIndex !== null ? <LabelList dataKey={category} content={renderHighlightLabel} /> : null}
          </Bar>
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  )
}
