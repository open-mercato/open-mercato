"use client"

import * as React from 'react'
import type { VariantProps } from 'class-variance-authority'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { inputWrapperVariants, inputElementVariants } from './input'

export type WebsiteInputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'size' | 'type'> &
  VariantProps<typeof inputWrapperVariants> & {
    /** Protocol shown in the left prefix box. Defaults to `'https://'` per Figma. */
    prefix?: string
    /** Hide the prefix box entirely (consumer wants a bare URL input). */
    showPrefix?: boolean
    /** Optional className on the wrapper. */
    className?: string
    /** Optional className on the inner `<input>`. */
    inputClassName?: string
  }

/**
 * Website input matching Figma `Text Input [1.1]` (node `266:5251`) **Website** variant — a left
 * prefix box with the protocol text (default `'https://'`), a vertical divider, then the URL text
 * input. Built on the shared `inputWrapperVariants` / `inputElementVariants` CVA so the visual
 * contract matches the foundation `Input` primitive.
 *
 * The prefix is **display-only** — the inner `<input>` value contains ONLY the host/path portion
 * (e.g. `'www.example.com/path'`). Compose the full URL at the consumer boundary if needed.
 */
export const WebsiteInput = React.forwardRef<HTMLInputElement, WebsiteInputProps>(
  ({ className, inputClassName, size, prefix = 'https://', showPrefix = true, placeholder, disabled, ...props }, ref) => {
    const t = useT()
    const resolvedPlaceholder = placeholder ?? t('ui.inputs.websiteInput.placeholder', 'www.example.com')
    return (
      <div
        className={cn(
          inputWrapperVariants({ size }),
          // Override default px so prefix box can sit flush left.
          'px-0 overflow-hidden',
          className,
        )}
        data-slot="website-input-wrapper"
      >
        {showPrefix ? (
          <>
            <span
              className="flex shrink-0 items-center self-stretch border-r border-input px-3 text-sm text-muted-foreground select-none"
              aria-hidden="true"
            >
              {prefix}
            </span>
          </>
        ) : null}
        <input
          ref={ref}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          className={cn(
            inputElementVariants({ size }),
            'px-3',
            inputClassName,
          )}
          {...props}
        />
      </div>
    )
  },
)
WebsiteInput.displayName = 'WebsiteInput'
