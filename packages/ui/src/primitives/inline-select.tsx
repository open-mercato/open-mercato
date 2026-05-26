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

export type InlineSelectTriggerProps = Omit<SelectTriggerProps, 'size'> & {
  /**
   * Trigger size. `sm` (h-8) is the default — inline editors are typically
   * embedded inside dense rows. Pass `'default'` (h-9) when the editor sits
   * alongside other h-9 controls.
   */
  size?: 'sm' | 'default'
  /**
   * Render a subtle trigger border on hover so the affordance is
   * discoverable. Default `true`. Set to `false` for editors that should
   * remain visually invisible until focused.
   */
  showBorderOnHover?: boolean
}

/**
 * Borderless variant of `SelectTrigger` — the select-typed counterpart to
 * `InlineInput`. At rest the trigger looks like plain text (transparent
 * border, transparent background, no shadow); hover reveals a subtle
 * border via `showBorderOnHover` (default `true`), and focus inherits the
 * standard `border-foreground` + focus shadow from the underlying
 * `SelectTrigger` for keyboard accessibility.
 *
 * Composes with the regular `Select` root + `SelectContent` /
 * `SelectItem` — `inline-select.tsx` re-exports the rest of the `Select`
 * API so consumers can import the entire composition from one path.
 */
export const InlineSelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectTrigger>,
  InlineSelectTriggerProps
>(({ className, size = 'sm', showBorderOnHover = true, children, ...props }, ref) => (
  <SelectTrigger
    ref={ref}
    size={size}
    className={cn(
      'border-transparent bg-transparent shadow-none',
      showBorderOnHover ? 'hover:border-input hover:bg-muted/40' : 'hover:bg-transparent',
      className,
    )}
    data-slot="inline-select-trigger"
    {...props}
  >
    {children}
  </SelectTrigger>
))
InlineSelectTrigger.displayName = 'InlineSelectTrigger'

// Re-export the rest of the Select API so consumers can import the entire
// inline-select composition from one path.
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectValue,
}
