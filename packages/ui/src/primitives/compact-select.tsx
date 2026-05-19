"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  type SelectTriggerProps,
} from './select'

export type CompactSelectTriggerProps = Omit<SelectTriggerProps, 'size'> & {
  /**
   * Optional inline prefix rendered before the selected value, e.g. `View:` or
   * `Sort by:`. Renders in muted style and shrinks before the value text.
   */
  triggerLabel?: React.ReactNode
}

export const CompactSelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectTrigger>,
  CompactSelectTriggerProps
>(({ triggerLabel, children, className, ...props }, ref) => (
  <SelectTrigger
    ref={ref}
    size="xs"
    className={cn(className)}
    data-slot="compact-select-trigger"
    {...props}
  >
    {triggerLabel ? (
      <span
        className="shrink-0 text-xs font-medium text-muted-foreground"
        data-slot="compact-select-trigger-label"
      >
        {triggerLabel}
      </span>
    ) : null}
    {children}
  </SelectTrigger>
))
CompactSelectTrigger.displayName = 'CompactSelectTrigger'

// Re-export the rest of the Select API so consumers can import the entire
// compact-select composition from one path.
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectValue,
}
