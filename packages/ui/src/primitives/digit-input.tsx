"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export type DigitInputProps = {
  value?: string
  onChange?: (value: string) => void
  /** Number of cells. Default `6`. */
  length?: number
  disabled?: boolean
  autoFocus?: boolean
  /** Restrict input characters. `'numeric'` filters out non-digits. */
  inputMode?: 'numeric' | 'text'
  /** Render each cell as a password input so characters appear as bullets. */
  mask?: boolean
  /** Fires when all `length` cells are filled. */
  onComplete?: (value: string) => void
  /** Override classes for the cell row wrapper. */
  className?: string
  /** Override classes applied to each cell `<input>`. */
  cellClassName?: string
  /** aria-label applied to the role=group wrapper. Defaults to `Verification code`. */
  'aria-label'?: string
  /** Indicates that the group's current value fails validation (mirrors Input's aria-invalid styling). */
  'aria-invalid'?: boolean
  /** Forwarded to the first cell so consumers can label the entire group with `<label htmlFor>`. */
  id?: string
  /** Forwarded to the first cell so form submissions carry the assembled value. */
  name?: string
}

/**
 * `length`-cell verification code input. Pasting a string distributes
 * characters across cells and fires `onComplete` when all cells are filled.
 * Backspace on an empty cell focuses the previous cell. ArrowLeft /
 * ArrowRight move focus without committing values.
 *
 * The `value` prop is the assembled string (e.g. `'123456'`) — cells are an
 * internal layout concern, not part of the contract. Same as `Input`,
 * `mask` is purely visual (`type='password'` swap) so consumers always
 * receive the raw characters in `onChange` / `onComplete`.
 */
export const DigitInput = React.forwardRef<HTMLInputElement, DigitInputProps>(
  (
    {
      value: valueProp,
      onChange,
      length = 6,
      disabled = false,
      autoFocus = false,
      inputMode = 'numeric',
      mask = false,
      onComplete,
      className,
      cellClassName,
      'aria-label': ariaLabel,
      'aria-invalid': ariaInvalid,
      id,
      name,
    },
    ref,
  ) => {
    const [internalValue, setInternalValue] = React.useState('')
    const isControlled = valueProp !== undefined
    const value = isControlled ? valueProp ?? '' : internalValue
    const cellRefs = React.useRef<Array<HTMLInputElement | null>>([])

    React.useImperativeHandle(
      ref,
      () => (cellRefs.current[0] ?? null) as HTMLInputElement,
      [],
    )

    const setCellRef = React.useCallback(
      (index: number) => (el: HTMLInputElement | null) => {
        cellRefs.current[index] = el
      },
      [],
    )

    const commitValue = React.useCallback(
      (next: string) => {
        const clamped = next.slice(0, length)
        if (!isControlled) setInternalValue(clamped)
        onChange?.(clamped)
        if (clamped.length === length && onComplete) onComplete(clamped)
      },
      [isControlled, length, onChange, onComplete],
    )

    const filterChar = React.useCallback(
      (char: string): string | null => {
        if (inputMode === 'numeric' && !/^\d$/.test(char)) return null
        return char
      },
      [inputMode],
    )

    const focusCell = React.useCallback(
      (index: number) => {
        const target = cellRefs.current[Math.max(0, Math.min(length - 1, index))]
        if (target) target.focus()
      },
      [length],
    )

    const handleCellChange = React.useCallback(
      (index: number, raw: string) => {
        if (raw.length === 0) {
          const next = value.slice(0, index) + value.slice(index + 1)
          commitValue(next)
          return
        }
        const lastChar = raw.slice(-1)
        const filtered = filterChar(lastChar)
        if (filtered === null) return
        const next = value.slice(0, index) + filtered + value.slice(index + 1)
        commitValue(next)
        if (index < length - 1) focusCell(index + 1)
      },
      [commitValue, filterChar, focusCell, length, value],
    )

    const handleKeyDown = React.useCallback(
      (index: number) => (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Backspace') {
          if (event.currentTarget.value === '' && index > 0) {
            event.preventDefault()
            const next = value.slice(0, index - 1) + value.slice(index)
            commitValue(next)
            focusCell(index - 1)
          }
        } else if (event.key === 'ArrowLeft' && index > 0) {
          event.preventDefault()
          focusCell(index - 1)
        } else if (event.key === 'ArrowRight' && index < length - 1) {
          event.preventDefault()
          focusCell(index + 1)
        }
      },
      [commitValue, focusCell, length, value],
    )

    const handlePaste = React.useCallback(
      (event: React.ClipboardEvent<HTMLInputElement>) => {
        event.preventDefault()
        const pasted = event.clipboardData.getData('text/plain')
        const filtered = pasted
          .split('')
          .map(filterChar)
          .filter((c): c is string => c !== null)
          .join('')
          .slice(0, length)
        if (filtered.length === 0) return
        commitValue(filtered)
        const focusIndex = Math.min(filtered.length, length - 1)
        focusCell(focusIndex)
      },
      [commitValue, filterChar, focusCell, length],
    )

    return (
      <div
        className={cn('flex items-center gap-2', className)}
        role="group"
        aria-label={ariaLabel ?? 'Verification code'}
        aria-invalid={ariaInvalid || undefined}
        data-slot="digit-input"
      >
        {Array.from({ length }, (_, index) => {
          const cellValue = value[index] ?? ''
          return (
            <input
              key={index}
              ref={setCellRef(index)}
              id={index === 0 ? id : undefined}
              name={index === 0 ? name : undefined}
              type={mask ? 'password' : 'text'}
              inputMode={inputMode === 'numeric' ? 'numeric' : 'text'}
              autoComplete="one-time-code"
              maxLength={1}
              autoFocus={autoFocus && index === 0}
              value={cellValue}
              onChange={(event) => handleCellChange(index, event.target.value)}
              onKeyDown={handleKeyDown(index)}
              onPaste={handlePaste}
              disabled={disabled}
              aria-label={`${ariaLabel ?? 'Verification code'} digit ${index + 1}`}
              aria-invalid={ariaInvalid || undefined}
              data-slot="digit-input-cell"
              data-index={index}
              className={cn(
                'h-16 w-12 sm:w-14 rounded-[10px] border border-input bg-background text-center text-2xl font-medium shadow-xs transition-colors',
                'focus:outline-none focus-visible:border-foreground focus-visible:shadow-focus',
                'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:border-destructive',
                'disabled:cursor-not-allowed disabled:bg-bg-disabled disabled:border-border-disabled disabled:shadow-none',
                'hover:bg-muted/40',
                cellClassName,
              )}
            />
          )
        })}
      </div>
    )
  },
)
DigitInput.displayName = 'DigitInput'
