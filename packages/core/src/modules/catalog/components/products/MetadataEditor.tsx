"use client"

import * as React from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@/lib/i18n/context'
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

export function MetadataEditor({
  value,
  onChange,
  defaultCollapsed = true,
  title,
  description,
}: MetadataEditorProps) {
  const t = useT()
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed)
  const [entries, setEntries] = React.useState<MetadataEntry[]>(() => toEntries(value))

  React.useEffect(() => {
    setEntries(toEntries(value))
  }, [value])

  const emitChange = React.useCallback((nextEntries: MetadataEntry[]) => {
    setEntries(nextEntries)
    const next: Record<string, unknown> = {}
    nextEntries.forEach(({ key, value }) => {
      const normalizedKey = key.trim()
      if (!normalizedKey.length) return
      next[normalizedKey] = parseMetadataValue(value)
    })
    onChange(next)
  }, [onChange])

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

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{title ?? t('catalog.products.edit.metadata.title', 'Metadata')}</p>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('catalog.products.edit.metadata.hint', 'Attach structured key/value pairs for integrations.')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
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
            <div key={entry.id} className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 sm:flex-row sm:items-center">
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
    </div>
  )
}
