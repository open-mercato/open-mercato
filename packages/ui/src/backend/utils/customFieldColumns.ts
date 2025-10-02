import type { ColumnDef } from '@tanstack/react-table'
import type { CustomFieldDefDto, CustomFieldVisibility } from './customFieldDefs'
import { isDefVisible } from './customFieldDefs'

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
    if (!isDefVisible(def, mode)) return false
    if (!(c as any).header) (c as any).header = def.label || key
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
  return result
}
