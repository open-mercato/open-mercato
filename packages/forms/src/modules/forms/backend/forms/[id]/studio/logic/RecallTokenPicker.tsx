'use client'

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AtSign } from '../lucide-icons'

export type RecallTokenOption = {
  /** The bare identifier inserted between `@{` / `}` — e.g. `name`, `hidden.x`, `var.y`. */
  value: string
  label: string
  namespace: 'field' | 'hidden' | 'variable'
}

export type RecallTokenPickerProps = {
  options: RecallTokenOption[]
  onInsert: (token: string) => void
  ariaLabel?: string
}

export function RecallTokenPicker({ options, onInsert, ariaLabel }: RecallTokenPickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const filtered = React.useMemo(() => {
    if (!filter.trim()) return options
    const needle = filter.trim().toLowerCase()
    return options.filter(
      (entry) =>
        entry.value.toLowerCase().includes(needle) || entry.label.toLowerCase().includes(needle),
    )
  }, [options, filter])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          aria-label={ariaLabel ?? t('forms.studio.recall.trigger.ariaLabel')}
          variant="ghost"
          size="sm"
          type="button"
        >
          <AtSign className="size-4" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="z-popover w-64 p-2" align="end">
        <div className="space-y-2">
          <Input
            autoFocus
            placeholder={t('forms.studio.recall.picker.placeholder')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          {filtered.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">
              {t('forms.studio.recall.picker.empty')}
            </p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-auto">
              {filtered.map((entry) => (
                <li key={entry.value}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted"
                    onClick={() => {
                      onInsert(`@{${entry.value}}`)
                      setOpen(false)
                      setFilter('')
                    }}
                  >
                    <span className="font-mono">{entry.value}</span>
                    <span className="text-muted-foreground">{entry.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
