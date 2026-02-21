"use client"

import * as React from 'react'
import { ComboboxInput, type ComboboxOption } from './ComboboxInput'
import { useAvailableEvents } from './EventSelect'

export interface EventPatternInputProps {
  value: string
  onChange: (pattern: string) => void
  placeholder?: string
  disabled?: boolean
  categories?: Array<'crud' | 'lifecycle' | 'system' | 'custom'>
  modules?: string[]
}

/**
 * EventPatternInput — a combobox that suggests known declared events by their
 * human-readable label while still allowing custom wildcard patterns.
 *
 * Combines the autocomplete UX of ComboboxInput with the event catalogue
 * from useAvailableEvents. Selecting a suggestion stores the event ID
 * (e.g. "sales.orders.created"). Typing a custom pattern (e.g. "sales.*")
 * is also allowed.
 */
export function EventPatternInput({
  value,
  onChange,
  placeholder = 'sales.orders.created',
  disabled,
  categories,
  modules,
}: EventPatternInputProps) {
  const { events } = useAvailableEvents({ categories, modules })

  const suggestions = React.useMemo<ComboboxOption[]>(
    () =>
      events.map(event => ({
        value: event.id,
        label: event.label,
        description: event.id,
      })),
    [events]
  )

  return (
    <ComboboxInput
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      suggestions={suggestions}
      allowCustomValues={true}
      disabled={disabled}
    />
  )
}
