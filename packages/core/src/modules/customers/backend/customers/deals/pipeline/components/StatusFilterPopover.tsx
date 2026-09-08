"use client"

import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { mapDictionaryColorToTone } from '@open-mercato/shared/lib/query/advanced-filter'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useCustomerDictionary } from '../../../../../components/detail/hooks/useCustomerDictionary'
import { canonicalDealStatus } from '../../../../../lib/dealStatus'
import { toneToDotClass } from './toneClasses'
import { ChipButton } from './ChipButton'
import { FilterPopoverShell } from './FilterPopoverShell'

/**
 * Filter options exposed to the operator.
 *
 * The deal `status` column is dictionary-driven (`deal-statuses`); the seeded dictionary
 * carries five values (`open`, `closed`, `win`, `lost`, `in_progress`) plus any
 * tenant-custom entries. We render every dictionary entry de-duplicated by canonical
 * spelling so the kanban Status pill stays aligned with the list page's advanced filter
 * (which also uses the dictionary). A hard-coded fallback keeps the popover usable while
 * the dictionary is loading or when a tenant has no entries.
 *
 * `won` / `loose` are accepted as aliases for `win` / `lost` at the API layer (see
 * `lib/dealStatus.ts:expandDealStatusAliases`, shared by the deals list route and the
 * kanban aggregate route). The UI only exposes the canonical values to avoid duplicate
 * pills, but `canonicalDealStatus` normalizes any alias passed in through `values` so
 * the chip and draft selection render the correct label.
 */
const FALLBACK_STATUS_OPTIONS: Array<{
  value: string
  labelKey: string
  labelFallback: string
  dotClass: string
}> = [
  {
    value: 'open',
    labelKey: 'customers.deals.kanban.filter.status.open',
    labelFallback: 'Open',
    // Tones mirror mapDictionaryColorToTone over the seeded dictionary colors
    // (#2563eb → info, #22c55e → success, #ef4444 → error) so the fallback pills
    // render identically to the dictionary-driven ones.
    dotClass: 'bg-status-info-icon',
  },
  {
    value: 'win',
    labelKey: 'customers.deals.kanban.filter.status.won',
    labelFallback: 'Won',
    dotClass: 'bg-status-success-icon',
  },
  {
    value: 'lost',
    labelKey: 'customers.deals.kanban.filter.status.lost',
    labelFallback: 'Lost',
    dotClass: 'bg-status-error-icon',
  },
  {
    value: 'closed',
    labelKey: 'customers.deals.kanban.filter.status.closed',
    labelFallback: 'Closed',
    dotClass: 'bg-status-neutral-icon',
  },
  {
    value: 'in_progress',
    labelKey: 'customers.deals.kanban.filter.status.inProgress',
    labelFallback: 'In progress',
    dotClass: 'bg-status-warning-icon',
  },
]

type StatusFilterPopoverProps = {
  values: string[]
  onApply: (next: string[]) => void
}

export function StatusFilterPopover({ values, onApply }: StatusFilterPopoverProps): React.ReactElement {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { data: dictionaryData, isLoading: dictionaryLoading } = useCustomerDictionary(
    'deal-statuses',
    scopeVersion,
  )
  const [open, setOpen] = React.useState(false)
  const normalizedValues = React.useMemo(
    () => Array.from(new Set(values.map(canonicalDealStatus))),
    [values],
  )
  const [draft, setDraft] = React.useState<string[]>(normalizedValues)

  React.useEffect(() => {
    if (open) setDraft(normalizedValues)
  }, [open, normalizedValues])

  const statusOptions = React.useMemo(() => {
    const entries = dictionaryData?.entries
    if (entries && entries.length > 0) {
      const byCanonical = new Map<string, { value: string; label: string; dotClass: string }>()
      for (const entry of entries) {
        const canonical = canonicalDealStatus(entry.value)
        if (byCanonical.has(canonical)) continue
        const tone = mapDictionaryColorToTone(entry.color ?? null)
        byCanonical.set(canonical, {
          value: canonical,
          label: entry.label,
          dotClass: toneToDotClass(tone),
        })
      }
      // Sort by label exactly like the List page's advanced filter
      // (backend/customers/deals/page.tsx dictionaryOptions) so both surfaces render
      // the same pills in the same order.
      return Array.from(byCanonical.values()).sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
      )
    }
    return FALLBACK_STATUS_OPTIONS.map((entry) => ({
      value: entry.value,
      label: translateWithFallback(t, entry.labelKey, entry.labelFallback),
      dotClass: entry.dotClass,
    }))
  }, [dictionaryData, t])

  const labelByValue = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const option of statusOptions) {
      map.set(option.value, option.label)
    }
    for (const fallback of FALLBACK_STATUS_OPTIONS) {
      if (!map.has(fallback.value)) {
        map.set(fallback.value, translateWithFallback(t, fallback.labelKey, fallback.labelFallback))
      }
    }
    return map
  }, [statusOptions, t])

  const chipLabel = translateWithFallback(t, 'customers.deals.kanban.filter.status', 'Status')
  const chipValue =
    normalizedValues.length === 0
      ? translateWithFallback(t, 'customers.deals.kanban.filter.all', 'All')
      : normalizedValues
          .map((value) => labelByValue.get(value) ?? value)
          .join(', ')

  const toggleDraft = (value: string) => {
    const normalized = canonicalDealStatus(value)
    setDraft((prev) =>
      prev.includes(normalized) ? prev.filter((entry) => entry !== normalized) : [...prev, normalized],
    )
  }

  const handleApply = () => {
    onApply(draft)
    setOpen(false)
  }

  // Cmd/Ctrl+Enter from anywhere inside the popover confirms — parity with the dialog
  // primary-action shortcut (`AGENTS.md` UI Interaction rules).
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleApply()
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton label={chipLabel} value={chipValue} active={normalizedValues.length > 0} />
      </PopoverTrigger>
      <PopoverContent
        className="w-96 rounded-2xl border-border bg-transparent p-0 shadow-xl"
        align="start"
        onKeyDown={handleKeyDown}
      >
        <FilterPopoverShell
          title={
            <>
              <span className="font-bold">
                {translateWithFallback(t, 'customers.deals.kanban.filter.status.title.label', 'Filter : ')}
              </span>
              <span className="font-normal">
                {translateWithFallback(t, 'customers.deals.kanban.filter.status', 'Status')}
              </span>
            </>
          }
          onClose={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          onApply={handleApply}
          footerLeft={
            <span>
              {draft.length}{' '}
              {translateWithFallback(t, 'customers.deals.kanban.filter.selected', 'selected')}
            </span>
          }
        >
          <span className="text-xs font-semibold uppercase leading-normal tracking-wide text-muted-foreground">
            {translateWithFallback(t, 'customers.deals.kanban.filter.status', 'Status')}
          </span>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
            {dictionaryLoading ? (
              <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
                <Spinner className="size-3" />
                {translateWithFallback(
                  t,
                  'customers.deals.kanban.filter.status.loading',
                  'Loading statuses…',
                )}
              </span>
            ) : (
              statusOptions.map((option) => {
              const isSelected = draft.includes(option.value)
              const label = option.label
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant="ghost"
                  size="2xs"
                  onClick={() => toggleDraft(option.value)}
                  aria-pressed={isSelected}
                  className={`gap-1.5 rounded-full px-2.5 py-1.5 text-xs leading-normal ${
                    isSelected
                      ? 'bg-muted font-semibold text-foreground'
                      : 'border border-border bg-card font-normal text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block size-2 shrink-0 rounded-full ${option.dotClass}`}
                    aria-hidden="true"
                  />
                  <span>{label}</span>
                  {isSelected ? (
                    <X className="size-2.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : null}
                </Button>
              )
              })
            )}
          </div>
        </FilterPopoverShell>
      </PopoverContent>
    </Popover>
  )
}

export default StatusFilterPopover
