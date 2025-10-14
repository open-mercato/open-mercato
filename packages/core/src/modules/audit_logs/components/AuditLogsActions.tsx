'use client'

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

export type ActionLogItem = {
  id: string
  commandId: string
  actionLabel: string | null
  executionState: string
  actorUserId: string | null
  tenantId: string | null
  organizationId: string | null
  resourceKind: string | null
  resourceId: string | null
  undoToken: string | null
  createdAt: string
}

export function AuditLogsActions({ items, onRefresh, headerExtras }: { items: ActionLogItem[] | undefined; onRefresh: () => Promise<void>; headerExtras?: React.ReactNode }) {
  const [undoing, setUndoing] = React.useState(false)
  const actionItems = Array.isArray(items) ? items : []
  const latestUndoable = React.useMemo(() => actionItems.find((item) => !!item.undoToken), [actionItems])

  const handleUndo = async () => {
    if (!latestUndoable?.undoToken) return
    setUndoing(true)
    try {
      await apiFetch('/api/audit_logs/audit-logs/actions/undo', {
        method: 'POST',
        body: { undoToken: latestUndoable.undoToken },
      })
      await onRefresh()
    } catch (err) {
      console.error('Undo failed', err)
    } finally {
      setUndoing(false)
    }
  }

  const columns = React.useMemo<ColumnDef<ActionLogItem, any>[]>(() => [
    {
      accessorKey: 'actionLabel',
      header: 'Action',
      cell: (info) => info.row.original.actionLabel || info.row.original.commandId,
    },
    {
      accessorKey: 'resourceKind',
      header: 'Resource',
      cell: (info) => formatResource(info.row.original),
    },
    {
      accessorKey: 'actorUserId',
      header: 'User',
      cell: (info) => info.getValue() || '—',
      meta: { priority: 3 },
    },
    {
      accessorKey: 'tenantId',
      header: 'Tenant',
      cell: (info) => info.getValue() || '—',
      meta: { priority: 4 },
    },
    {
      accessorKey: 'organizationId',
      header: 'Organization',
      cell: (info) => info.getValue() || '—',
      meta: { priority: 4 },
    },
    {
      accessorKey: 'createdAt',
      header: 'When',
      cell: (info) => formatDate(info.getValue() as string),
    },
    {
      accessorKey: 'executionState',
      header: 'Status',
    },
  ], [])

  const undoButton = latestUndoable?.undoToken ? (
    <Button variant="secondary" size="sm" onClick={handleUndo} disabled={undoing}>
      {undoing ? 'Undoing…' : 'Undo last action'}
    </Button>
  ) : null

  const headerActions = headerExtras || undoButton ? (
    <div className="flex items-center gap-2">
      {headerExtras}
      {undoButton}
    </div>
  ) : undefined

  return (
    <DataTable<ActionLogItem>
      title="Action Log"
      data={actionItems}
      columns={columns}
      actions={headerActions}
      isLoading={undoing}
    />
  )
}

function formatResource(item: { resourceKind?: string | null; resourceId?: string | null }) {
  if (!item.resourceKind && !item.resourceId) return '—'
  return [item.resourceKind, item.resourceId].filter(Boolean).join(' · ')
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
