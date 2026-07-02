"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'

export type SegmentOption<T extends string> = { value: T; label: string; icon?: React.ReactNode }

export function SegmentGroup<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  ariaLabel,
  fullWidth = false,
  variant = 'outline',
}: {
  options: Array<SegmentOption<T>>
  value: T
  onChange(next: T): void
  size?: 'sm' | 'md'
  ariaLabel: string
  /** Stretch across the container with equal-width, centered segments. */
  fullWidth?: boolean
  /**
   * 'outline' — joined bordered segments (type switcher).
   * 'inset' — muted track with a raised active thumb (iOS/Linear style); icons
   *   keep their own semantic colors.
   */
  variant?: 'outline' | 'inset'
}) {
  const inset = variant === 'inset'
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'max-w-full items-center',
        inset ? 'gap-1 rounded-lg bg-muted p-1' : 'items-start rounded-md border border-border bg-background',
        fullWidth ? 'flex w-full' : 'inline-flex overflow-x-auto',
      )}
    >
      {options.map((option, index) => {
        const isActive = option.value === value
        return (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-auto gap-1.5 border-0 text-sm font-medium leading-5',
              size === 'md' ? 'px-4 py-1.5' : 'px-3.5 py-1.5',
              fullWidth && 'flex-1 justify-center',
              inset
                ? cn(
                    'rounded-md shadow-none transition-colors',
                    isActive
                      ? 'bg-background text-foreground shadow-sm hover:bg-background'
                      : 'bg-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  )
                : cn(
                    'rounded-none shadow-none',
                    index > 0 && 'border-l border-border',
                    isActive ? 'bg-muted text-foreground hover:bg-muted' : 'bg-background text-muted-foreground',
                  ),
            )}
          >
            {option.icon ? (
              <span aria-hidden className={cn('shrink-0', !inset && 'opacity-70')}>{option.icon}</span>
            ) : null}
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}
