"use client"

import * as React from 'react'
import { Search, X } from 'lucide-react'
import type { VariantProps } from 'class-variance-authority'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { inputWrapperVariants, inputElementVariants } from './input'

export type SearchInputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'size' | 'type' | 'onChange'> &
  VariantProps<typeof inputWrapperVariants> & {
    /** Controlled value. */
    value: string
    /** Called on every keystroke with the new value. */
    onChange: (next: string) => void
    /**
     * Called when the user presses the trailing × button.
     * Defaults to `onChange('')` — pass an explicit handler to also reset adjacent state
     * (e.g. cancel an in-flight request, reset paging).
     */
    onClear?: () => void
    /** Show the trailing × button when the value is non-empty. Defaults to `true`. */
    clearable?: boolean
    /** Optional className on the wrapper. */
    className?: string
    /** Optional className on the inner `<input>`. */
    inputClassName?: string
    /** Translated aria-label for the clear button. Defaults to `t('ui.inputs.searchInput.clear', 'Clear search')`. */
    clearLabel?: string
  }

/**
 * Search input matching Figma `Text Input [1.1]` (node `266:5251`) **Search** variant — a leading
 * `Search` icon, the text input, and an optional trailing `X` button to clear the field. Built on
 * the shared `inputWrapperVariants` / `inputElementVariants` CVA so the visual contract stays in
 * sync with the foundation `Input` primitive.
 *
 * The clear button is rendered as a proper `<button>` (not inside an `aria-hidden` decorative
 * span), so it remains keyboard-focusable and screen-reader-accessible.
 */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, inputClassName, size, value, onChange, onClear, clearable = true, clearLabel, placeholder, disabled, ...props }, ref) => {
    const t = useT()
    const resolvedPlaceholder = placeholder ?? t('ui.inputs.searchInput.placeholder', 'Search…')
    const resolvedClearLabel = clearLabel ?? t('ui.inputs.searchInput.clear', 'Clear search')
    const showClear = clearable && value.length > 0 && !disabled

    const handleClear = React.useCallback(() => {
      if (onClear) onClear()
      else onChange('')
    }, [onChange, onClear])

    return (
      <div className={cn(inputWrapperVariants({ size }), className)} data-slot="search-input-wrapper">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={ref}
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder={resolvedPlaceholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={cn(
            inputElementVariants({ size }),
            // Disable the native search clear button — we render our own.
            '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
            inputClassName,
          )}
          {...props}
        />
        {showClear ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label={resolvedClearLabel}
            className="flex shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    )
  },
)
SearchInput.displayName = 'SearchInput'
