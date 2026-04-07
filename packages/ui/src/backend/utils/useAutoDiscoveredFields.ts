"use client"
import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import type { FilterFieldDef as AdvancedFilterFieldDef, FilterFieldType, FilterOption } from '@open-mercato/shared/lib/query/advanced-filter'
import type { ColumnChooserField } from '../columns/ColumnChooserPanel'
import type { CustomFieldDefDto } from './customFieldDefs'
import {
  mapCustomFieldKindToFilterType,
  normalizeCustomFieldFilterOptions,
  supportsCustomFieldColumn,
} from './customFieldColumns'

type ColumnMeta = {
  filterKey?: string
  filterType?: FilterFieldType
  filterOptions?: FilterOption[]
  filterLoadOptions?: (query?: string) => Promise<FilterOption[]>
  filterable?: boolean
  filterGroup?: string
  columnChooserGroup?: string
  alwaysVisible?: boolean
  hidden?: boolean
  truncate?: boolean
  maxWidth?: string
  priority?: number
  tooltipContent?: (row: unknown) => string | undefined
}

function resolveHeaderLabel(column: ColumnDef<any, any>): string {
  const header = (column as any).header
  if (typeof header === 'string') return header
  const accessorKey = (column as any).accessorKey as string | undefined
  if (!accessorKey) return ''
  return accessorKey
    .replace(/^cf_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c: string) => c.toUpperCase())
}

function inferFilterType(accessorKey: string, meta?: ColumnMeta): FilterFieldType {
  if (meta?.filterType) return meta.filterType
  if (accessorKey.endsWith('_at') || accessorKey === 'createdAt' || accessorKey === 'updatedAt' || accessorKey === 'expectedCloseAt' || accessorKey.endsWith('At')) return 'date'
  if (accessorKey === 'probability' || accessorKey === 'valueAmount' || accessorKey === 'value_amount') return 'number'
  if (meta?.filterOptions) return 'select'
  return 'text'
}

export type UseAutoDiscoveredFieldsInput = {
  columns: ColumnDef<any, any>[]
  customFieldDefs: CustomFieldDefDto[]
}

export type UseAutoDiscoveredFieldsResult = {
  advancedFilterFields: AdvancedFilterFieldDef[]
  columnChooserFields: ColumnChooserField[]
}

export function useAutoDiscoveredFields({
  columns,
  customFieldDefs,
}: UseAutoDiscoveredFieldsInput): UseAutoDiscoveredFieldsResult {
  return React.useMemo(() => {
    const filterFields: AdvancedFilterFieldDef[] = []
    const chooserFields: ColumnChooserField[] = []
    const seenFilterKeys = new Set<string>()
    const seenChooserKeys = new Set<string>()

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      const accessorKey = (col as any).accessorKey as string | undefined
      if (!accessorKey) continue

      const meta = (col as any).meta as ColumnMeta | undefined
      const label = resolveHeaderLabel(col)
      if (!label) continue
      const filterKey = meta?.filterKey ?? accessorKey

      // Advanced filter field
      if (meta?.filterable !== false && filterKey && !seenFilterKeys.has(filterKey)) {
        seenFilterKeys.add(filterKey)
        const type = inferFilterType(filterKey, meta)
        const field: AdvancedFilterFieldDef = {
          key: filterKey,
          label,
          type,
          group: meta?.filterGroup ?? meta?.columnChooserGroup,
        }
        if (meta?.filterOptions) field.options = meta.filterOptions
        if (meta?.filterLoadOptions) field.loadOptions = meta.filterLoadOptions
        filterFields.push(field)
      }

      // Column chooser field
      if (!seenChooserKeys.has(accessorKey)) {
        seenChooserKeys.add(accessorKey)
        chooserFields.push({
          key: accessorKey,
          label,
          group: meta?.columnChooserGroup ?? 'Columns',
          alwaysVisible: meta?.alwaysVisible ?? i === 0,
          defaultVisible: true,
        })
      }
    }

    // Append ALL custom field definitions (not just filterable/listVisible)
    // so that every entity field appears in both the column chooser and advanced filter
    for (const def of customFieldDefs) {
      if (!supportsCustomFieldColumn(def)) continue
      const filterKey = `cf_${def.key}`
      if (!seenFilterKeys.has(filterKey)) {
        seenFilterKeys.add(filterKey)
        const type = mapCustomFieldKindToFilterType(def.kind)
        const field: AdvancedFilterFieldDef = {
          key: filterKey,
          label: def.label || def.key,
          type,
          group: 'Custom Fields',
        }
        if (type === 'select' && Array.isArray(def.options) && def.options.length) {
          field.options = normalizeCustomFieldFilterOptions(def.options)
        }
        filterFields.push(field)
      }
      if (!seenChooserKeys.has(filterKey)) {
        seenChooserKeys.add(filterKey)
        chooserFields.push({
          key: filterKey,
          label: def.label || def.key,
          group: def.group?.title ?? 'Custom Fields',
          defaultVisible: false,
        })
      }
    }

    return { advancedFilterFields: filterFields, columnChooserFields: chooserFields }
  }, [columns, customFieldDefs])
}
