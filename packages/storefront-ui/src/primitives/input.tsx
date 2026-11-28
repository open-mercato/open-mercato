'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'
import { MinusIcon, PlusIcon, SearchIcon, XIcon } from '../lib/icons'

// Text in fields is 16 px below `lg`: iOS Safari zooms the page when a focused field uses a smaller size.
const inputVariants = cva(
  [
    'w-full min-w-0 rounded-sf-field border border-input bg-background px-4 text-foreground',
    'placeholder:text-muted-foreground outline-none transition-colors duration-(--sf-motion-fast)',
    'hover:border-muted-foreground focus-visible:border-foreground focus-visible:shadow-focus',
    'aria-invalid:border-status-error-icon aria-invalid:focus-visible:border-status-error-icon',
    'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-bg-disabled disabled:text-text-disabled',
  ],
  {
    variants: {
      size: {
        sm: 'h-sf-sm text-sf-body-lg lg:text-sf-body-sm',
        default: 'h-sf-md text-sf-body-lg lg:text-sf-body',
        lg: 'h-sf-lg text-sf-body-lg lg:text-sf-body',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

export type InputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'size'> &
  VariantProps<typeof inputVariants> & {
    invalid?: boolean
    leadingIcon?: React.ReactNode
    /** Right-aligned slot inside the field (clear button, unit, suffix). */
    trailingSlot?: React.ReactNode
  }

const InputBase = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size, invalid, leadingIcon, trailingSlot, ...props },
  ref,
) {
  const input = (
    <input
      ref={ref}
      data-slot="input"
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      className={cn(inputVariants({ size }), leadingIcon && 'pl-11', trailingSlot && 'pr-11', className)}
      {...props}
    />
  )
  if (!leadingIcon && !trailingSlot) return input
  return (
    <span data-slot="input-wrapper" className="relative flex w-full items-center">
      {leadingIcon ? (
        <span aria-hidden="true" className="pointer-events-none absolute left-4 flex text-muted-foreground [&_svg]:size-5">
          {leadingIcon}
        </span>
      ) : null}
      {input}
      {trailingSlot ? <span className="absolute right-2 flex items-center">{trailingSlot}</span> : null}
    </span>
  )
})

/* ---------- Field: label, helper and error wired to one control ---------- */

export type InputFieldProps = {
  label: React.ReactNode
  helper?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  /** Text appended to the label for optional fields, for example "(optional)". */
  optionalLabel?: React.ReactNode
  id?: string
  className?: string
  /** A single control element; `id`, `aria-describedby`, `aria-invalid` and `required` are injected. */
  children: React.ReactElement<Record<string, unknown>>
}

function InputField({ label, helper, error, required, optionalLabel, id, className, children }: InputFieldProps) {
  const generated = React.useId()
  const controlId = id ?? children.props.id as string | undefined ?? generated
  const helperId = helper ? `${controlId}-helper` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [children.props['aria-describedby'] as string | undefined, errorId, helperId].filter(Boolean).join(' ') || undefined
  const control = React.cloneElement(children, {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : children.props['aria-invalid'],
    required: required ?? children.props.required,
  })
  return (
    <div data-slot="field" className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={controlId} className="text-sf-body-sm text-foreground">
        {label}
        {required ? <span aria-hidden="true" className="ml-0.5 text-status-error-icon">*</span> : null}
        {!required && optionalLabel ? <span className="ml-1 font-normal text-muted-foreground">{optionalLabel}</span> : null}
      </label>
      {control}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sf-body-xs text-status-error-text">
          <span aria-hidden="true" className="mt-0.5 size-4 shrink-0 rounded-full bg-status-error-icon text-background">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><path d="M12 7v6" /><path d="M12 17h.01" /></svg>
          </span>
          {error}
        </p>
      ) : null}
      {helper ? <p id={helperId} className="text-sf-body-xs text-muted-foreground">{helper}</p> : null}
    </div>
  )
}

/* ---------- Stepper: editable quantity with announced value ---------- */

export type InputStepperProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'onChange'> & {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  size?: 'sm' | 'default' | 'lg'
  disabled?: boolean
  /** Accessible names for the buttons and the value, resolved by the app's i18n. */
  labels: { decrease: string; increase: string; value: string }
  /** Replace the decrease glyph at `min` with a trash icon (cart lines). */
  removeAtMin?: boolean
  removeIcon?: React.ReactNode
}

const stepperSize = {
  sm: { box: 'h-sf-sm', button: 'w-9', input: 'w-9 text-sf-body-sm' },
  default: { box: 'h-sf-md', button: 'w-10', input: 'w-10 text-sf-body-lg lg:text-sf-body' },
  lg: { box: 'h-sf-lg', button: 'w-11', input: 'w-11 text-sf-body-lg lg:text-sf-body' },
}

const InputStepper = React.forwardRef<HTMLDivElement, InputStepperProps>(function InputStepper(
  { value, onValueChange, min = 1, max = Number.POSITIVE_INFINITY, step = 1, size = 'default', disabled, labels, removeAtMin, removeIcon, className, ...props },
  ref,
) {
  const sizes = stepperSize[size]
  const atMin = value <= min
  const atMax = value >= max
  const clamp = (next: number) => Math.min(max, Math.max(min, next))
  const buttonClass = cn(
    'flex h-full shrink-0 cursor-pointer items-center justify-center text-foreground outline-none transition-colors',
    'hover:bg-muted focus-visible:shadow-focus disabled:cursor-not-allowed disabled:text-text-disabled',
    '[&_svg]:size-4',
    sizes.button,
  )
  return (
    <div
      ref={ref}
      data-slot="stepper"
      role="group"
      className={cn('inline-flex shrink-0 items-stretch overflow-hidden rounded-sf-button border border-input bg-background', sizes.box, disabled && 'border-border-disabled bg-bg-disabled', className)}
      {...props}
    >
      <button
        type="button"
        className={buttonClass}
        aria-label={labels.decrease}
        disabled={disabled || (atMin && !removeAtMin)}
        onClick={() => onValueChange(atMin && removeAtMin ? min - step : clamp(value - step))}
      >
        {atMin && removeAtMin ? removeIcon ?? <MinusIcon /> : <MinusIcon />}
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={labels.value}
        aria-live="polite"
        className={cn('min-w-0 border-0 bg-transparent text-center text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none', sizes.input)}
        value={value}
        min={min}
        max={Number.isFinite(max) ? max : undefined}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10)
          if (!Number.isNaN(next)) onValueChange(clamp(next))
        }}
      />
      <button type="button" className={buttonClass} aria-label={labels.increase} disabled={disabled || atMax} onClick={() => onValueChange(clamp(value + step))}>
        <PlusIcon />
      </button>
    </div>
  )
})

/* ---------- Search: icon, clear button, search semantics ---------- */

export type InputSearchProps = Omit<InputProps, 'type' | 'leadingIcon' | 'trailingSlot'> & {
  /** Accessible name for the clear button; rendered only while the field has a value. */
  clearLabel: string
  onClear?: () => void
}

const InputSearch = React.forwardRef<HTMLInputElement, InputSearchProps>(function InputSearch(
  { clearLabel, onClear, value, className, ...props },
  ref,
) {
  const hasValue = typeof value === 'string' ? value.length > 0 : value != null && String(value).length > 0
  return (
    <InputBase
      ref={ref}
      type="search"
      value={value}
      leadingIcon={<SearchIcon />}
      className={cn('bg-muted border-transparent [&::-webkit-search-cancel-button]:appearance-none', className)}
      trailingSlot={
        hasValue && onClear ? (
          <button type="button" aria-label={clearLabel} onClick={onClear} className="flex size-9 cursor-pointer items-center justify-center rounded-sf-chip text-muted-foreground outline-none hover:text-foreground focus-visible:shadow-focus [&_svg]:size-4">
            <XIcon />
          </button>
        ) : undefined
      }
      {...props}
    />
  )
})

export const Input = Object.assign(InputBase, { Field: InputField, Stepper: InputStepper, Search: InputSearch })
export { inputVariants }
