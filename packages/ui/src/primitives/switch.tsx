import * as React from 'react'

import { cn } from '@open-mercato/shared/lib/utils'

type SwitchProps = {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
} & Omit<React.ComponentProps<'button'>, 'onChange'>

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, defaultChecked, onCheckedChange, disabled, className, onClick, onKeyDown, ...props }, ref) => {
    const isControlled = typeof checked === 'boolean'
    const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultChecked ?? false)

    const currentChecked = isControlled ? checked : uncontrolledValue

    const toggle = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
        event.preventDefault()
        if (disabled) {
          return
        }
        const next = !currentChecked
        if (!isControlled) {
          setUncontrolledValue(next)
        }
        onCheckedChange?.(next)
      },
      [currentChecked, disabled, isControlled, onCheckedChange]
    )

    const handleClick = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          toggle(event)
        }
      },
      [onClick, toggle]
    )

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) {
          return
        }
        if (event.key === ' ' || event.key === 'Enter') {
          toggle(event)
        }
      },
      [onKeyDown, toggle]
    )

    return (
      <button
        type="button"
        role="switch"
        aria-checked={currentChecked}
        aria-disabled={disabled}
        data-state={currentChecked ? 'checked' : 'unchecked'}
        data-disabled={disabled ? '' : undefined}
        ref={ref}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={cn(
          'inline-flex h-6 w-11 items-center rounded-full border border-transparent bg-input/60 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary',
          className
        )}
        {...props}
      >
        <span
          aria-hidden
          className={cn(
            'inline-block size-5 translate-x-0 rounded-full bg-background shadow transition-transform duration-200',
            currentChecked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </button>
    )
  }
)

Switch.displayName = 'Switch'
