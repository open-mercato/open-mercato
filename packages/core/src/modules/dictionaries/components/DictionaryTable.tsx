import * as React from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { renderDictionaryColor, renderDictionaryIcon } from './dictionaryAppearance'

export type DictionaryTableEntry = {
  id: string
  value: string
  label: string
  color: string | null
  icon: string | null
  organizationId?: string | null
  tenantId?: string | null
  isInherited?: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

export type DictionaryTableTranslations = {
  title: string
  valueColumn: string
  labelColumn: string
  appearanceColumn: string
  addLabel: string
  editLabel: string
  deleteLabel: string
  refreshLabel: string
  inheritedLabel: string
  inheritedTooltip: string
  emptyLabel: string
  searchPlaceholder?: string
}

type DictionaryTableProps = {
  entries: DictionaryTableEntry[]
  loading?: boolean
  canManage?: boolean
  onCreate?: () => void
  onEdit?: (entry: DictionaryTableEntry) => void
  onDelete?: (entry: DictionaryTableEntry) => void
  onRefresh?: () => void
  translations: DictionaryTableTranslations
}

export function DictionaryTable({
  entries,
  loading = false,
  canManage = false,
  onCreate,
  onEdit,
  onDelete,
  onRefresh,
  translations,
}: DictionaryTableProps) {
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'value', desc: false }])
  const [page, setPage] = React.useState(1)
  const pageSize = 50

  const filtered = React.useMemo(() => {
    if (!search.trim()) return entries
    const term = search.trim().toLowerCase()
    return entries.filter((entry) => {
      return (
        entry.value.toLowerCase().includes(term) ||
        (entry.label ?? '').toLowerCase().includes(term)
      )
    })
  }, [entries, search])

  const paginated = React.useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))

  const columns = React.useMemo<ColumnDef<DictionaryTableEntry>[]>(() => [
    {
      accessorKey: 'value',
      header: translations.valueColumn,
      meta: { priority: 1 },
      cell: ({ getValue, row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{String(getValue())}</span>
          {row.original.isInherited ? (
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground" title={translations.inheritedTooltip}>
              {translations.inheritedLabel}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'label',
      header: translations.labelColumn,
      meta: { priority: 2 },
      cell: ({ getValue }) => <span>{String(getValue() ?? '')}</span>,
    },
    {
      id: 'appearance',
      header: translations.appearanceColumn,
      meta: { priority: 3 },
      cell: ({ row }) => {
        const { color, icon } = row.original
        if (!color && !icon) return <span className="text-muted-foreground">—</span>
        return (
          <div className="flex items-center gap-2">
            {color ? renderDictionaryColor(color, 'h-4 w-4 rounded-full border border-border') : null}
            {icon ? renderDictionaryIcon(icon, 'h-4 w-4') : null}
          </div>
        )
      },
    },
  ], [translations.appearanceColumn, translations.inheritedLabel, translations.inheritedTooltip, translations.labelColumn, translations.valueColumn])

  const actions = React.useMemo(() => {
    if (!canManage || !onCreate) return null
    return (
      <Button size="sm" onClick={onCreate}>
        {translations.addLabel}
      </Button>
    )
  }, [canManage, onCreate, translations.addLabel])

  const handleRowClick = canManage && onEdit
    ? (entry: DictionaryTableEntry) => {
        if (entry.isInherited) return
        onEdit(entry)
      }
    : undefined

  return (
    <DataTable<DictionaryTableEntry>
      title={translations.title}
      actions={actions}
      columns={columns}
      data={paginated}
      embedded
      sortable
      sorting={sorting}
      onSortingChange={setSorting}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={translations.searchPlaceholder}
      isLoading={loading}
      emptyState={<p className="py-10 text-center text-sm text-muted-foreground">{translations.emptyLabel}</p>}
      pagination={{
        page,
        pageSize,
        total: filtered.length,
        totalPages,
        onPageChange: setPage,
      }}
      refreshButton={onRefresh ? {
        label: translations.refreshLabel,
        onRefresh,
        isRefreshing: loading,
      } : undefined}
      onRowClick={handleRowClick}
      rowActions={
        canManage
          ? (entry) => {
              if (!entry) return null
              if (entry.isInherited) return null
              const items: RowActionItem[] = []
              if (onEdit) {
                items.push({
                  label: translations.editLabel,
                  onSelect: () => onEdit(entry),
                })
              }
              if (onDelete) {
                items.push({
                  label: translations.deleteLabel,
                  onSelect: () => onDelete(entry),
                  destructive: true,
                })
              }
              return items.length ? <RowActions items={items} /> : null
            }
          : undefined
      }
    />
  )
}
