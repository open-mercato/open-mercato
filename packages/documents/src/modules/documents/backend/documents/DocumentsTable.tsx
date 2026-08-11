"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Star } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENTS_ENTITY_IDS } from '../../lib/constants'
import { formatDateTime } from './documentUi'
import type { DocumentRow } from './documentsListTypes'

export type DocumentsArchivedFilter = 'exclude' | 'include' | 'only'

type DocumentsTableProps = {
  title: string
  rows: DocumentRow[]
  isLoading: boolean
  isCreating: boolean
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
  archivedFilter: DocumentsArchivedFilter
  favoritesOnly: boolean
  onArchivedFilterChange: (value: DocumentsArchivedFilter) => void
  onFavoritesOnlyChange: (value: boolean) => void
  onToggleFavorite: (row: DocumentRow) => void
  onDuplicate: (row: DocumentRow) => void
  onArchiveToggle: (row: DocumentRow) => void
}

export function DocumentsTable(props: DocumentsTableProps) {
  const t = useT()
  const router = useRouter()
  const columns = React.useMemo<ColumnDef<DocumentRow>[]>(() => [
    {
      id: 'favorite', header: '', meta: { alwaysVisible: true, maxWidth: '48px' },
      cell: ({ row }) => (
        <IconButton
          type="button"
          variant="ghost"
          aria-pressed={row.original.isFavorite}
          aria-label={t(row.original.isFavorite ? 'documents.actions.unfavorite' : 'documents.actions.favorite')}
          onClick={(event) => {
            event.stopPropagation()
            props.onToggleFavorite(row.original)
          }}
        >
          <Star className={row.original.isFavorite ? 'fill-current text-status-warning-icon' : 'text-muted-foreground'} />
        </IconButton>
      ),
    },
    {
      accessorKey: 'title', header: t('documents.columns.title'), meta: { alwaysVisible: true, maxWidth: '260px', truncate: true },
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <Link href={`/backend/documents/${row.original.id}`} className="font-medium hover:underline">{row.original.title}</Link>
          {row.original.archivedAt ? <Badge variant="outline">{t('documents.list.archivedBadge')}</Badge> : null}
        </span>
      ),
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
  ], [t, props.onToggleFavorite])
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant={props.favoritesOnly ? 'secondary' : 'outline'}
        aria-pressed={props.favoritesOnly}
        onClick={() => props.onFavoritesOnlyChange(!props.favoritesOnly)}
      >
        <Star />{t('documents.list.filters.favorites')}
      </Button>
      <Select value={props.archivedFilter} onValueChange={(value) => props.onArchivedFilterChange(value as DocumentsArchivedFilter)}>
        <SelectTrigger className="w-36" aria-label={t('documents.list.filters.archived.label')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="exclude">{t('documents.list.filters.archived.active')}</SelectItem>
          <SelectItem value="include">{t('documents.list.filters.archived.all')}</SelectItem>
          <SelectItem value="only">{t('documents.list.filters.archived.archivedOnly')}</SelectItem>
        </SelectContent>
      </Select>
      {props.canManageTemplates ? <LinkButton asChild variant="gray"><Link href="/backend/documents/templates">{t('documents.templates.actions.manage')}</Link></LinkButton> : null}
      {props.hasTemplates && props.canInstantiateTemplate ? <Button type="button" variant="outline" onClick={props.onNewFromTemplate}>{t('documents.templates.instantiate.title')}</Button> : null}
      {props.canCreateDocument ? <Button type="button" onClick={props.onCreate} disabled={props.isCreating}>{t('documents.actions.create')}</Button> : null}
    </div>
  )
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
        if (row.capabilities.canDuplicate) items.push({ id: 'duplicate', label: t('documents.actions.duplicate'), onSelect: () => props.onDuplicate(row) })
        if (row.capabilities.canArchive) {
          items.push({
            id: row.archivedAt ? 'unarchive' : 'archive',
            label: t(row.archivedAt ? 'documents.actions.unarchive' : 'documents.actions.archive'),
            onSelect: () => props.onArchiveToggle(row),
          })
        }
        if (row.capabilities.canDelete) items.push({ id: 'delete', label: t('documents.actions.delete'), destructive: true, onSelect: () => props.onDelete(row) })
        return <RowActions items={items} />
      }}
    />
  )
}
