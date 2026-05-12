"use client"

import * as React from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import type { VariantProps } from 'class-variance-authority'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { inputWrapperVariants, inputElementVariants } from './input'

export type PasswordInputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'size' | 'type'> &
  VariantProps<typeof inputWrapperVariants> & {
    /** Render the leading lock icon per Figma `Text Input [1.1]` Password variant. Defaults to `true`. */
    showLockIcon?: boolean
    /** Allow the user to toggle reveal (eye / eye-off). Defaults to `true`. */
    revealable?: boolean
    /** Optional controlled reveal state (otherwise managed internally). */
    revealed?: boolean
    /** Called when the reveal state changes. */
    onRevealedChange?: (next: boolean) => void
    /** Optional className on the wrapper. */
    className?: string
    /** Optional className on the inner `<input>`. */
    inputClassName?: string
    /** Translated aria-label for the reveal button when password is hidden. */
    showLabel?: string
    /** Translated aria-label for the reveal button when password is shown. */
    hideLabel?: string
  }

/**
 * Password input matching Figma `Text Input [1.1]` (node `266:5251`) **Password** variant — a
 * trailing `Eye` / `EyeOff` toggle that switches the inner `<input>`'s `type` between `"password"`
 * (default) and `"text"`. The toggle is a proper `<button>` (focusable, screen-reader labelled).
 *
 * Internally managed reveal state when `revealed` / `onRevealedChange` are not passed. Otherwise
 * the consumer owns the toggle state (useful for "show password" master toggle on login screens).
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    {
      className,
      inputClassName,
      size,
      showLockIcon = true,
      revealable = true,
      revealed: revealedProp,
      onRevealedChange,
      showLabel,
      hideLabel,
      disabled,
      ...props
    },
    ref,
  ) => {
    const t = useT()
    const resolvedShowLabel = showLabel ?? t('ui.inputs.passwordInput.show', 'Show password')
    const resolvedHideLabel = hideLabel ?? t('ui.inputs.passwordInput.hide', 'Hide password')
    const [internalRevealed, setInternalRevealed] = React.useState(false)
    const isControlled = revealedProp !== undefined
    const revealed = isControlled ? revealedProp! : internalRevealed

    const toggleRevealed = React.useCallback(() => {
      const next = !revealed
      if (!isControlled) setInternalRevealed(next)
      onRevealedChange?.(next)
    }, [revealed, isControlled, onRevealedChange])

    return (
      <div className={cn(inputWrapperVariants({ size }), className)} data-slot="password-input-wrapper">
        {showLockIcon ? (
          <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <input
          ref={ref}
          type={revealed ? 'text' : 'password'}
          autoComplete="current-password"
          disabled={disabled}
          className={cn(inputElementVariants({ size }), inputClassName)}
          {...props}
        />
        {revealable ? (
          <button
            type="button"
            onClick={toggleRevealed}
            aria-label={revealed ? resolvedHideLabel : resolvedShowLabel}
            aria-pressed={revealed}
            disabled={disabled}
            className="flex shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {revealed ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
    )
  },
)
PasswordInput.displayName = 'PasswordInput'
