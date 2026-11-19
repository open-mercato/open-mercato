"use client"

import * as React from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLocalId } from './productForm'

type MetadataEntry = {
  id: string
  key: string
  value: string
}

type MetadataEditorProps = {
  value?: Record<string, unknown> | null
  onChange: (next: Record<string, unknown>) => void
  defaultCollapsed?: boolean
  title?: string
  description?: string
  embedded?: boolean
}

const toEntries = (value?: Record<string, unknown> | null): MetadataEntry[] => {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).map(([key, entry]) => ({
    id: `${key}-${createLocalId()}`,
    key,
    value: serializeMetadataValue(entry),
  }))
}

const serializeMetadataValue = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const parseMetadataValue = (raw: string): unknown => {
  const trimmed = raw.trim()
  if (!trimmed.length) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  const numeric = Number(trimmed)
  if (!Number.isNaN(numeric) && trimmed === `${numeric}`) return numeric
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

const jsonValuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => jsonValuesEqual(item, b[index]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aRecord = a as Record<string, unknown>
    const bRecord = b as Record<string, unknown>
    const aKeys = Object.keys(aRecord)
    const bKeys = Object.keys(bRecord)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(bRecord, key) && jsonValuesEqual(aRecord[key], bRecord[key]),
    )
  }
  return false
}

const isPlainObjectOrArray = (value: unknown): boolean => value !== null && typeof value === 'object'

const entriesMatchValue = (entries: MetadataEntry[], value?: Record<string, unknown> | null): boolean => {
  const incoming = value && typeof value === 'object' ? value : {}
  // A blank (whitespace-only) key is excluded as a draft-in-progress only
  // when the incoming side has nothing stored under that exact key — the
  // metadata schema allows a legitimate whitespace-only key (e.g. `{" ":
  // "legacy"}`), and that row must stay counted as committed, not dropped
  // as a draft, or an equivalent rerender would wrongly wipe a real blank
  // draft row alongside it. The key used for lookup stays untrimmed, so a
  // stored key with surrounding whitespace still matches the incoming
  // value's verbatim key instead of silently failing to look it up.
  const committedRaw = new Map<string, string>()
  for (const entry of entries) {
    if (entry.key.trim().length === 0 && !Object.prototype.hasOwnProperty.call(incoming, entry.key)) continue
    committedRaw.set(entry.key, entry.value)
  }
  const incomingKeys = Object.keys(incoming)
  if (committedRaw.size !== incomingKeys.length) return false
  return incomingKeys.every((key) => {
    if (!committedRaw.has(key)) return false
    const rawValue = committedRaw.get(key) as string
    const incomingValue = (incoming as Record<string, unknown>)[key]
    // Branch on the incoming value's own type — the authoritative source —
    // never on re-parsing the local text input: a string that merely LOOKS
    // like JSON (e.g. the literal string '{"enabled":true}') re-parses to
    // an object, which would wrongly select the structural branch below
    // against an incoming value that is actually still that same string.
    if (isPlainObjectOrArray(incomingValue)) {
      return jsonValuesEqual(parseMetadataValue(rawValue), incomingValue)
    }
    // Scalars (null, string, number, boolean) compare the literal string
    // form rather than the re-parsed value: parsing is lossy and ambiguous
    // for scalars — a `null` serializes to `''` and re-parses back to `''`
    // rather than `null`, and a string "42" re-parses as the number 42 —
    // so comparing re-parsed values spuriously flags an unrelated refetch
    // of an unchanged null/string entry as a real change, wiping any blank
    // draft row alongside it. Serializing the incoming value the same way
    // the entry's own text input was serialized is lossless for this check.
    return rawValue === serializeMetadataValue(incomingValue)
  })
}

export function MetadataEditor({
  value,
  onChange,
  defaultCollapsed = true,
  title,
  description,
  embedded = false,
}: MetadataEditorProps) {
  const t = useT()
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed)
  const [entries, setEntries] = React.useState<MetadataEntry[]>(() => toEntries(value))
  const skipSyncRef = React.useRef(false)

  React.useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false
      return
    }
    setEntries((prevEntries) => (entriesMatchValue(prevEntries, value) ? prevEntries : toEntries(value)))
  }, [value])

  const emitChange = React.useCallback(
    (nextEntries: MetadataEntry[]) => {
      skipSyncRef.current = true
      setEntries(nextEntries)
      const next: Record<string, unknown> = {}
      nextEntries.forEach(({ key, value }) => {
        const normalizedKey = key.trim()
        if (!normalizedKey.length) return
        next[normalizedKey] = parseMetadataValue(value)
      })
      onChange(next)
    },
    [onChange],
  )

  const updateEntry = React.useCallback(
    (id: string, field: 'key' | 'value', nextValue: string) => {
      const next = entries.map((entry) => (entry.id === id ? { ...entry, [field]: nextValue } : entry))
      emitChange(next)
    },
    [emitChange, entries],
  )

  const addEntry = React.useCallback(() => {
    const next: MetadataEntry[] = [...entries, { id: createLocalId(), key: '', value: '' }]
    emitChange(next)
    setCollapsed(false)
  }, [emitChange, entries])

  const removeEntry = React.useCallback(
    (id: string) => {
      emitChange(entries.filter((entry) => entry.id !== id))
    },
    [emitChange, entries],
  )

  const resolvedTitle = title ?? t('catalog.products.edit.metadata.title', 'Metadata')
  const resolvedDescription =
    description ?? t('catalog.products.edit.metadata.hint', 'Attach structured key/value pairs for integrations.')
  const hasTitle = typeof resolvedTitle === 'string' && resolvedTitle.trim().length > 0
  const hasDescription = typeof resolvedDescription === 'string' && resolvedDescription.trim().length > 0

  const content = (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          {hasTitle ? <p className="text-sm font-medium">{resolvedTitle}</p> : null}
          {hasDescription ? <p className="text-xs text-muted-foreground">{resolvedDescription}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed((prev) => !prev)}
            className="gap-2 text-xs"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {collapsed
              ? t('catalog.products.edit.metadata.expand', 'Show metadata')
              : t('catalog.products.edit.metadata.collapse', 'Hide metadata')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={addEntry}>
            <Plus className="mr-1 h-4 w-4" />
            {t('catalog.products.edit.metadata.add', 'Add entry')}
          </Button>
        </div>
      </div>
      {!collapsed ? (
        <div className="mt-3 space-y-3">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('catalog.products.edit.metadata.empty', 'No metadata. Add your first entry.')}
            </p>
          ) : null}
          {entries.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-2 rounded-md bg-muted/50 p-3 sm:flex-row sm:items-center">
              <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                <Input
                  value={entry.key}
                  placeholder={t('catalog.products.edit.metadata.keyPlaceholder', 'Key')}
                  onChange={(event) => updateEntry(entry.id, 'key', event.target.value)}
                  className="sm:flex-1"
                />
                <Input
                  value={entry.value}
                  placeholder={t('catalog.products.edit.metadata.valuePlaceholder', 'Value')}
                  onChange={(event) => updateEntry(entry.id, 'value', event.target.value)}
                  className="sm:flex-1"
                />
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeEntry(entry.id)}>
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                <span className="sr-only">{t('catalog.products.edit.metadata.remove', 'Remove entry')}</span>
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )

  if (embedded) {
    return <div className="space-y-3">{content}</div>
  }

  return <div className="rounded-lg border p-4">{content}</div>
}
