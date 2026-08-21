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
import { useCustomerDictionary } from '../../../../../components/detail/hooks/useCustomerDictionary'
import { ChipButton } from './ChipButton'
import { FilterPopoverShell } from './FilterPopoverShell'

const STATUS_SYNONYMS: Record<string, string> = {
  won: 'win',
  lost: 'loose',
}

function normalizeStatusValue(value: string): string {
  const lower = value.toLowerCase()
  return STATUS_SYNONYMS[lower] ?? value
}

function toneToDotClass(tone: string | null | undefined): string {
  switch (tone) {
    case 'success':
      return 'bg-status-success-icon'
    case 'warning':
      return 'bg-status-warning-icon'
    case 'error':
      return 'bg-status-error-icon'
    case 'info':
      return 'bg-status-info-icon'
    case 'brand':
      return 'bg-status-brand-icon'
    default:
      return 'bg-status-neutral-icon'
  }
}

/**
 * Filter options exposed to the operator.
 *
 * The deal `status` column is dictionary-driven (`deal-statuses`), but the seeded defaults
 * are the historical 3-value set (`open` | `win` | `loose`) plus optional tenant-custom values.
 * We source options from the dictionary so the kanban Status pill stays aligned with the list
 * page's advanced filter (which also uses the dictionary). A hard-coded fallback keeps the
 * popover usable when the dictionary is still loading or the tenant has no custom entries.
 *
 * `won` / `lost` are accepted as aliases for `win` / `loose` at the API layer (see
 * `api/deals/route.ts:expandStatusList`). The UI only exposes the canonical values to avoid
 * duplicate pills, but `normalizeStatusValue` ensures a URL that carries an alias still
 * renders the correct label.
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
    dotClass: 'bg-status-success-icon',
  },
  {
    value: 'win',
    labelKey: 'customers.deals.kanban.filter.status.won',
    labelFallback: 'Won',
    dotClass: 'bg-status-warning-icon',
  },
  {
    value: 'loose',
    labelKey: 'customers.deals.kanban.filter.status.lost',
    labelFallback: 'Lost',
    dotClass: 'bg-status-neutral-icon',
  },
]

type StatusFilterPopoverProps = {
  values: string[]
  onApply: (next: string[]) => void
}

export function StatusFilterPopover({ values, onApply }: StatusFilterPopoverProps): React.ReactElement {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { data: dictionaryData } = useCustomerDictionary('deal-statuses', scopeVersion)
  const [open, setOpen] = React.useState(false)
  const normalizedValues = React.useMemo(() => values.map(normalizeStatusValue), [values])
  const [draft, setDraft] = React.useState<string[]>(normalizedValues)

  React.useEffect(() => {
    if (open) setDraft(normalizedValues)
  }, [open, normalizedValues])

  const statusOptions = React.useMemo(() => {
    const entries = dictionaryData?.entries
    if (entries && entries.length > 0) {
      return (entries as Array<{ value: string; label: string; color?: string | null }>).map((entry) => {
        const tone = mapDictionaryColorToTone(entry.color ?? null)
        return {
          value: entry.value,
          label: entry.label,
          dotClass: toneToDotClass(tone),
        }
      })
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
    const normalized = normalizeStatusValue(value)
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
        <ChipButton label={chipLabel} value={chipValue} active={values.length > 0} />
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
            {statusOptions.map((option: { value: string; label: string; dotClass: string }) => {
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
            })}
          </div>
        </FilterPopoverShell>
      </PopoverContent>
    </Popover>
  )
}

export default StatusFilterPopover
