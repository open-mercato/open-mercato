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
    },
    ref,
  ) => {
    const [internalValue, setInternalValue] = React.useState<string[]>([])
    const [inputText, setInputText] = React.useState('')
    const [error, setError] = React.useState<string | null>(null)

    const isControlled = valueProp !== undefined
    const value = isControlled ? (valueProp as string[]) : internalValue

    const commitValue = React.useCallback(
      (next: string[]) => {
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
          if (result === false) return null
          if (typeof result === 'string') return { next: current, errorText: result }
        }
        return { next: [...current, tag], errorText: null }
      },
      [allowDuplicates, maxTags, validate],
    )

    const tryAddTag = React.useCallback(
      (rawTag: string): boolean => {
        const outcome = appendToList(value, rawTag)
        if (!outcome) return false
        if (outcome.errorText !== null) {
          setError(outcome.errorText)
          return false
        }
        setError(null)
        if (outcome.next !== value) commitValue(outcome.next)
        return outcome.next !== value
      },
      [appendToList, commitValue, value],
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
        tryAddTag(inputText)
        setInputText('')
        return
      }
      if (event.key === 'Backspace' && inputText.length === 0 && value.length > 0) {
        event.preventDefault()
        removeTagAt(value.length - 1)
      }
    }

    const limitReached = typeof maxTags === 'number' && value.length >= maxTags

    return (
      <div className={cn('flex w-full flex-col gap-1', className)} data-slot="tag-input">
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
                removeAriaLabel={`Remove ${tag}`}
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
