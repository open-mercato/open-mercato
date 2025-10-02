import type { ColumnDef } from '@tanstack/react-table'
import type { CustomFieldDefDto, CustomFieldVisibility } from './customFieldDefs'
import { isDefVisible } from './customFieldDefs'

// Filters and annotates columns with custom-field definitions:
// - Drops cf_* columns when no definition exists or listVisible === false
// - Uses definition label as header when header is missing
export function applyCustomFieldVisibility<T>(columns: ColumnDef<T, any>[], defs: CustomFieldDefDto[], mode: CustomFieldVisibility = 'list'): ColumnDef<T, any>[] {
  const byKey = new Map(defs.map((d) => [d.key, d]))
  return columns.filter((c) => {
    const key = String((c as any).accessorKey || '')
    if (!key.startsWith('cf_')) return true
    const cfKey = key.slice(3)
    const def = byKey.get(cfKey)
    if (!def) return false
    if (!isDefVisible(def, mode)) return false
    if (!(c as any).header) (c as any).header = def.label || key
    return true
  })
}
