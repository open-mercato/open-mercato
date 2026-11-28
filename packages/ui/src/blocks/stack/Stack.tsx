import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { InlineProps, LayoutGap, StackProps } from '../contracts/stack'

const GAP_CLASSES: Record<LayoutGap, string> = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
  8: 'gap-8',
  10: 'gap-10',
  12: 'gap-12',
}

const ALIGN_CLASSES = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
} as const

const JUSTIFY_CLASSES = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
} as const

type Direction = 'column' | 'row'

function renderFlex(direction: Direction, props: StackProps) {
  const { gap = 3, align, justify, wrap, className, children } = props
  return (
    <div
      data-slot={direction === 'column' ? 'stack' : 'inline'}
      className={cn(
        'flex',
        direction === 'column' ? 'flex-col' : 'flex-row',
        GAP_CLASSES[gap],
        align && ALIGN_CLASSES[align],
        justify && JUSTIFY_CLASSES[justify],
        wrap && 'flex-wrap',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Stack(props: StackProps) {
  return renderFlex('column', props)
}

export function Inline(props: InlineProps) {
  return renderFlex('row', props)
}
