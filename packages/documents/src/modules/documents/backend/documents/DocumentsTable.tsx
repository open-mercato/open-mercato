"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable, RowActions } from '@open-mercato/ui'
import type { RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENTS_ENTITY_IDS } from '../../lib/constants'
import { formatDateTime } from './documentUi'
import type { DocumentRow } from './documentsListTypes'

type DocumentsTableProps = {
  title: string
  rows: DocumentRow[]
  isLoading: boolean
  search: string
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasTemplates: boolean
  canCreateDocument: boolean
  canInstantiateTemplate: boolean
  canManageTemplates: boolean
  onSearchChange: (search: string) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onRefresh: () => void
  onCreate: () => void
  onNewFromTemplate: () => void
  onShare: (row: DocumentRow) => void
  onMove: (row: DocumentRow) => void
  onDelete: (row: DocumentRow) => void
}

export function DocumentsTable(props: DocumentsTableProps) {
  const t = useT()
  const router = useRouter()
  const columns = React.useMemo<ColumnDef<DocumentRow>[]>(() => [
    {
      accessorKey: 'title', header: t('documents.columns.title'), meta: { alwaysVisible: true, maxWidth: '260px', truncate: true },
      cell: ({ row }) => <Link href={`/backend/documents/${row.original.id}`} className="font-medium hover:underline">{row.original.title}</Link>,
    },
    {
      accessorKey: 'folderName', header: t('documents.columns.folder'), meta: { maxWidth: '180px', truncate: true },
      cell: ({ row }) => row.original.folderName ?? <span className="text-sm text-muted-foreground">{t('documents.folders.none')}</span>,
    },
    { accessorKey: 'ownerLabel', header: t('documents.columns.owner'), meta: { maxWidth: '220px', truncate: true } },
    { accessorKey: 'sharedWithCount', header: t('documents.columns.sharedWith') },
    {
      accessorKey: 'updatedAt', header: t('documents.columns.updatedAt'), meta: { maxWidth: '180px' },
      cell: ({ row }) => <span className="text-sm">{formatDateTime(row.original.updatedAt, t('documents.list.noValue'))}</span>,
    },
  ], [t])
  const actions = props.canManageTemplates || (props.hasTemplates && props.canInstantiateTemplate) || props.canCreateDocument
    ? <div className="flex flex-wrap items-center gap-2">
        {props.canManageTemplates ? <Button asChild variant="outline"><Link href="/backend/documents/templates">{t('documents.templates.actions.manage')}</Link></Button> : null}
        {props.hasTemplates && props.canInstantiateTemplate ? <Button type="button" variant="outline" onClick={props.onNewFromTemplate}>{t('documents.templates.instantiate.title')}</Button> : null}
        {props.canCreateDocument ? <Button type="button" onClick={props.onCreate}>{t('documents.actions.create')}</Button> : null}
      </div>
    : undefined
  return (
    <DataTable<DocumentRow>
      title={props.title}
      actions={actions}
      refreshButton={{ label: t('documents.actions.refresh'), onRefresh: props.onRefresh, isRefreshing: props.isLoading }}
      columns={columns}
      data={props.rows}
      isLoading={props.isLoading}
      searchValue={props.search}
      onSearchChange={props.onSearchChange}
      searchPlaceholder={t('documents.list.searchPlaceholder')}
      emptyState={t('documents.list.empty')}
      entityId={DOCUMENTS_ENTITY_IDS.document}
      extensionTableId="documents.documents.list"
      onRowClick={(row) => router.push(`/backend/documents/${row.id}`)}
      rowClickActionIds={['open']}
      stickyActionsColumn
      pagination={{
        page: props.page, pageSize: props.pageSize, total: props.total, totalPages: props.totalPages,
        onPageChange: props.onPageChange, onPageSizeChange: props.onPageSizeChange,
      }}
      rowActions={(row) => {
        const items: RowActionItem[] = [{ id: 'open', label: t('documents.actions.open'), onSelect: () => router.push(`/backend/documents/${row.id}`) }]
        if (row.capabilities.canShare) items.push({ id: 'share', label: t('documents.actions.share'), onSelect: () => props.onShare(row) })
        if (row.capabilities.canEdit) items.push({ id: 'move', label: t('documents.folders.actions.moveDocument'), onSelect: () => props.onMove(row) })
        if (row.capabilities.canDelete) items.push({ id: 'delete', label: t('documents.actions.delete'), destructive: true, onSelect: () => props.onDelete(row) })
        return <RowActions items={items} />
      }}
    />
  )
}
