"use client"

import * as React from 'react'
import { Minus, Plus } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

const counterWrapperVariants = cva(
  'inline-flex w-full items-center bg-background border border-input shadow-xs transition-colors ' +
    'focus-within:outline-none focus-within:shadow-focus focus-within:border-foreground ' +
    'hover:bg-muted/40 ' +
    'has-[input:disabled]:bg-bg-disabled has-[input:disabled]:border-border-disabled has-[input:disabled]:shadow-none has-[input:disabled]:hover:bg-bg-disabled ' +
    'has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:focus-within:border-destructive',
  {
    variants: {
      size: {
        sm: 'h-8 gap-1 p-1 rounded-md',
        default: 'h-9 gap-1.5 p-1.5 rounded-md',
        lg: 'h-10 gap-2 p-2 rounded-[10px]',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

const counterButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      size: {
        sm: 'size-6 [&_svg]:size-3.5',
        default: 'size-6 [&_svg]:size-4',
        lg: 'size-6 [&_svg]:size-4',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

const counterInputElementVariants = cva(
  'flex-1 min-w-0 bg-transparent border-0 outline-none text-center placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-transparent ' +
    '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
  {
    variants: {
      size: {
        sm: 'text-xs',
        default: 'text-sm',
        lg: 'text-sm',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

export type CounterInputProps = Omit<
  React.ComponentPropsWithoutRef<'input'>,
  'value' | 'onChange' | 'size' | 'type' | 'children'
> &
  VariantProps<typeof counterWrapperVariants> & {
    value?: number | null
    /**
     * Fired whenever the value changes through `-`/`+`, keyboard arrows, or direct typing.
     * `null` is emitted when the user clears the input. Component clamps to `min`/`max`
     * and rounds to `precision` decimal places before emitting.
     */
    onChange?: (value: number | null) => void
    min?: number
    max?: number
    /** Increment amount for `+` / `-` and ArrowUp / ArrowDown. Default `1`. */
    step?: number
    /** Decimal places used when formatting the displayed value. Default `0`. */
    precision?: number
    /** aria-label for the decrement (`-`) button. Default English `Decrease`. */
    decrementAriaLabel?: string
    /** aria-label for the increment (`+`) button. Default English `Increase`. */
    incrementAriaLabel?: string
    /** Override classes applied to the inner `<input>` element. */
    inputClassName?: string
  }

export const CounterInput = React.forwardRef<HTMLInputElement, CounterInputProps>(
  (
    {
      className,
      inputClassName,
      size,
      value: valueProp,
      onChange,
      min,
      max,
      step = 1,
      precision = 0,
      disabled = false,
      placeholder,
      decrementAriaLabel = 'Decrease',
      incrementAriaLabel = 'Increase',
      ...rest
    },
    ref,
  ) => {
    const [internalValue, setInternalValue] = React.useState<number | null>(
      valueProp ?? null,
    )
    const isControlled = valueProp !== undefined
    const value = isControlled ? valueProp ?? null : internalValue

    const factor = React.useMemo(() => 10 ** precision, [precision])

    const clamp = React.useCallback(
      (n: number) => {
        let next = n
        if (typeof min === 'number' && next < min) next = min
        if (typeof max === 'number' && next > max) next = max
        return Math.round(next * factor) / factor
      },
      [factor, max, min],
    )

    const commitValue = React.useCallback(
      (next: number | null) => {
        if (!isControlled) setInternalValue(next)
        onChange?.(next)
      },
      [isControlled, onChange],
    )

    const formatNumber = React.useCallback(
      (n: number) => (precision > 0 ? n.toFixed(precision) : String(n)),
      [precision],
    )

    const adjust = React.useCallback(
      (direction: 1 | -1) => {
        const current = typeof value === 'number' ? value : 0
        commitValue(clamp(current + direction * step))
      },
      [clamp, commitValue, step, value],
    )

    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const text = event.target.value
      if (text === '' || text === '-') {
        commitValue(null)
        return
      }
      const parsed = Number(text)
      if (!Number.isFinite(parsed)) return
      commitValue(clamp(parsed))
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        adjust(1)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        adjust(-1)
      }
    }

    const incrementDisabled =
      disabled || (typeof max === 'number' && value !== null && value >= max)
    const decrementDisabled =
      disabled || (typeof min === 'number' && value !== null && value <= min)

    return (
      <div
        className={cn(counterWrapperVariants({ size }), className)}
        data-slot="counter-input"
      >
        <button
          type="button"
          onClick={() => adjust(-1)}
          disabled={decrementDisabled}
          aria-label={decrementAriaLabel}
          className={cn(counterButtonVariants({ size }))}
          data-slot="counter-input-decrement"
        >
          <Minus aria-hidden="true" />
        </button>
        <input
          ref={ref}
          type="number"
          inputMode="decimal"
          value={value === null ? '' : formatNumber(value)}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          min={min}
          max={max}
          step={step}
          className={cn(counterInputElementVariants({ size }), inputClassName)}
          {...rest}
        />
        <button
          type="button"
          onClick={() => adjust(1)}
          disabled={incrementDisabled}
          aria-label={incrementAriaLabel}
          className={cn(counterButtonVariants({ size }))}
          data-slot="counter-input-increment"
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
    )
  },
)

CounterInput.displayName = 'CounterInput'
