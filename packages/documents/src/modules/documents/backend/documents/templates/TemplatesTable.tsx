"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { getEntityRegistryEntry } from '../../../lib/entityRegistry'
import { formatDateTime } from '../documentUi'
import type { TemplateRow } from '../components/templateUi'

export function TemplatesTable({ rows, page, pageSize, total, totalPages, totalIsCapped, search, isLoading, canManageTemplates, onSearchChange, onPageChange, onPageSizeChange, onRefresh, onEdit, onDelete }: {
  rows: TemplateRow[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  totalIsCapped: boolean
  search: string
  isLoading: boolean
  canManageTemplates: boolean
  onSearchChange: (search: string) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onRefresh: () => void
  onEdit: (template: TemplateRow | null) => void
  onDelete: (template: TemplateRow) => void
}) {
  const t = useT()
  const columns = React.useMemo<ColumnDef<TemplateRow>[]>(() => [
    { accessorKey: 'name', header: t('documents.templates.columns.name'), meta: { alwaysVisible: true, maxWidth: '240px', truncate: true }, cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: 'description', header: t('documents.templates.columns.description'), meta: { maxWidth: '320px', truncate: true }, cell: ({ row }) => row.original.description ?? <span className="text-muted-foreground">{t('documents.templates.list.noDescription')}</span> },
    { id: 'slots', header: t('documents.templates.columns.slots'), meta: { maxWidth: '260px', truncate: true }, cell: ({ row }) => row.original.contextSlots.length > 0 ? row.original.contextSlots.map((slot) => t(getEntityRegistryEntry(slot.entityType)?.labelKey ?? 'documents.relatedRecords.restricted')).join(', ') : t('documents.templates.slots.none') },
    { accessorKey: 'isActive', header: t('documents.templates.columns.active'), cell: ({ row }) => <StatusBadge variant={row.original.isActive ? 'success' : 'neutral'} dot>{t(row.original.isActive ? 'documents.templates.status.active' : 'documents.templates.status.inactive')}</StatusBadge> },
    { accessorKey: 'updatedAt', header: t('documents.columns.updatedAt'), meta: { maxWidth: '180px' }, cell: ({ row }) => formatDateTime(row.original.updatedAt, t('documents.list.noValue')) },
  ], [t])
  return (
    <DataTable<TemplateRow>
      title={t('documents.templates.list.title')}
      actions={canManageTemplates ? <Button type="button" onClick={() => onEdit(null)}>{t('documents.templates.actions.new')}</Button> : undefined}
      refreshButton={{ label: t('documents.actions.refresh'), onRefresh, isRefreshing: isLoading }}
      columns={columns}
      data={rows}
      isLoading={isLoading}
      searchValue={search}
      onSearchChange={onSearchChange}
      searchPlaceholder={t('documents.templates.list.searchPlaceholder')}
      emptyState={t('documents.templates.list.empty')}
      entityId={DOCUMENTS_ENTITY_IDS.documentTemplate}
      extensionTableId="documents.templates.list"
      onRowClick={canManageTemplates ? onEdit : undefined}
      rowClickActionIds={canManageTemplates ? ['edit'] : []}
      stickyActionsColumn
      pagination={{
        page,
        pageSize,
        total,
        totalPages,
        totalIsCapped,
        onPageChange,
        onPageSizeChange,
        pageSizeOptions: [25, 50, 100],
      }}
      rowActions={canManageTemplates ? (row) => <RowActions items={[
        { id: 'edit', label: t('documents.actions.edit'), onSelect: () => onEdit(row) },
        { id: 'delete', label: t('documents.actions.delete'), destructive: true, onSelect: () => onDelete(row) },
      ]} /> : undefined}
    />
  )
}
