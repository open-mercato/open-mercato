"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Input, type InputProps } from './input'

export type InlineInputProps = Omit<InputProps, 'size'> & {
  /**
   * Trigger size. `sm` (h-8) is the default — inline editors are typically
   * embedded inside dense rows. Pass `'default'` (h-9) when the editor sits
   * alongside other h-9 controls.
   */
  size?: 'sm' | 'default'
  /**
   * Render a subtle input border on hover so the affordance is discoverable.
   * Default `true`. Set to `false` for editors that should remain visually
   * invisible until focused (e.g. plain text cells inside read-only-looking
   * card layouts).
   */
  showBorderOnHover?: boolean
}

/**
 * Borderless variant of `Input`. At rest the field looks like plain text
 * (no border, no background, no shadow). Hover reveals a subtle border via
 * `showBorderOnHover` (default `true`); focus always reveals the standard
 * `border-foreground` + focus shadow inherited from the underlying `Input`
 * wrapper for accessibility.
 *
 * Forwards every `Input` prop (placeholder, value, onChange, type, etc.).
 * Consumers wire `onBlur` for the "save on blur" pattern typical of inline
 * editors.
 */
export const InlineInput = React.forwardRef<HTMLInputElement, InlineInputProps>(
  (
    { className, inputClassName, size = 'sm', showBorderOnHover = true, ...rest },
    ref,
  ) => {
    return (
      <Input
        ref={ref}
        size={size}
        className={cn(
          'border-transparent bg-transparent shadow-none',
          showBorderOnHover ? 'hover:border-input hover:bg-muted/40' : 'hover:bg-transparent',
          className,
        )}
        inputClassName={inputClassName}
        data-slot="inline-input"
        {...rest}
      />
    )
  },
)
InlineInput.displayName = 'InlineInput'
