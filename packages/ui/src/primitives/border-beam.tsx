"use client"

import * as React from 'react'
import { Slot, Slottable } from '@radix-ui/react-slot'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Decorative light that travels along a container border. Use it to draw
 * attention to an AI module, a sign-in panel or one recommended card. It is
 * decoration only: it never replaces focus rings, validation borders or
 * status colors, and it is hidden when the user prefers reduced motion.
 *
 * The beam follows the container radius, so give the container its own
 * `rounded-*` class. With `asChild` the beam is drawn inside the single
 * child (for example a `Card`) instead of an extra wrapper.
 *
 * ```tsx
 * <BorderBeam className="rounded-card border border-border bg-card p-6">...</BorderBeam>
 * <BorderBeam asChild trigger="hover" count={2}><Card>...</Card></BorderBeam>
 * ```
 */

export type BorderBeamColorStop = { color: string; percent: number }
export type BorderBeamColor = string | BorderBeamColorStop[]
export type BorderBeamLength = number | string

export type BorderBeamItem = {
  color?: BorderBeamColor
  size?: BorderBeamLength
  lineWidth?: BorderBeamLength
  outset?: BorderBeamLength
}

export type BorderBeamProps = React.HTMLAttributes<HTMLDivElement> & {
  asChild?: boolean
  color?: BorderBeamColor
  size?: BorderBeamLength
  lineWidth?: BorderBeamLength
  outset?: BorderBeamLength
  duration?: number
  count?: number
  items?: BorderBeamItem[]
  trigger?: 'always' | 'hover'
}

const DEFAULT_COLOR = 'var(--accent-indigo)'
const DEFAULT_SIZE = 100
const DEFAULT_LINE_WIDTH = 1
const DEFAULT_DURATION = 6
const TAIL_FADE_PERCENT = 20

function toLength(value: BorderBeamLength): string {
  return typeof value === 'number' ? `${value}px` : value
}

export function borderBeamGradient(color: BorderBeamColor): string {
  if (typeof color === 'string') return `linear-gradient(to right, transparent, ${color})`
  const span = 100 - TAIL_FADE_PERCENT
  const stops = color
    .slice()
    .sort((left, right) => left.percent - right.percent)
    .map((stop) => `${stop.color} ${TAIL_FADE_PERCENT + (Math.min(Math.max(stop.percent, 0), 100) * span) / 100}%`)
  return `linear-gradient(to right, transparent, ${stops.join(', ')})`
}

export function resolveBorderBeamItems(count: number | undefined, items: BorderBeamItem[] | undefined): BorderBeamItem[] {
  if (items && items.length > 0) return items
  const total = Number.isInteger(count) && (count ?? 0) > 0 ? (count as number) : 1
  return Array.from({ length: total }, () => ({}))
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type BeamProps = {
  item: BorderBeamItem
  defaults: Required<Pick<BorderBeamItem, 'color' | 'size' | 'lineWidth'>> & { outset?: BorderBeamLength }
  radius: string
  duration: number
  phase: number
}

function Beam({ item, defaults, radius, duration, phase }: BeamProps) {
  const beamRef = React.useRef<HTMLSpanElement>(null)
  const lineWidth = toLength(item.lineWidth ?? defaults.lineWidth)
  const size = toLength(item.size ?? defaults.size)
  const outsetValue = item.outset ?? defaults.outset
  const inset = outsetValue === undefined ? '0px' : `calc(-1 * ${toLength(outsetValue)})`

  React.useEffect(() => {
    const element = beamRef.current
    if (!element || typeof element.animate !== 'function' || prefersReducedMotion()) return
    const durationMs = Math.max(duration, 0.1) * 1000
    const animation = element.animate([{ offsetDistance: '0%' }, { offsetDistance: '100%' }], {
      duration: durationMs,
      iterations: Infinity,
      delay: -durationMs * phase,
      easing: 'linear',
    })
    return () => animation.cancel()
  }, [duration, phase])

  return (
    <span
      aria-hidden="true"
      data-slot="border-beam-layer"
      className="pointer-events-none absolute motion-reduce:hidden"
      style={{
        inset,
        borderRadius: 'inherit',
        borderWidth: lineWidth,
        borderStyle: 'solid',
        borderColor: 'transparent',
        mask: 'linear-gradient(transparent, transparent) padding-box, linear-gradient(black, black) border-box',
        maskComposite: 'intersect',
        WebkitMaskComposite: 'source-in',
      }}
    >
      <span
        ref={beamRef}
        data-slot="border-beam-beam"
        className="absolute aspect-square"
        style={{
          width: size,
          background: borderBeamGradient(item.color ?? defaults.color),
          offsetPath: `rect(0 auto auto 0 round ${radius})`,
          offsetAnchor: '90% 50%',
          offsetDistance: `${phase * 100}%`,
        }}
      />
    </span>
  )
}

export const BorderBeam = React.forwardRef<HTMLDivElement, BorderBeamProps>(function BorderBeam(
  {
    asChild = false,
    color = DEFAULT_COLOR,
    size = DEFAULT_SIZE,
    lineWidth = DEFAULT_LINE_WIDTH,
    outset,
    duration = DEFAULT_DURATION,
    count,
    items,
    trigger = 'always',
    className,
    children,
    ...props
  },
  forwardedRef,
) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [radius, setRadius] = React.useState('0px')
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [forwardedRef],
  )

  React.useLayoutEffect(() => {
    const node = containerRef.current
    if (!node || typeof window === 'undefined') return
    const read = () => setRadius(window.getComputedStyle(node).borderTopLeftRadius || '0px')
    read()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const beams = resolveBorderBeamItems(count, items)
  const defaults = { color, size, lineWidth, outset }
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      ref={setRefs}
      data-slot="border-beam"
      data-trigger={trigger}
      className={cn('relative', trigger === 'hover' && 'group/border-beam', className)}
      {...props}
    >
      <Slottable>{children}</Slottable>
      <span
        aria-hidden="true"
        data-slot="border-beam-beams"
        className={cn(
          'pointer-events-none absolute inset-0',
          trigger === 'hover' && 'opacity-0 transition-opacity duration-300 group-hover/border-beam:opacity-100 group-focus-within/border-beam:opacity-100',
        )}
        style={{ borderRadius: 'inherit' }}
      >
        {beams.map((item, index) => (
          <Beam key={index} item={item} defaults={defaults} radius={radius} duration={duration} phase={index / beams.length} />
        ))}
      </span>
    </Comp>
  )
})
