// packages/ui/src/backend/filters/FilterFieldPicker.tsx
'use client'
import * as React from 'react'
import { Search, Activity, Calendar, Hash, Tag, ArrowRight, ALargeSmall, UserRound, Mail, Phone, Filter, type LucideIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverAnchor } from '../../primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterFieldDef, FilterFieldType } from '@open-mercato/shared/lib/query/advanced-filter'

const TYPE_ICON: Record<FilterFieldType, LucideIcon> = {
  text: ALargeSmall,
  select: Activity,
  tags: Tag,
  date: Calendar,
  number: Hash,
  boolean: ArrowRight,
}

const NAMED_ICONS: Record<string, LucideIcon> = {
  'user-round': UserRound,
  mail: Mail,
  phone: Phone,
  tag: Tag,
  filter: Filter,
}

function resolveIcon(field: FilterFieldDef): LucideIcon {
  if (field.iconName && NAMED_ICONS[field.iconName]) return NAMED_ICONS[field.iconName]
  return TYPE_ICON[field.type] ?? ALargeSmall
}

export type FilterFieldPickerProps = {
  fields: FilterFieldDef[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (field: FilterFieldDef) => void
  triggerRef: React.RefObject<HTMLElement | null>
}

export function FilterFieldPicker({ fields, open, onOpenChange, onSelect, triggerRef }: FilterFieldPickerProps) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [activeIdx, setActiveIdx] = React.useState(0)
  const searchRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => { if (open) { setQuery(''); setActiveIdx(0); searchRef.current?.focus() } }, [open])

  const filtered = React.useMemo(() => {
    if (!query.trim()) return fields
    const q = query.trim().toLowerCase()
    return fields.filter(f => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q))
  }, [fields, query])

  const grouped = React.useMemo(() => {
    const map = new Map<string, FilterFieldDef[]>()
    const order: string[] = []
    for (const f of filtered) {
      const g = f.group ?? 'More'
      if (!map.has(g)) { map.set(g, []); order.push(g) }
      map.get(g)!.push(f)
    }
    return order.map(g => ({ group: g, items: map.get(g)! }))
  }, [filtered])

  const flatVisible = React.useMemo(() => grouped.flatMap(g => g.items), [grouped])

  React.useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onOpenChange(false); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, flatVisible.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
      if (e.key === 'Enter') {
        e.preventDefault()
        const f = flatVisible[activeIdx]
        if (f) { onSelect(f); onOpenChange(false) }
      }
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault(); searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, flatVisible, activeIdx, onSelect, onOpenChange])

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {/* Radix expects RefObject<Measurable>; our prop accepts null. Narrow cast covers the React 19 ↔ Radix variance. */}
      <PopoverAnchor virtualRef={triggerRef as React.RefObject<{ getBoundingClientRect(): DOMRect }>} />
      <PopoverContent className="w-80 p-0" align="start" data-advanced-filter-portal="">
        <div className="flex flex-col">
          <div className="relative p-2 border-b border-border">
            <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActiveIdx(0) }}
              placeholder={t('ui.advancedFilter.fieldPicker.search', 'Search field…')}
              className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label={t('ui.advancedFilter.fieldPicker.search', 'Search field…')}
            />
          </div>
          <div className="max-h-[400px] overflow-y-auto py-1" role="listbox">
            {grouped.map(({ group, items }) => (
              <div key={group}>
                <div className="px-3 pt-2 pb-1 text-overline font-semibold uppercase tracking-widest text-muted-foreground">{group}</div>
                {items.map((f) => {
                  const flatIdx = flatVisible.indexOf(f)
                  const Icon = resolveIcon(f)
                  const active = flatIdx === activeIdx
                  return (
                    // Raw <button> required: needs role="option" inside the listbox, which <Button>
                    // would override (Button forces role="button"). a11y semantics take precedence
                    // over the primitive contract for listbox items.
                    <button
                      key={f.key}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => { onSelect(f); onOpenChange(false) }}
                      onMouseEnter={() => setActiveIdx(flatIdx)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent ${active ? 'bg-secondary' : ''}`}
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      <span>{f.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
            {t('ui.advancedFilter.fieldPicker.hint', 'Tip: Type to search, ↑↓ to navigate, Enter to select')}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
