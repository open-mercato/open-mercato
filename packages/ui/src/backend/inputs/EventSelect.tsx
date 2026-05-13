"use client"

import * as React from 'react'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '../utils/apiCall'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select'

/**
 * Event definition returned by the API
 */
export interface EventDefinition {
  id: string
  label: string
  description?: string
  category?: 'crud' | 'lifecycle' | 'system' | 'custom'
  module?: string
  entity?: string
  excludeFromTriggers?: boolean
}

export interface EventSelectProps {
  /** Current selected event ID */
  value: string
  /** Called when event is selected */
  onChange: (eventId: string) => void
  /** Placeholder text when no event selected. Defaults to a translated string. */
  placeholder?: string
  /** Additional CSS classes */
  className?: string
  /** Whether the select is disabled */
  disabled?: boolean
  /** Filter events by category */
  categories?: Array<'crud' | 'lifecycle' | 'system' | 'custom'>
  /** Filter events by module */
  modules?: string[]
  /** Whether to exclude events marked as excludeFromTriggers (default: true) */
  excludeTriggerExcluded?: boolean
  /** Trigger size — defaults to `'default'` (DS row-height contract). */
  size?: 'sm' | 'default' | 'lg'
}

/**
 * EventSelect - A reusable select component for choosing declared events
 *
 * Fetches available events from the API and groups them by module.
 */
export function EventSelect({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  categories,
  modules,
  excludeTriggerExcluded = true,
  size = 'default',
}: EventSelectProps) {
  const t = useT()
  const resolvedPlaceholder = placeholder ?? t('ui.inputs.eventSelect.placeholder', 'Select an event...')
  const loadingPlaceholder = t('ui.inputs.eventSelect.loading', 'Loading...')
  const emptyPlaceholder = t('ui.inputs.eventSelect.empty', 'No events available')

  // Fetch events from the API
  const { data: allEvents = [], isLoading } = useQuery({
    queryKey: ['declared-events', excludeTriggerExcluded],
    queryFn: async () => {
      const result = await apiCall<{ data: EventDefinition[]; total: number }>(
        `/api/events?excludeTriggerExcluded=${excludeTriggerExcluded}`
      )
      if (!result.ok) return []
      return result.result?.data || []
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })

  // Filter events based on props
  const filteredEvents = useMemo(() => {
    let events = allEvents

    if (categories?.length) {
      events = events.filter(e => e.category && categories.includes(e.category))
    }
    if (modules?.length) {
      events = events.filter(e => e.module && modules.includes(e.module))
    }

    return events
  }, [allEvents, categories, modules])

  // Group events by module for better UX
  const eventsByModule = useMemo(() => {
    const grouped: Record<string, EventDefinition[]> = {}
    for (const event of filteredEvents) {
      const module = event.module || 'other'
      if (!grouped[module]) grouped[module] = []
      grouped[module].push(event)
    }
    // Sort modules alphabetically
    return Object.fromEntries(
      Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
    )
  }, [filteredEvents])

  // Format module name for display
  const formatModuleName = (module: string): string => {
    return module.charAt(0).toUpperCase() + module.slice(1).replace(/_/g, ' ')
  }

  const isEmpty = !isLoading && filteredEvents.length === 0

  return (
    <Select
      value={value || undefined}
      onValueChange={(next) => onChange(next ?? '')}
      disabled={disabled || isLoading}
    >
      <SelectTrigger size={size} className={className}>
        <SelectValue
          placeholder={isLoading ? loadingPlaceholder : isEmpty ? emptyPlaceholder : resolvedPlaceholder}
        />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(eventsByModule).map(([module, moduleEvents]) => (
          <SelectGroup key={module}>
            <SelectLabel>{formatModuleName(module)}</SelectLabel>
            {moduleEvents.map(event => (
              <SelectItem key={event.id} value={event.id}>
                {event.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Hook for getting available events
 */
export function useAvailableEvents(options?: {
  categories?: Array<'crud' | 'lifecycle' | 'system' | 'custom'>
  modules?: string[]
  excludeTriggerExcluded?: boolean
}) {
  const excludeTriggerExcluded = options?.excludeTriggerExcluded !== false

  const { data: allEvents = [], isLoading, error, refetch } = useQuery({
    queryKey: ['declared-events', excludeTriggerExcluded],
    queryFn: async () => {
      const result = await apiCall<{ data: EventDefinition[]; total: number }>(
        `/api/events?excludeTriggerExcluded=${excludeTriggerExcluded}`
      )
      if (!result.ok) return []
      return result.result?.data || []
    },
    staleTime: 5 * 60 * 1000,
  })

  const filteredEvents = useMemo(() => {
    let events = allEvents

    if (options?.categories?.length) {
      events = events.filter(e => e.category && options.categories!.includes(e.category))
    }
    if (options?.modules?.length) {
      events = events.filter(e => e.module && options.modules!.includes(e.module))
    }

    return events
  }, [allEvents, options])

  // Group by module
  const eventsByModule = useMemo(() => {
    const grouped: Record<string, EventDefinition[]> = {}
    for (const event of filteredEvents) {
      const module = event.module || 'other'
      if (!grouped[module]) grouped[module] = []
      grouped[module].push(event)
    }
    return Object.fromEntries(
      Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
    )
  }, [filteredEvents])

  return {
    events: filteredEvents,
    eventsByModule,
    isLoading,
    error,
    refetch,
  }
}

export default EventSelect
