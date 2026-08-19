"use client"

import * as React from 'react'
import { Plus, Tag as TagIcon } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { resolveProjectColorHex } from '../timesheets-ui/colors'
import type { TagOption } from './timeEntryDialogState'

/**
 * Renders a stored tag colour as a readable chip.
 *
 * `staff_time_tags.color` holds a DS palette key and has been written since the
 * table existed; nothing ever read it, so every chip was grey. The hue tints the
 * background and paints the border while the text stays on the foreground token,
 * which keeps contrast legible in both themes rather than trusting a palette
 * colour to be readable as text.
 */
export function tagChipStyle(tag: { color?: string | null; label: string }): React.CSSProperties | undefined {
  if (!tag.color) return undefined
  const hex = resolveProjectColorHex(tag.color, tag.label)
  return { backgroundColor: `${hex}1f`, borderColor: `${hex}66` }
}

export type TagPickerProps = {
  available: TagOption[]
  onAssign: (tagId: string) => void
  /** Resolves with the new tag, or null when the write failed. */
  onCreate: (label: string) => Promise<TagOption | null>
  labels: { add: string; create: (name: string) => string; empty: string }
  disabled?: boolean
}

/**
 * Assign an existing tag or make one on the spot.
 *
 * Creation is open to anyone who can log time, deliberately: a consultant blocked
 * mid-entry because the tag they need does not exist yet will either abandon the
 * tag or invent a worse one in the description. The cost is a vocabulary that
 * grows organically and will want tidying — a curation surface, not a gate here.
 */
export function TagPicker({ available, onAssign, onCreate, labels, disabled }: TagPickerProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const term = query.trim()
  const matches = React.useMemo(
    () => available.filter((tag) => tag.label.toLowerCase().includes(term.toLowerCase())),
    [available, term],
  )
  // Only offered when nothing already carries that exact name, so the control
  // never invites a duplicate of a tag sitting one row above it.
  const canCreate =
    term.length > 0 && !available.some((tag) => tag.label.toLowerCase() === term.toLowerCase())

  const create = React.useCallback(async () => {
    if (!canCreate || creating) return
    setCreating(true)
    try {
      const created = await onCreate(term)
      if (created) {
        onAssign(created.id)
        setQuery('')
        setOpen(false)
      }
    } finally {
      setCreating(false)
    }
  }, [canCreate, creating, onAssign, onCreate, term])

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid="entry-dialog-tag-select"
      >
        <TagIcon className="size-3.5" aria-hidden="true" />
        {labels.add}
      </Button>

      {open ? (
        <div className="absolute z-popover mt-1 w-64 rounded-md border border-border bg-popover p-2 shadow-md">
          <Input
            autoFocus
            value={query}
            size="sm"
            placeholder={labels.add}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (matches.length > 0 && !canCreate) {
                onAssign(matches[0].id)
                setQuery('')
                setOpen(false)
                return
              }
              void create()
            }}
            data-testid="entry-dialog-tag-search"
          />
          <div className="mt-1 max-h-48 overflow-y-auto" role="listbox">
            {matches.map((tag) => (
              <button
                key={tag.id}
                type="button"
                role="option"
                aria-selected="false"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onAssign(tag.id)
                  setQuery('')
                  setOpen(false)
                }}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: resolveProjectColorHex(tag.color, tag.label) }}
                  aria-hidden
                />
                <span className="truncate">{tag.label}</span>
              </button>
            ))}
            {matches.length === 0 && !canCreate ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">{labels.empty}</p>
            ) : null}
          </div>
          {canCreate ? (
            <button
              type="button"
              className="mt-1 flex w-full items-center gap-2 rounded-sm border-t border-border px-2 py-1.5 text-left text-sm hover:bg-accent"
              disabled={creating}
              onClick={() => { void create() }}
              data-testid="entry-dialog-tag-create"
            >
              <Plus className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{labels.create(term)}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default TagPicker
