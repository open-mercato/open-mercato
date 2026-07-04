"use client"

import * as React from 'react'
import { Box, Plus } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import type { EditorResource } from '../../../lib/calendar/editorPayload'
import { fetchResourceTypes, searchResourceOptions, type ResourceOption, type ResourceType } from './lookups'
import { CONTROL_BORDER, DROPDOWN_PANEL_CLASS, useDropdownDismiss } from './inputs'

// Multi-select of bookable resources (rooms, cars, equipment) from the
// resources module. Rendered only when that module is loaded — the calendar
// consumes its public list API and stores FK-id + label snapshots in
// `linkedEntities`, never resource entities (#3552). A potentially large
// catalog is kept navigable with a resource-type filter (with counts) plus a
// server-side search and a "showing N of M" hint.
export function ResourcesField({
  placeholder,
  ariaLabel,
  value,
  onChange,
}: {
  placeholder: string
  ariaLabel: string
  value: EditorResource[]
  onChange(next: EditorResource[]): void
}) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [options, setOptions] = React.useState<ResourceOption[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [types, setTypes] = React.useState<ResourceType[]>([])
  const [typeFilter, setTypeFilter] = React.useState<string | null>(null)
  const close = React.useCallback(() => setOpen(false), [])
  const rootRef = useDropdownDismiss(open, close)

  // Load the type filter once the dropdown first opens.
  React.useEffect(() => {
    if (!open || types.length > 0) return
    const controller = new AbortController()
    let cancelled = false
    fetchResourceTypes(controller.signal).then((found) => {
      if (!cancelled) setTypes(found)
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [open, types.length])

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const result = await searchResourceOptions({ query: query.trim(), resourceTypeId: typeFilter }, controller.signal)
        if (cancelled) return
        setOptions(result.items)
        setTotal(result.total)
      } catch {
        if (!cancelled) {
          setOptions([])
          setTotal(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, query, typeFilter])

  const selectedIds = new Set(value.map((resource) => resource.id))
  const visibleOptions = options.filter((option) => !selectedIds.has(option.id))
  const hiddenCount = Math.max(0, total - options.length)

  const chipClass = (active: boolean) =>
    cn(
      'shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
      active
        ? 'border-accent-indigo bg-accent-indigo text-accent-indigo-foreground'
        : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
    )

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <div
        className={cn(
          'flex min-h-14 w-full flex-wrap content-center items-center gap-2 rounded-md bg-background px-2.5 py-2',
          CONTROL_BORDER,
        )}
      >
        {value.map((resource) => (
          <span key={resource.id} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted py-1 pl-2 pr-2">
            <Box aria-hidden className="size-3.5 text-muted-foreground" />
            <span className="max-w-40 truncate text-xs font-medium text-foreground">{resource.label}</span>
            <IconButton
              variant="ghost"
              size="xs"
              onClick={(event) => {
                event.stopPropagation()
                onChange(value.filter((entry) => entry.id !== resource.id))
              }}
              aria-label={t('customers.calendar.editor.removeResource', 'Remove {name}', { name: resource.label })}
              className="size-5 shrink-0"
            >
              <Plus aria-hidden className="size-3.5 rotate-45 opacity-50" />
            </IconButton>
          </span>
        ))}
        <Input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={open}
          className="min-w-36 flex-1 border-0 bg-transparent px-0 shadow-none hover:bg-transparent focus-within:border-transparent focus-within:shadow-none"
          inputClassName="text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>
      {open ? (
        <div className={cn(DROPDOWN_PANEL_CLASS, 'flex max-h-none flex-col overflow-visible p-0')}>
          {types.length > 0 ? (
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border p-2">
              <button type="button" className={chipClass(typeFilter === null)} onClick={() => setTypeFilter(null)}>
                {t('customers.calendar.editor.resourceTypes.all', 'All')}
              </button>
              {types.map((type) => (
                <button key={type.id} type="button" className={chipClass(typeFilter === type.id)} onClick={() => setTypeFilter(type.id)}>
                  {type.name}
                  <span className="ml-1 tabular-nums opacity-70">{type.count}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div role="listbox" aria-label={ariaLabel} className="max-h-56 overflow-y-auto p-1">
            {loading ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {t('customers.calendar.editor.searching', 'Searching…')}
              </p>
            ) : null}
            {!loading && visibleOptions.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {t('customers.calendar.editor.noResults', 'No results')}
              </p>
            ) : null}
            {!loading
              ? visibleOptions.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant="ghost"
                    role="option"
                    aria-selected={false}
                    title={option.label}
                    onClick={() => {
                      onChange([...value, { id: option.id, label: option.label }])
                      setQuery('')
                    }}
                    className="h-auto w-full justify-start gap-2 whitespace-normal px-2 py-1.5 text-left text-sm font-normal text-foreground"
                  >
                    <Box aria-hidden className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </Button>
                ))
              : null}
          </div>
          {!loading && hiddenCount > 0 ? (
            <p className="border-t border-border px-2 py-1.5 text-center text-xs text-muted-foreground">
              {t('customers.calendar.editor.resourceTypes.moreHint', 'Showing {shown} of {total} — keep typing to narrow', {
                shown: options.length,
                total,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
