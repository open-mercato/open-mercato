"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ComboboxInput, type ComboboxOption } from './ComboboxInput'
import { useAvailableEvents } from './EventSelect'

export interface EventPatternInputProps {
  value: string
  onChange: (pattern: string) => void
  /**
   * Placeholder hint shown when the field is empty. Defaults to a translated
   * `ui.inputs.eventPatternInput.placeholder` key (English fallback
   * `'sales.orders.created'`) — an example of a valid event id with wildcards.
   * Pass a custom string to override per-surface.
   */
  placeholder?: string
  disabled?: boolean
  categories?: Array<'crud' | 'lifecycle' | 'system' | 'custom'>
  modules?: string[]
  workflowEmittableOnly?: boolean
}

export function EventPatternInput({
  value,
  onChange,
  placeholder,
  disabled,
  categories,
  modules,
  workflowEmittableOnly = false,
}: EventPatternInputProps) {
  const t = useT()
  const resolvedPlaceholder = placeholder ?? t('ui.inputs.eventPatternInput.placeholder', 'sales.orders.created')
  const { events } = useAvailableEvents({ categories, modules, excludeTriggerExcluded: !workflowEmittableOnly })

  const suggestions = React.useMemo<ComboboxOption[]>(
    () =>
      events.filter(event => !workflowEmittableOnly || (
        event.workflowEmittable === true && !event.portalBroadcast && !event.crossProcessBroadcast
      )).map(event => ({
        value: event.id,
        label: event.label,
        description: event.id,
      })),
    [events, workflowEmittableOnly]
  )

  return (
    <ComboboxInput
      value={value}
      onChange={onChange}
      placeholder={resolvedPlaceholder}
      suggestions={suggestions}
      allowCustomValues={true}
      disabled={disabled}
    />
  )
}
