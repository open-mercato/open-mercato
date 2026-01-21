"use client"

import * as React from 'react'

export type ChartConfig = {
  [key: string]: {
    label?: string
    color?: string
  }
}

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

export function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) {
    throw new Error('useChart must be used within a ChartContainer')
  }
  return context
}

interface ChartContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  config: ChartConfig
  children: React.ReactNode
}

export function ChartContainer({
  config,
  children,
  className,
  ...props
}: ChartContainerProps) {
  const configId = React.useId()

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={configId}
        className={className}
        {...props}
        style={
          {
            ...props.style,
            '--color-chart-1': 'var(--chart-1)',
            '--color-chart-2': 'var(--chart-2)',
            '--color-chart-3': 'var(--chart-3)',
            '--color-chart-4': 'var(--chart-4)',
            '--color-chart-5': 'var(--chart-5)',
            ...Object.entries(config).reduce(
              (acc, [key, value]) => {
                if (value.color) {
                  acc[`--color-${key}`] = value.color
                }
                return acc
              },
              {} as Record<string, string>
            ),
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </ChartContext.Provider>
  )
}

interface ChartTooltipContentProps {
  active?: boolean
  payload?: Array<{
    name: string
    value: number
    color?: string
    dataKey?: string
    payload?: Record<string, unknown>
  }>
  label?: string
  labelFormatter?: (label: string, payload: unknown[]) => React.ReactNode
  valueFormatter?: (value: number) => string
  hideLabel?: boolean
  indicator?: 'line' | 'dot' | 'dashed'
  nameKey?: string
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter = (value) => value.toLocaleString(),
  hideLabel = false,
  indicator = 'dot',
  nameKey,
}: ChartTooltipContentProps) {
  if (!active || !payload?.length) {
    return null
  }

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      {!hideLabel && label && (
        <div className="mb-1 text-sm font-medium">
          {labelFormatter ? labelFormatter(label, payload) : label}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((item, index) => {
          const name = nameKey && item.payload ? String(item.payload[nameKey]) : item.name
          return (
            <div key={index} className="flex items-center justify-between gap-8">
              <div className="flex items-center gap-2">
                {indicator === 'dot' && (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                )}
                {indicator === 'line' && (
                  <span
                    className="h-0.5 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                )}
                {indicator === 'dashed' && (
                  <span
                    className="h-0.5 w-3 shrink-0 rounded-full border-t-2 border-dashed"
                    style={{ borderColor: item.color }}
                  />
                )}
                <span className="text-sm text-muted-foreground">{name}</span>
              </div>
              <span className="text-sm font-medium tabular-nums">
                {valueFormatter(item.value)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
] as const

export function getChartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]
}
