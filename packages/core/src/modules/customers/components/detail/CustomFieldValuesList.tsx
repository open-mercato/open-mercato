"use client"

import * as React from 'react'
import {
  DictionaryValue,
  type DictionaryMap,
} from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { cn } from '@open-mercato/shared/lib/utils'
import type { CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import {
  extractDictionaryValue,
  formatCustomFieldLabel,
  isEmptyCustomValue,
  normalizeCustomFieldKey,
  stringifyCustomValue,
} from './customFieldUtils'
import type { CustomFieldDisplayResources } from './hooks/useCustomFieldDisplay'

type CustomFieldEntry = {
  key: string
  value: unknown
  label?: string | null
}

type DisplayEntry = {
  id: string
  key: string
  normalizedKey: string
  label: string
  value: unknown
  dictionaryMap: DictionaryMap | null
  multi: boolean
}

type CustomFieldValuesListProps = {
  values?: Record<string, unknown> | null
  entries?: CustomFieldEntry[]
  definitions?: CustomFieldDefDto[]
  dictionaryMapsByKey?: Record<string, DictionaryMap>
  resources?: CustomFieldDisplayResources
  emptyLabel?: string
  className?: string
  itemKeyPrefix?: string
}

function defaultEmptyLabel(label?: string): string {
  if (typeof label === 'string' && label.trim().length) return label
  return '—'
}

function ensureDictionaryMap(
  key: string,
  normalizedKey: string,
  dictionaryMaps?: Record<string, DictionaryMap>,
): DictionaryMap | null {
  if (!dictionaryMaps) return null
  if (dictionaryMaps[key]) return dictionaryMaps[key]
  if (dictionaryMaps[normalizedKey]) return dictionaryMaps[normalizedKey]
  return null
}

function renderDictionaryValues(
  values: unknown,
  dictionaryMap: DictionaryMap | null,
  multi: boolean,
): React.ReactNode {
  if (!dictionaryMap) return null
  if (multi || Array.isArray(values)) {
    const resolved = (Array.isArray(values) ? values : [values])
      .map((entry) => extractDictionaryValue(entry))
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    if (!resolved.length) return null
    return (
      <div className="flex flex-wrap gap-1.5">
        {resolved.map((value, index) => (
          <DictionaryValue
            key={`${value}-${index}`}
            value={value}
            map={dictionaryMap}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs"
            iconWrapperClassName="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background"
            iconClassName="h-3 w-3"
            colorClassName="h-2.5 w-2.5 rounded-full"
          />
        ))}
      </div>
    )
  }
  const resolved = extractDictionaryValue(values)
  if (!resolved) return null
  return (
    <DictionaryValue
      value={resolved}
      map={dictionaryMap}
      className="inline-flex items-center gap-2 text-sm"
    />
  )
}

function renderPrimitiveValues(value: unknown, emptyLabel: string): React.ReactNode {
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => stringifyCustomValue(entry))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    if (!parts.length) return null
    return (
      <div className="flex flex-wrap gap-1.5">
        {parts.map((entry, index) => (
          <span
            key={`${entry}-${index}`}
            className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            {entry}
          </span>
        ))}
      </div>
    )
  }
  const label = stringifyCustomValue(value).trim()
  if (!label.length) return null
  return <span className="text-sm text-foreground">{label}</span>
}

function buildDisplayEntries(
  values: Record<string, unknown> | null | undefined,
  entries: CustomFieldEntry[] | undefined,
  definitions: CustomFieldDefDto[],
  dictionaryMaps: Record<string, DictionaryMap> | undefined,
): DisplayEntry[] {
  const combined = new Map<
    string,
    {
      key: string
      value: unknown
      label?: string | null
    }
  >()

  if (values) {
    Object.entries(values).forEach(([rawKey, value]) => {
      const normalizedKey = normalizeCustomFieldKey(rawKey)
      if (!normalizedKey) return
      if (!combined.has(normalizedKey)) {
        combined.set(normalizedKey, { key: rawKey, value })
      } else {
        const existing = combined.get(normalizedKey)
        if (existing) {
          existing.value = value
        }
      }
    })
  }

  if (entries) {
    entries.forEach((entry) => {
      const normalizedKey = normalizeCustomFieldKey(entry.key)
      if (!normalizedKey) return
      const existing = combined.get(normalizedKey)
      if (existing) {
        combined.set(normalizedKey, {
          key: existing.key,
          value: entry.value,
          label: entry.label ?? existing.label,
        })
      } else {
        combined.set(normalizedKey, {
          key: entry.key,
          value: entry.value,
          label: entry.label,
        })
      }
    })
  }

  const ordered: DisplayEntry[] = []
  const consumedKeys = new Set<string>()

  definitions.forEach((def, index) => {
    const normalizedKey = normalizeCustomFieldKey(def.key)
    if (!normalizedKey) return
    const entry = combined.get(normalizedKey)
    if (!entry || isEmptyCustomValue(entry.value)) return
    const label = entry.label ?? def.label ?? formatCustomFieldLabel(entry.key)
    const dictionaryMap = ensureDictionaryMap(entry.key, normalizedKey, dictionaryMaps)
    ordered.push({
      id: `${normalizedKey}-${index}`,
      key: entry.key,
      normalizedKey,
      label,
      value: entry.value,
      dictionaryMap,
      multi: def.multi ?? Array.isArray(entry.value),
    })
    consumedKeys.add(normalizedKey)
  })

  const extras: DisplayEntry[] = []
  combined.forEach((entry, normalizedKey) => {
    if (consumedKeys.has(normalizedKey)) return
    if (isEmptyCustomValue(entry.value)) return
    const label = entry.label ?? formatCustomFieldLabel(entry.key)
    const dictionaryMap = ensureDictionaryMap(entry.key, normalizedKey, dictionaryMaps)
    extras.push({
      id: normalizedKey,
      key: entry.key,
      normalizedKey,
      label,
      value: entry.value,
      dictionaryMap,
      multi: Array.isArray(entry.value),
    })
  })

  extras.sort((a, b) => a.label.localeCompare(b.label))

  return [...ordered, ...extras]
}

export function CustomFieldValuesList({
  values = null,
  entries,
  definitions,
  dictionaryMapsByKey,
  resources,
  emptyLabel,
  className,
  itemKeyPrefix,
}: CustomFieldValuesListProps) {
  const displayEntries = React.useMemo(() => {
    const defs = definitions ?? resources?.definitions ?? []
    const maps = dictionaryMapsByKey ?? resources?.dictionaryMapsByKey ?? {}
    return buildDisplayEntries(values, entries, defs, maps)
  }, [definitions, dictionaryMapsByKey, entries, resources, values])

  if (!displayEntries.length) return null

  const resolvedEmptyLabel = defaultEmptyLabel(emptyLabel)
  const prefix = itemKeyPrefix ?? 'custom-field'

  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
      {displayEntries.map((entry, index) => {
        const dictionaryContent = renderDictionaryValues(entry.value, entry.dictionaryMap, resolvedEmptyLabel, entry.multi)
        const primitiveContent = dictionaryContent ?? renderPrimitiveValues(entry.value, resolvedEmptyLabel)
        const content =
          dictionaryContent ??
          primitiveContent ??
          <span className="text-sm text-muted-foreground">{resolvedEmptyLabel}</span>
        return (
          <div
            key={`${prefix}-${entry.normalizedKey}-${index}`}
            className="rounded-md border border-border/60 bg-muted/10 px-3 py-2"
          >
            <div className="text-xs font-medium text-muted-foreground">{entry.label}</div>
            <div className="mt-1 text-sm text-foreground">{content}</div>
          </div>
        )
      })}
    </div>
  )
}

export default CustomFieldValuesList
