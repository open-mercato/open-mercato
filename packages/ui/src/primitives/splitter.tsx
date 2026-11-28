"use client"

import * as React from 'react'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Resizable panels separated by drag handles. Sizes are percentages of the
 * container. Each handle is a focusable `separator`: arrow keys move it by
 * `keyboardStep`, Home and End jump to the limits of the panel before it.
 *
 * ```tsx
 * <Splitter className="h-96 rounded-card border border-border">
 *   <SplitterPanel defaultSize={30} minSize={20}>List</SplitterPanel>
 *   <SplitterPanel>Preview</SplitterPanel>
 * </Splitter>
 * ```
 */

export type SplitterOrientation = 'horizontal' | 'vertical'

export type SplitterPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  defaultSize?: number
  minSize?: number
  maxSize?: number
}

export type SplitterProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'onResize'> & {
  orientation?: SplitterOrientation
  keyboardStep?: number
  onResize?: (sizes: number[]) => void
  onResizeEnd?: (sizes: number[]) => void
  handleLabel?: string
}

type PanelLimits = { min: number; max: number }

export function SplitterPanel({ className, defaultSize: _defaultSize, minSize: _minSize, maxSize: _maxSize, ...props }: SplitterPanelProps) {
  return <div data-slot="splitter-panel" className={cn('min-h-0 min-w-0 overflow-auto', className)} {...props} />
}

export function initialSplitterSizes(defaults: Array<number | undefined>): number[] {
  const fixed = defaults.reduce<number>((sum, size) => sum + (size ?? 0), 0)
  const open = defaults.filter((size) => size === undefined).length
  const share = open > 0 ? Math.max(100 - fixed, 0) / open : 0
  const sizes = defaults.map((size) => size ?? share)
  const total = sizes.reduce((sum, size) => sum + size, 0)
  return total > 0 ? sizes.map((size) => (size / total) * 100) : sizes.map(() => 100 / Math.max(sizes.length, 1))
}

export function resizeSplitterPair(sizes: number[], index: number, delta: number, limits: PanelLimits[]): number[] {
  const before = sizes[index]
  const after = sizes[index + 1]
  if (before === undefined || after === undefined) return sizes
  const pair = before + after
  const lower = Math.max(limits[index].min, pair - limits[index + 1].max)
  const upper = Math.min(limits[index].max, pair - limits[index + 1].min)
  const nextBefore = Math.min(Math.max(before + delta, lower), Math.max(lower, upper))
  if (nextBefore === before) return sizes
  const next = sizes.slice()
  next[index] = nextBefore
  next[index + 1] = pair - nextBefore
  return next
}

function isPanelElement(child: React.ReactNode): child is React.ReactElement<SplitterPanelProps> {
  return React.isValidElement(child) && child.type === SplitterPanel
}

export function Splitter({
  orientation = 'horizontal',
  keyboardStep = 5,
  onResize,
  onResizeEnd,
  handleLabel,
  className,
  children,
  ...props
}: SplitterProps) {
  const t = useT()
  const baseId = React.useId()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const panels = React.Children.toArray(children).filter(isPanelElement)
  const limits = panels.map<PanelLimits>((panel) => ({ min: panel.props.minSize ?? 0, max: panel.props.maxSize ?? 100 }))
  const defaultsKey = panels.map((panel) => panel.props.defaultSize ?? '').join('|')
  const [sizes, setSizes] = React.useState<number[]>(() => initialSplitterSizes(panels.map((panel) => panel.props.defaultSize)))
  const sizesRef = React.useRef(sizes)
  const [dragging, setDragging] = React.useState<number | null>(null)

  React.useEffect(() => {
    const defaults = defaultsKey.split('|').map((value) => (value === '' ? undefined : Number(value)))
    if (sizesRef.current.length === defaults.length) return
    const next = initialSplitterSizes(defaults)
    sizesRef.current = next
    setSizes(next)
  }, [defaultsKey])

  const commit = React.useCallback(
    (next: number[]) => {
      if (next === sizesRef.current) return
      sizesRef.current = next
      setSizes(next)
      onResize?.(next)
    },
    [onResize],
  )

  const horizontal = orientation === 'horizontal'
  const label = handleLabel ?? t('ui.splitter.handle.ariaLabel', 'Resize panels')

  const startDrag = (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container || event.button !== 0) return
    event.preventDefault()
    const rect = container.getBoundingClientRect()
    const extent = horizontal ? rect.width : rect.height
    if (extent <= 0) return
    const origin = horizontal ? event.clientX : event.clientY
    const startSizes = sizesRef.current
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    handle.focus()
    setDragging(index)
    const move = (moveEvent: PointerEvent) => {
      const position = horizontal ? moveEvent.clientX : moveEvent.clientY
      commit(resizeSplitterPair(startSizes, index, ((position - origin) / extent) * 100, limits))
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      setDragging(null)
      onResizeEnd?.(sizesRef.current)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  const onHandleKeyDown = (index: number) => (event: React.KeyboardEvent<HTMLDivElement>) => {
    const decrease = horizontal ? 'ArrowLeft' : 'ArrowUp'
    const increase = horizontal ? 'ArrowRight' : 'ArrowDown'
    let delta: number | null = null
    if (event.key === decrease) delta = -keyboardStep
    else if (event.key === increase) delta = keyboardStep
    else if (event.key === 'Home') delta = -100
    else if (event.key === 'End') delta = 100
    if (delta === null) return
    event.preventDefault()
    const next = resizeSplitterPair(sizesRef.current, index, delta, limits)
    commit(next)
    onResizeEnd?.(next)
  }

  const items: React.ReactNode[] = []
  panels.forEach((panel, index) => {
    const panelId = panel.props.id ?? `${baseId}-panel-${index}`
    items.push(
      React.cloneElement(panel, {
        key: `panel-${index}`,
        id: panelId,
        style: { ...panel.props.style, flexGrow: sizes[index] ?? 0, flexShrink: 1, flexBasis: 0 },
      }),
    )
    if (index < panels.length - 1) {
      const pairMax = Math.min(limits[index].max, (sizes[index] ?? 0) + (sizes[index + 1] ?? 0) - limits[index + 1].min)
      items.push(
        <div
          key={`handle-${index}`}
          role="separator"
          tabIndex={0}
          aria-label={label}
          aria-orientation={horizontal ? 'vertical' : 'horizontal'}
          aria-controls={panelId}
          aria-valuenow={Math.round(sizes[index] ?? 0)}
          aria-valuemin={Math.round(limits[index].min)}
          aria-valuemax={Math.round(pairMax)}
          data-slot="splitter-handle"
          data-dragging={dragging === index ? 'true' : undefined}
          onPointerDown={startDrag(index)}
          onKeyDown={onHandleKeyDown(index)}
          className={cn(
            'group/splitter-handle relative flex shrink-0 touch-none items-center justify-center outline-none focus-visible:shadow-focus',
            horizontal ? 'w-2 cursor-col-resize self-stretch' : 'h-2 cursor-row-resize',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'bg-border transition-colors group-hover/splitter-handle:bg-primary group-data-dragging/splitter-handle:bg-primary',
              horizontal ? 'h-full w-px' : 'h-px w-full',
            )}
          />
        </div>,
      )
    }
  })

  return (
    <div
      ref={containerRef}
      data-slot="splitter"
      data-orientation={orientation}
      className={cn('flex min-h-0 min-w-0', horizontal ? 'flex-row' : 'flex-col', dragging !== null && 'select-none', className)}
      {...props}
    >
      {items}
    </div>
  )
}
