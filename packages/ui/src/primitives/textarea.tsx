"use client"

import * as React from 'react'

import { cn } from '@open-mercato/shared/lib/utils'

const baseTextareaClass =
  'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground outline-none focus-visible:outline-none focus-visible:shadow-focus focus-visible:border-foreground hover:bg-muted/40 disabled:cursor-not-allowed disabled:bg-bg-disabled disabled:border-border-disabled disabled:shadow-none disabled:hover:bg-bg-disabled aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:border-destructive resize-y min-h-[80px]'

const DEFAULT_AUTO_RESIZE_MAX_ROWS = 12
const FALLBACK_LINE_HEIGHT_PX = 20

function readPixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Grow a textarea to fit its content, capped at `maxRows` rendered lines.
 * The cap is expressed in rows rather than pixels so it follows the element's
 * own type scale instead of a magic height, and the element only scrolls once
 * the cap is reached.
 */
function applyAutoResize(element: HTMLTextAreaElement | null, maxRows: number): void {
  if (!element) return
  const computed = typeof window !== 'undefined' ? window.getComputedStyle(element) : null
  const lineHeight = computed ? readPixels(computed.lineHeight) || FALLBACK_LINE_HEIGHT_PX : FALLBACK_LINE_HEIGHT_PX
  const padding = computed ? readPixels(computed.paddingTop) + readPixels(computed.paddingBottom) : 0
  const border = computed ? readPixels(computed.borderTopWidth) + readPixels(computed.borderBottomWidth) : 0
  const maxContentHeight = lineHeight * Math.max(1, maxRows) + padding

  element.style.height = 'auto'
  const contentHeight = element.scrollHeight
  const cappedHeight = Math.min(contentHeight, maxContentHeight)
  element.style.height = `${cappedHeight + border}px`
  element.style.overflowY = contentHeight > maxContentHeight ? 'auto' : 'hidden'
}

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Show character counter (`current/max`) below the textarea. Requires `maxLength`. */
  showCount?: boolean
  /** Optional className applied to the outer wrapper (when counter is shown). */
  wrapperClassName?: string
  /**
   * Grow the field to fit its content instead of scrolling inside a fixed box.
   * Disables the manual resize handle — the height is owned by the content.
   */
  autoResize?: boolean
  /** Rows to grow to before the field starts scrolling. Only used with `autoResize`. */
  maxRows?: number
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      showCount,
      wrapperClassName,
      autoResize,
      maxRows = DEFAULT_AUTO_RESIZE_MAX_ROWS,
      value,
      defaultValue,
      maxLength,
      onChange,
      ...props
    },
    ref
  ) => {
    const [internalValue, setInternalValue] = React.useState<string>(
      typeof defaultValue === 'string' ? defaultValue : typeof value === 'string' ? value : ''
    )

    const isControlled = value !== undefined
    const currentValue = isControlled ? String(value ?? '') : internalValue

    const elementRef = React.useRef<HTMLTextAreaElement | null>(null)
    const setElementRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        elementRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node
      },
      [ref]
    )

    React.useLayoutEffect(() => {
      if (!autoResize) return
      applyAutoResize(elementRef.current, maxRows)
    }, [autoResize, maxRows, currentValue])

    React.useEffect(() => {
      if (!autoResize || typeof window === 'undefined') return
      const onWindowResize = () => applyAutoResize(elementRef.current, maxRows)
      window.addEventListener('resize', onWindowResize)
      return () => window.removeEventListener('resize', onWindowResize)
    }, [autoResize, maxRows])

    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (!isControlled) setInternalValue(event.target.value)
        if (autoResize) applyAutoResize(event.currentTarget, maxRows)
        onChange?.(event)
      },
      [isControlled, onChange, autoResize, maxRows]
    )

    const textarea = (
      <textarea
        ref={setElementRef}
        value={value}
        defaultValue={isControlled ? undefined : defaultValue}
        maxLength={maxLength}
        onChange={handleChange}
        className={cn(baseTextareaClass, autoResize && 'resize-none overflow-hidden', className)}
        {...props}
      />
    )

    if (!showCount) return textarea

    const length = currentValue.length
    const max = typeof maxLength === 'number' ? maxLength : undefined
    const isError = max != null && length > max
    const isDisabled = props.disabled

    return (
      <div className={cn('flex flex-col gap-1', wrapperClassName)}>
        {textarea}
        <div className="flex justify-end">
          <span
            className={cn(
              'text-overline uppercase',
              isDisabled
                ? 'text-text-disabled'
                : isError
                  ? 'text-destructive'
                  : 'text-muted-foreground'
            )}
            aria-live="polite"
          >
            {max != null ? `${length}/${max}` : `${length}`}
          </span>
        </div>
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'
