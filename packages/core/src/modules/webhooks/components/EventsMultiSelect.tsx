"use client"
import * as React from 'react'

// Available webhook events grouped by entity (domain event format: module.entity.action)
const WEBHOOK_EVENTS = {
  product: [
    { id: 'catalog.product.created', label: 'Product Created', description: 'When a new product is created' },
    { id: 'catalog.product.updated', label: 'Product Updated', description: 'When a product is modified' },
    { id: 'catalog.product.deleted', label: 'Product Deleted', description: 'When a product is removed' },
  ],
} as const

type EventGroup = keyof typeof WEBHOOK_EVENTS

interface EventsMultiSelectProps {
  id?: string
  value: string[]
  onChange: (events: string[]) => void
  disabled?: boolean
}

export function EventsMultiSelect({ id, value, onChange, disabled }: EventsMultiSelectProps) {
  const selectedSet = new Set(value)

  const handleToggle = (eventId: string) => {
    if (disabled) return
    const newSet = new Set(selectedSet)
    if (newSet.has(eventId)) {
      newSet.delete(eventId)
    } else {
      newSet.add(eventId)
    }
    onChange(Array.from(newSet))
  }

  const handleSelectAll = (group: EventGroup) => {
    if (disabled) return
    const groupEvents = WEBHOOK_EVENTS[group].map((e) => e.id)
    const allSelected = groupEvents.every((e) => selectedSet.has(e))
    const newSet = new Set(selectedSet)
    if (allSelected) {
      groupEvents.forEach((e) => newSet.delete(e))
    } else {
      groupEvents.forEach((e) => newSet.add(e))
    }
    onChange(Array.from(newSet))
  }

  const isGroupFullySelected = (group: EventGroup) => {
    const groupEvents = WEBHOOK_EVENTS[group].map((e) => e.id)
    return groupEvents.every((e) => selectedSet.has(e))
  }

  return (
    <div id={id} className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {(Object.keys(WEBHOOK_EVENTS) as EventGroup[]).map((group) => {
        const events = WEBHOOK_EVENTS[group]
        const groupLabel = group.charAt(0).toUpperCase() + group.slice(1)
        const fullySelected = isGroupFullySelected(group)

        return (
          <div key={group} className="rounded border p-3">
            {/* Group Header */}
            <div className="flex items-center justify-between mb-3 pb-2 border-b">
              <div className="text-sm font-medium">{groupLabel} Events</div>
              <div className="flex items-center gap-2">
                <input
                  id={`group-${group}`}
                  type="checkbox"
                  className="h-4 w-4"
                  checked={fullySelected}
                  disabled={disabled}
                  onChange={(e) => handleSelectAll(group)}
                />
                <label htmlFor={`group-${group}`} className="text-sm text-muted-foreground">
                  All
                </label>
              </div>
            </div>

            {/* Event Items */}
            <div className="space-y-2">
              {events.map((event) => {
                const isSelected = selectedSet.has(event.id)
                return (
                  <div key={event.id} className="flex items-center gap-2">
                    <input
                      id={`event-${event.id}`}
                      type="checkbox"
                      className="h-4 w-4"
                      checked={isSelected}
                      disabled={disabled}
                      onChange={() => handleToggle(event.id)}
                    />
                    <label
                      htmlFor={`event-${event.id}`}
                      className={`text-sm ${disabled ? 'text-muted-foreground' : ''}`}
                    >
                      {event.label}{' '}
                      <span className="text-muted-foreground text-xs">({event.id})</span>
                    </label>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Export list of all available events for validation
export const ALL_WEBHOOK_EVENTS = Object.values(WEBHOOK_EVENTS).flat().map((e) => e.id)
