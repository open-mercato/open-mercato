"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Input, type InputProps } from './input'
import { Tag } from './tag'

export type TagInputProps = {
  value?: string[]
  onChange?: (value: string[]) => void
  placeholder?: string
  size?: 'sm' | 'default' | 'lg'
  disabled?: boolean
  maxTags?: number
  validate?: (tag: string) => boolean | string
  separator?: string | RegExp
  allowDuplicates?: boolean
  className?: string
  id?: string
  name?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  /**
   * Optional right-side icon for the input row (e.g. info-circle, search). Mirrors
   * the Figma `Tag Input` Filled state with `Right Icon=true`.
   */
  rightIcon?: InputProps['rightIcon']
  /**
   * Builds the accessible label for each tag's remove (×) button. Lets callers
   * localize the action; defaults to the English `Remove {tag}`.
   */
  removeTagLabel?: (tag: string) => string
  /**
   * Controls the text typed but not yet committed as a tag, so a caller can act on
   * it (for example on submit). Uncontrolled when omitted.
   */
  inputValue?: string
  onInputValueChange?: (text: string) => void
}

function defaultRemoveTagLabel(tag: string): string {
  return `Remove ${tag}`
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildSplitter(separator: string | RegExp): RegExp {
  if (separator instanceof RegExp) {
    return separator.flags.includes('g')
      ? separator
      : new RegExp(separator.source, `${separator.flags}g`)
  }
  return new RegExp(escapeRegExp(separator), 'g')
}

export const TagInput = React.forwardRef<HTMLInputElement, TagInputProps>(
  (
    {
      value: valueProp,
      onChange,
      placeholder,
      size = 'default',
      disabled = false,
      maxTags,
      validate,
      separator = ',',
      allowDuplicates = false,
      className,
      id,
      name,
      'aria-label': ariaLabel,
      'aria-invalid': ariaInvalid,
      rightIcon,
      removeTagLabel = defaultRemoveTagLabel,
      inputValue,
      onInputValueChange,
    },
    ref,
  ) => {
    const [internalValue, setInternalValue] = React.useState<string[]>([])
    const [internalInputText, setInternalInputText] = React.useState('')
    const [error, setError] = React.useState<string | null>(null)
    const rootRef = React.useRef<HTMLDivElement>(null)
    const focusBeforeChange = React.useRef<Element | null>(null)

    const isControlled = valueProp !== undefined
    const value = isControlled ? (valueProp as string[]) : internalValue
    const inputText = inputValue ?? internalInputText
    const limitReached = typeof maxTags === 'number' && value.length >= maxTags

    React.useLayoutEffect(() => {
      const previous = focusBeforeChange.current
      focusBeforeChange.current = null
      const root = rootRef.current
      if (!previous || !root || disabled) return

      const { activeElement, body } = root.ownerDocument
      if (activeElement !== previous && activeElement !== body) return
      const disabledInput = previous.matches('[data-slot="tag-input-field"]:disabled')
      const removedButton = !previous.isConnected && previous.matches('[data-slot="tag-remove"]')
      if (!disabledInput && !removedButton) return

      const target = limitReached
        ? '[data-slot="tag"]:last-child [data-slot="tag-remove"]'
        : '[data-slot="tag-input-field"]'
      root.querySelector<HTMLElement>(target)?.focus()
    }, [disabled, limitReached, value])

    const setInputText = (next: string) => {
      if (inputValue === undefined) setInternalInputText(next)
      onInputValueChange?.(next)
    }

    const commitValue = React.useCallback(
      (next: string[]) => {
        const root = rootRef.current
        const activeElement = root?.ownerDocument.activeElement
        focusBeforeChange.current = activeElement && root?.contains(activeElement) ? activeElement : null
        if (!isControlled) setInternalValue(next)
        onChange?.(next)
      },
      [isControlled, onChange],
    )

    const appendToList = React.useCallback(
      (current: string[], rawTag: string): { next: string[]; errorText: string | null } | null => {
        const tag = rawTag.trim()
        if (!tag) return null
        if (!allowDuplicates && current.includes(tag)) return null
        if (typeof maxTags === 'number' && current.length >= maxTags) return null
        if (validate) {
          const result = validate(tag)
          if (result !== true) return { next: current, errorText: result === false ? null : result }
        }
        return { next: [...current, tag], errorText: null }
      },
      [allowDuplicates, maxTags, validate],
    )

    const tryAddManyTags = React.useCallback(
      (rawTags: string[]) => {
        let acc = value
        let pendingError: string | null = null
        for (const raw of rawTags) {
          const outcome = appendToList(acc, raw)
          if (!outcome) continue
          if (outcome.errorText !== null) {
            pendingError = outcome.errorText
            continue
          }
          acc = outcome.next
        }
        if (acc !== value) commitValue(acc)
        if (pendingError !== null) setError(pendingError)
        else if (acc !== value) setError(null)
      },
      [appendToList, commitValue, value],
    )

    const removeTagAt = React.useCallback(
      (index: number) => {
        if (index < 0 || index >= value.length) return
        const next = value.slice(0, index).concat(value.slice(index + 1))
        commitValue(next)
        setError(null)
      },
      [commitValue, value],
    )

    const splitter = React.useMemo(() => buildSplitter(separator), [separator])

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const text = event.target.value
      splitter.lastIndex = 0
      if (splitter.test(text)) {
        splitter.lastIndex = 0
        const parts = text.split(splitter)
        const trailing = parts.pop() ?? ''
        tryAddManyTags(parts)
        setInputText(trailing)
        return
      }
      setInputText(text)
      if (error) setError(null)
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        const outcome = appendToList(value, inputText)
        if (outcome) {
          setError(outcome.errorText)
          if (outcome.next === value) return
          commitValue(outcome.next)
        }
        setInputText('')
        return
      }
      if (event.key === 'Backspace' && inputText.length === 0 && value.length > 0) {
        event.preventDefault()
        removeTagAt(value.length - 1)
      }
    }

    return (
      <div ref={rootRef} className={cn('flex w-full flex-col gap-1', className)} data-slot="tag-input">
        <Input
          ref={ref}
          type="text"
          size={size}
          id={id}
          name={name}
          value={inputText}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || limitReached}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid || Boolean(error) || undefined}
          rightIcon={rightIcon}
          data-slot="tag-input-field"
        />
        {value.length > 0 ? (
          <div
            className="flex flex-wrap items-center gap-2 pt-1"
            data-slot="tag-input-chips"
          >
            {value.map((tag, index) => (
              <Tag
                key={`${tag}-${index}`}
                variant="default"
                shape="square"
                disabled={disabled}
                onRemove={() => removeTagAt(index)}
                removeAriaLabel={removeTagLabel(tag)}
              >
                {tag}
              </Tag>
            ))}
          </div>
        ) : null}
        {error ? (
          <p
            className="text-xs text-status-error-text"
            role="alert"
            data-slot="tag-input-error"
          >
            {error}
          </p>
        ) : null}
      </div>
    )
  },
)

TagInput.displayName = 'TagInput'
