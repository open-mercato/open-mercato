"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export type SkeletonShape = 'rect' | 'circle' | 'text'

export type SkeletonProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'role' | 'aria-busy'> & {
  /**
   * Visual shape of the placeholder.
   * - `'rect'` (default): rectangular block with `rounded-md`. Sized via `className`.
   * - `'circle'`: round placeholder for avatars / icons. Sized via `className` (typically `size-8`, `size-10`, `size-12`).
   * - `'text'`: multi-line text placeholder. Use `lines` to set how many lines.
   */
  shape?: SkeletonShape
  /**
   * Number of lines to render when `shape='text'`. Default `1`.
   * The last line is rendered narrower (`w-3/4`) to mimic natural text wrap.
   */
  lines?: number
}

const baseLine = 'animate-pulse rounded-md bg-muted'

export function Skeleton({
  shape = 'rect',
  lines = 1,
  className,
  ...rest
}: SkeletonProps) {
  if (shape === 'text') {
    const count = Math.max(1, lines)
    return (
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className={cn('w-full space-y-2', className)}
        data-slot="skeleton"
        {...rest}
      >
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className={cn(
              baseLine,
              'h-4',
              index === count - 1 && count > 1 ? 'w-3/4' : 'w-full',
            )}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-slot="skeleton"
      className={cn(
        baseLine,
        shape === 'circle' && 'rounded-full',
        className,
      )}
      {...rest}
    />
  )
}
