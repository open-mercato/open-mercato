"use client"

import * as React from 'react'
import { Check, Search } from 'lucide-react'
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
import { FilterPopoverShell } from './FilterPopoverShell'

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
 * Reusable async-search multi-select popover used by Owner / People / Companies kanban filter
 * chips. Wraps the shared FilterPopoverShell so the chrome (rounded-2xl container, white header
 * with bold title, muted footer with Cancel + Apply) matches the SPEC-048 mock surfaces for the
 * Status (1045:11861) and Pipeline (1045:11917) popovers.
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

  const headerTitle = title ?? translateWithFallback(
    t,
    'customers.deals.kanban.filter.title',
    'Filter · {label}',
    { label },
  )

  const footerLeft = (
    <div className="flex items-center gap-3">
      <span>
        {draft.length === 0
          ? translateWithFallback(t, 'customers.deals.kanban.filter.noneSelected', 'None selected')
          : translateWithFallback(
              t,
              'customers.deals.kanban.filter.countSelected',
              '{count} selected',
              { count: draft.length },
            )}
      </span>
      {draft.length > 0 ? (
        <button
          type="button"
          onClick={handleClear}
          className="text-xs font-medium leading-normal text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {translateWithFallback(t, 'customers.deals.kanban.filter.clear', 'Clear')}
        </button>
      ) : null}
    </div>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton label={label} value={chipValue} active={values.length > 0} />
      </PopoverTrigger>
      <PopoverContent
        className="w-96 rounded-2xl border-border bg-transparent p-0 shadow-xl"
        align="start"
        onKeyDown={handleKeyDown}
      >
        <FilterPopoverShell
          title={headerTitle}
          onClose={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          onApply={handleApply}
          footerLeft={footerLeft}
          bodyClassName="flex flex-col bg-card"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
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

          <div className="max-h-64 overflow-y-auto">
            {options.length === 0 && !isLoading ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
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
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                          checked ? 'bg-muted/60' : 'bg-card'
                        }`}
                      >
                        <span
                          className={`flex size-4 shrink-0 items-center justify-center rounded-sm border ${
                            checked
                              ? 'border-accent-indigo bg-accent-indigo text-accent-indigo-foreground'
                              : 'border-input bg-card'
                          }`}
                          aria-hidden="true"
                        >
                          {checked ? <Check className="size-3" /> : null}
                        </span>
                        <span
                          className={`truncate text-sm leading-normal text-foreground ${
                            checked ? 'font-semibold' : 'font-normal'
                          }`}
                        >
                          {option.label}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </FilterPopoverShell>
      </PopoverContent>
    </Popover>
  )
}

export default EntityFilterPopover
