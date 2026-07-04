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
}: {
  options: Array<SegmentOption<T>>
  value: T
  onChange(next: T): void
  size?: 'sm' | 'md'
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex w-full items-stretch overflow-hidden rounded-md border border-border bg-background"
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
            title={option.label}
            className={cn(
              'h-auto min-w-0 flex-1 justify-center gap-1 rounded-none border-0 px-1.5 text-sm font-medium leading-5 shadow-none',
              size === 'md' ? 'py-2' : 'py-1.5',
              index > 0 && 'border-l border-border',
              isActive
                ? 'bg-accent-indigo text-accent-indigo-foreground hover:bg-accent-indigo'
                : 'bg-background text-muted-foreground',
            )}
          >
            {option.icon ? <span aria-hidden className={cn('shrink-0', isActive ? 'opacity-100' : 'opacity-70')}>{option.icon}</span> : null}
            <span className="truncate">{option.label}</span>
          </Button>
        )
      })}
    </div>
  )
}
