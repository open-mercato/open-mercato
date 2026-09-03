'use client'

import * as React from 'react'
import { Image as ImageIcon, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { LUCIDE_ICON_REGISTRY, resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistry'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { filterIconNames, normalizeIconName } from '../lib/icon-search'

export interface WorkflowIconPickerProps {
  id?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * Searchable icon grid for a definition's `metadata.icon` (spec section 4.5).
 *
 * The grid is backed by the platform's shared lucide registry, which `AppShell`
 * already loads on every backend page — so a searchable grid over ~250 icons
 * costs the editor chunk nothing, where importing `lucide-react` wholesale would
 * have been the classic bundle regression.
 *
 * Free text stays the fallback, deliberately: `metadata.icon` has always been an
 * open string, an author may reference an icon the registry has not picked up
 * yet, and a picker that silently dropped such a value would be a data-losing
 * "improvement". Existing values in any casing (`ShoppingCart`,
 * `lucide:shopping-cart`) load with their icon selected.
 */
export function WorkflowIconPicker({ id, value, onChange, disabled }: WorkflowIconPickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  const iconNames = React.useMemo(() => Object.keys(LUCIDE_ICON_REGISTRY), [])
  const results = React.useMemo(() => filterIconNames(iconNames, query), [iconNames, query])

  const normalizedValue = normalizeIconName(value)
  const SelectedIcon = resolveRegisteredLucideIcon(value)
  const isUnknownValue = value.trim().length > 0 && !SelectedIcon

  const select = React.useCallback((name: string) => {
    onChange(name)
    setOpen(false)
  }, [onChange])

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setQuery('') }}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={t('workflows.form.iconPicker.trigger', 'Choose an icon')}
            className="h-8 min-w-0 flex-1 justify-start gap-2 px-2 text-xs font-normal"
          >
            {SelectedIcon ? (
              <SelectedIcon className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
            ) : (
              <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="truncate">
              {value.trim().length > 0 ? value : t('workflows.form.iconPicker.none', 'No icon')}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('workflows.form.iconPicker.searchPlaceholder', 'Search icons…')}
            aria-label={t('workflows.form.iconPicker.searchLabel', 'Search icons')}
            className="h-8 text-sm"
            autoFocus
          />
          {results.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              {t('workflows.form.iconPicker.noResults', 'No icon matches "{query}"', { query })}
            </p>
          ) : (
            <div role="listbox" aria-label={t('workflows.form.iconPicker.gridLabel', 'Icons')} className="mt-2 grid max-h-64 grid-cols-8 gap-1 overflow-y-auto">
              {results.map((name) => {
                const Icon = LUCIDE_ICON_REGISTRY[name]
                const isSelected = name === normalizedValue
                return (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    title={name}
                    aria-label={name}
                    onClick={() => select(name)}
                    className={`flex h-8 w-8 items-center justify-center rounded-md border text-foreground hover:bg-muted ${
                      isSelected ? 'border-primary bg-muted' : 'border-transparent'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </button>
                )
              })}
            </div>
          )}
          <div className="mt-2 space-y-1 border-t border-border pt-2">
            <label htmlFor={`${id ?? 'workflow-icon'}-custom`} className="text-overline uppercase tracking-wide text-muted-foreground">
              {t('workflows.form.iconPicker.customLabel', 'Or enter a name')}
            </label>
            <Input
              id={`${id ?? 'workflow-icon'}-custom`}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="shopping-cart"
              className="h-8 text-sm"
            />
            {isUnknownValue && (
              <p className="text-xs text-status-warning-text">
                {t('workflows.form.iconPicker.unknown', 'This name is not in the icon set — it is kept as written and no icon renders.')}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {value.trim().length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onChange('')}
          aria-label={t('workflows.form.iconPicker.clear', 'Clear icon')}
          className="h-8 w-8 shrink-0 p-0"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
