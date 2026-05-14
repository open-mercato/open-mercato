"use client"

import * as React from 'react'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'
import { inputWrapperVariants, inputElementVariants } from './input'

export type ButtonInputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'size'> &
  VariantProps<typeof inputWrapperVariants> & {
    /** Optional leading icon (decorative `aria-hidden` wrapper). */
    leftIcon?: React.ReactNode
    /**
     * Required interactive trailing element rendered inside the wrapper, after the vertical
     * divider. Typically an `<IconButton>` (copy URL, send, refresh). The slot stays focusable
     * and screen-reader accessible — do NOT pass a decorative icon here.
     */
    trailingAction: React.ReactNode
    /** Optional className on the wrapper. */
    className?: string
    /** Optional className on the inner `<input>`. */
    inputClassName?: string
  }

/**
 * Button input matching Figma `Text Input [1.1]` (node `266:5251`) **Button** variant — a text
 * input with an interactive trailing button slot, separated by a vertical divider. Built on the
 * shared `inputWrapperVariants` / `inputElementVariants` CVA so the visual contract matches the
 * foundation `Input` primitive.
 *
 * Common pairings: share-link + copy button, subscribe-email + send button, API key + regenerate
 * button. The trailing slot is rendered AS-IS (no auto-wrapping), so consumers control button
 * type, size, variant, and `aria-label` directly via the passed element.
 */
export const ButtonInput = React.forwardRef<HTMLInputElement, ButtonInputProps>(
  ({ className, inputClassName, size, leftIcon, trailingAction, disabled, ...props }, ref) => {
    return (
      <div
        className={cn(inputWrapperVariants({ size }), 'px-0 overflow-hidden', className)}
        data-slot="button-input-wrapper"
      >
        <div className="flex flex-1 min-w-0 items-center gap-2 pl-3 pr-2">
          {leftIcon ? (
            <span
              className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-4"
              aria-hidden="true"
            >
              {leftIcon}
            </span>
          ) : null}
          <input
            ref={ref}
            disabled={disabled}
            className={cn(
              inputElementVariants({ size }),
              inputClassName,
            )}
            {...props}
          />
        </div>
        <div aria-hidden="true" className="w-px self-stretch bg-input" />
        <div className="flex shrink-0 items-stretch">
          {trailingAction}
        </div>
      </div>
    )
  },
)
ButtonInput.displayName = 'ButtonInput'
