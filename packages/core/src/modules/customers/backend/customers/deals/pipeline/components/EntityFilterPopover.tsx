"use client"

import * as React from 'react'
import { Check, Search, X } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { ChipButton } from './ChipButton'

export type EntityFilterOption = {
  value: string
  label: string
}

type EntityFilterPopoverProps = {
  /** Chip label (e.g. "Owner") */
  label: string
  /** Currently selected ids */
  values: string[]
  /** Apply selected ids back to parent */
  onApply: (next: string[]) => void
  /** Optional initial set of options to show before the user types */
  initialOptions?: EntityFilterOption[]
  /** Async loader called whenever the search query changes (debounced) */
  loadOptions: (query: string, signal: AbortSignal) => Promise<EntityFilterOption[]>
  /** Labels for selected ids — used to display the chip value when only ids are known */
  labelById?: Record<string, string>
  /** Placeholder shown when nothing is selected */
  anyLabel?: string
  /** Title for the popover header */
  title?: string
}

const DEBOUNCE_MS = 250

/**
 * Reusable async-search multi-select popover used by Owner / People / Companies kanban filter chips.
 * Mirrors the pattern from People list page's owner filter but bound to a chip trigger.
 */
export function EntityFilterPopover({
  label,
  values,
  onApply,
  initialOptions,
  loadOptions,
  labelById,
  anyLabel,
  title,
}: EntityFilterPopoverProps): React.ReactElement {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<string[]>(values)
  const [query, setQuery] = React.useState('')
  const [options, setOptions] = React.useState<EntityFilterOption[]>(initialOptions ?? [])
  const [isLoading, setIsLoading] = React.useState(false)

  // Reset draft to current applied state whenever the popover opens
  React.useEffect(() => {
    if (open) {
      setDraft(values)
      setQuery('')
      setOptions(initialOptions ?? [])
    }
  }, [open, values, initialOptions])

  // Debounced async option loader
  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const handle = window.setTimeout(async () => {
      setIsLoading(true)
      try {
        const items = await loadOptions(query, controller.signal)
        setOptions(items)
      } catch (err) {
        if (controller.signal.aborted) return
      } finally {
        setIsLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(handle)
      controller.abort()
    }
  }, [open, query, loadOptions])

  const chipValue = React.useMemo(() => {
    if (values.length === 0) {
      return anyLabel ?? translateWithFallback(t, 'customers.deals.kanban.filter.any', 'Any')
    }
    if (values.length === 1) {
      const id = values[0]
      const fromLabels = labelById?.[id]
      if (fromLabels) return fromLabels
      const fromOptions = options.find((o) => o.value === id)?.label
      if (fromOptions) return fromOptions
      return id.slice(0, 8)
    }
    return translateWithFallback(
      t,
      'customers.deals.kanban.filter.multipleSelected',
      '{count} selected',
      { count: values.length },
    )
  }, [values, anyLabel, labelById, options, t])

  const toggleDraft = (id: string) => {
    setDraft((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
  }

  const handleApply = () => {
    onApply(draft)
    setOpen(false)
  }
  const handleClear = () => {
    setDraft([])
  }

  // Cmd/Ctrl+Enter from anywhere inside the popover confirms — parity with the dialog
  // primary-action shortcut (`AGENTS.md` UI Interaction rules). Also works while typing
  // in the search box because keydown bubbles up to the PopoverContent root.
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleApply()
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton label={label} value={chipValue} active={values.length > 0} />
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start" onKeyDown={handleKeyDown}>
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="text-sm font-semibold text-foreground">
            {title ?? translateWithFallback(t, 'customers.deals.kanban.filter.title', 'Filter · {label}', { label })}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={translateWithFallback(t, 'customers.deals.kanban.filter.close', 'Close')}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={translateWithFallback(
              t,
              'customers.deals.kanban.filter.searchPlaceholder',
              'Search…',
            )}
            className="h-7 w-full bg-transparent text-sm leading-normal text-foreground outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          {isLoading ? <Spinner className="size-3" /> : null}
        </div>

        <div className="max-h-[260px] overflow-y-auto">
          {options.length === 0 && !isLoading ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {translateWithFallback(t, 'customers.deals.kanban.filter.noResults', 'No matches')}
            </div>
          ) : (
            <ul className="py-1">
              {options.map((option) => {
                const checked = draft.includes(option.value)
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      onClick={() => toggleDraft(option.value)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm leading-normal transition-colors hover:bg-muted ${
                        checked ? 'text-foreground' : 'text-foreground/80'
                      }`}
                    >
                      <span
                        className={`flex size-4 shrink-0 items-center justify-center rounded-sm border ${
                          checked
                            ? 'border-accent-indigo bg-accent-indigo text-white'
                            : 'border-input bg-card'
                        }`}
                        aria-hidden="true"
                      >
                        {checked ? <Check className="size-3" /> : null}
                      </span>
                      <span className="truncate">{option.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={handleClear}
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {translateWithFallback(t, 'customers.deals.kanban.filter.clear', 'Clear')}
          </button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" type="button" onClick={() => setOpen(false)}>
              {translateWithFallback(t, 'customers.deals.kanban.filter.cancel', 'Cancel')}
            </Button>
            <Button size="sm" type="button" onClick={handleApply}>
              {translateWithFallback(t, 'customers.deals.kanban.filter.apply', 'Apply')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default EntityFilterPopover
