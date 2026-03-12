"use client"

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export type FilterState<K extends string = string> = Set<K>

export function TimelineFilterDropdown<K extends string>({
  allKinds,
  kindLabels,
  selected,
  onChange,
  t,
}: {
  allKinds: readonly K[]
  kindLabels: Record<K, string>
  selected: FilterState<K>
  onChange: (next: FilterState<K>) => void
  t: TranslateFn
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const allSelected = selected.size === 0

  React.useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function toggle(kind: K) {
    const next = new Set(selected)
    if (next.has(kind)) {
      next.delete(kind)
    } else {
      next.add(kind)
    }
    onChange(next)
  }

  function selectAll() {
    onChange(new Set())
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => setOpen((prev) => !prev)}
      >
        {t('timeline.filterLabel', 'Filter')}
        {!allSelected ? ` (${selected.size})` : ''}
        <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border bg-card p-2 shadow-lg">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs h-auto py-1"
            onClick={selectAll}
          >
            {t('timeline.filterAll', 'All events')}
          </Button>
          <div className="my-1 border-t" />
          {allKinds.map((kind) => {
            const checked = allSelected || selected.has(kind)
            return (
              <label
                key={kind}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  className="rounded border-border"
                  checked={checked}
                  onChange={() => toggle(kind)}
                />
                <span>{kindLabels[kind]}</span>
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
