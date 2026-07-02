"use client"

import * as React from 'react'
import { Box, Plus } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import type { EditorResource } from '../../../lib/calendar/editorPayload'
import { searchResourceOptions, type ResourceOption } from './lookups'
import { CONTROL_BORDER, DROPDOWN_PANEL_CLASS, useDropdownDismiss } from './inputs'

// Multi-select of bookable resources (rooms, cars, equipment) from the
// resources module. Rendered only when that module is loaded — the calendar
// consumes its public list API and stores FK-id + label snapshots in
// `linkedEntities`, never resource entities (#3552).
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
  const [loading, setLoading] = React.useState(false)
  const close = React.useCallback(() => setOpen(false), [])
  const rootRef = useDropdownDismiss(open, close)

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const results = await searchResourceOptions(query.trim(), controller.signal)
        if (cancelled) return
        setOptions(results)
      } catch {
        if (!cancelled) setOptions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, query])

  const selectedIds = new Set(value.map((resource) => resource.id))
  const visibleOptions = options.filter((option) => !selectedIds.has(option.id))

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
        <div role="listbox" aria-label={ariaLabel} className={DROPDOWN_PANEL_CLASS}>
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
      ) : null}
    </div>
  )
}
