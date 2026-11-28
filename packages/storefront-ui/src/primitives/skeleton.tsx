import * as React from 'react'
import { cn } from '../lib/cn'

export type SkeletonProps = React.ComponentPropsWithoutRef<'div'> & {
  shape?: 'text' | 'rect' | 'circle' | 'tile'
  /** Number of text lines when `shape="text"`; the last line is shorter. */
  lines?: number
}

/** Loading placeholder. Decorative: the loading container announces `aria-busy`, not the skeleton. */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { shape = 'rect', lines = 1, className, style, ...props },
  ref,
) {
  const pulse = 'animate-pulse bg-muted motion-reduce:animate-none'
  if (shape === 'text') {
    return (
      <div ref={ref} data-slot="skeleton" aria-hidden="true" className={cn('flex flex-col gap-2', className)} {...props}>
        {Array.from({ length: lines }, (_, index) => (
          <div key={index} className={cn(pulse, 'h-4 rounded-sm', index === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')} />
        ))}
      </div>
    )
  }
  return (
    <div
      ref={ref}
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        pulse,
        shape === 'circle' && 'rounded-full',
        shape === 'rect' && 'rounded-sf-field',
        shape === 'tile' && 'w-full rounded-sf-tile',
        className,
      )}
      style={shape === 'tile' ? { aspectRatio: 'var(--sf-image-ratio-product)', ...style } : style}
      {...props}
    />
  )
})
