import type { ColumnDef } from '@tanstack/react-table'
import type { FilterFieldType, FilterOption } from '@open-mercato/shared/lib/query/advanced-filter'
import type { CustomFieldDefDto, CustomFieldVisibility } from './customFieldDefs'
import { isDefVisible } from './customFieldDefs'

type RawCustomFieldOption = string | number | { value?: unknown; label?: unknown }

export function supportsCustomFieldColumn(def: CustomFieldDefDto): boolean {
  return def.kind !== 'attachment'
}

export function mapCustomFieldKindToFilterType(kind: string): FilterFieldType {
  switch (kind) {
    case 'boolean':
      return 'boolean'
    case 'integer':
    case 'float':
      return 'number'
    case 'date':
    case 'datetime':
      return 'date'
    case 'select':
    case 'dictionary':
    case 'currency':
    case 'relation':
      return 'select'
    default:
      return 'text'
  }
}

export function normalizeCustomFieldFilterOptions(options?: RawCustomFieldOption[]): FilterOption[] {
  if (!Array.isArray(options)) return []
  return options.map((option) => {
    if (option && typeof option === 'object' && 'value' in option) {
      const rawValue = option.value
      const rawLabel = option.label ?? rawValue
      return {
        value: String(rawValue),
        label: typeof rawLabel === 'string' ? rawLabel : String(rawLabel),
      }
    }
    const value = String(option)
    return {
      value,
      label: value.charAt(0).toUpperCase() + value.slice(1),
    }
  })
}

// Filters and annotates columns with custom-field definitions:
// - Drops cf_* columns when no definition exists or listVisible === false
// - Uses definition label as header when header is missing
export function applyCustomFieldVisibility<T>(columns: ColumnDef<T, any>[], defs: CustomFieldDefDto[], mode: CustomFieldVisibility = 'list'): ColumnDef<T, any>[] {
  const byKey = new Map(defs.map((d) => [d.key, d]))
  // First, filter and annotate headers
  const filtered = columns.filter((c) => {
    const key = String((c as any).accessorKey || '')
    if (!key.startsWith('cf_')) return true
    const cfKey = key.slice(3)
    const def = byKey.get(cfKey)
    if (!def) return false
    if (!supportsCustomFieldColumn(def)) return false
    if (!isDefVisible(def, mode)) return false
    const currentHeader = (c as any).header
    const fallbackHeader = typeof currentHeader === 'string' && currentHeader.trim().length ? currentHeader : key
    const label = def.label && def.label.trim().length ? def.label : fallbackHeader
    if (currentHeader == null || typeof currentHeader === 'string') {
      (c as any).header = label
    }
    const existingMeta = ((c as any).meta || {}) as Record<string, unknown>
    const nextMeta = Object.assign({}, existingMeta, { label })
    ;(c as any).meta = nextMeta
    return true
  })

  // Then, reorder only the cf_* columns by definition priority while preserving
  // the positions of non-cf columns and the count of cf slots.
  const cfEntries: Array<{ col: ColumnDef<T, any>; key: string; prio: number }> = []
  filtered.forEach((c) => {
    const key = String((c as any).accessorKey || '')
    if (key.startsWith('cf_')) {
      const cfKey = key.slice(3)
      const def = byKey.get(cfKey)
      cfEntries.push({ col: c, key: cfKey, prio: def?.priority ?? 0 })
    }
  })
  cfEntries.sort((a, b) => a.prio - b.prio)
  let cfIdx = 0
  const result = filtered.map((c) => {
    const key = String((c as any).accessorKey || '')
    if (!key.startsWith('cf_')) return c
    const next = cfEntries[cfIdx++]?.col ?? c
    return next
  })

  // Append any missing cf columns (defs visible but not present in incoming columns)
  const existingCfKeys = new Set<string>(result
    .map((c) => String((c as any).accessorKey || ''))
    .filter((k) => k.startsWith('cf_'))
    .map((k) => k.slice(3)))

  const visibleSorted = defs
    .filter((d) => supportsCustomFieldColumn(d) && isDefVisible(d, mode))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))

  const missing = visibleSorted.filter((d) => !existingCfKeys.has(d.key))
  for (const d of missing) {
    const col: ColumnDef<T, any> = {
      accessorKey: `cf_${d.key}` as any,
      header: d.label || `cf_${d.key}`,
      // Respect responsive priority when provided; default leaves it visible
      meta: { priority: (d as any).priority, label: d.label || `cf_${d.key}` } as any,
    }
    result.push(col)
  }
  return result
}
