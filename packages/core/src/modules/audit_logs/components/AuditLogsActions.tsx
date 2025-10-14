'use client'

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type ActionLogItem = {
  id: string
  commandId: string
  actionLabel: string | null
  executionState: string
  actorUserId: string | null
  actorUserName: string | null
  tenantId: string | null
  tenantName: string | null
  organizationId: string | null
  organizationName: string | null
  resourceKind: string | null
  resourceId: string | null
  undoToken: string | null
  createdAt: string
}

export function AuditLogsActions({
  items,
  onRefresh,
  isLoading,
  headerExtras,
  onUndoError,
}: {
  items: ActionLogItem[] | undefined
  onRefresh: () => Promise<void>
  isLoading?: boolean
  headerExtras?: React.ReactNode
  onUndoError?: () => void
}) {
  const t = useT()
  const [undoing, setUndoing] = React.useState(false)
  const actionItems = Array.isArray(items) ? items : []
  const latestUndoable = React.useMemo(() => actionItems.find((item) => !!item.undoToken), [actionItems])
  const noneLabel = t('audit_logs.common.none')

  const handleUndo = async () => {
    if (!latestUndoable?.undoToken) return
    setUndoing(true)
    try {
      await apiFetch('/api/audit_logs/audit-logs/actions/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undoToken: latestUndoable.undoToken }),
      })
      await onRefresh()
    } catch (err) {
      console.error('Undo failed', err)
      onUndoError?.()
    } finally {
      setUndoing(false)
    }
  }

  const columns = React.useMemo<ColumnDef<ActionLogItem, any>[]>(() => [
    {
      accessorKey: 'actionLabel',
      header: t('audit_logs.actions.columns.action'),
      cell: (info) => info.row.original.actionLabel || info.row.original.commandId,
    },
    {
      accessorKey: 'resourceKind',
      header: t('audit_logs.actions.columns.resource'),
      cell: (info) => formatResource(info.row.original, noneLabel),
    },
    {
      accessorKey: 'actorUserId',
      header: t('audit_logs.actions.columns.user'),
      cell: (info) => info.row.original.actorUserName || info.getValue() || noneLabel,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'tenantId',
      header: t('audit_logs.actions.columns.tenant'),
      cell: (info) => info.row.original.tenantName || info.getValue() || noneLabel,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'organizationId',
      header: t('audit_logs.actions.columns.organization'),
      cell: (info) => info.row.original.organizationName || info.getValue() || noneLabel,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'createdAt',
      header: t('audit_logs.actions.columns.when'),
      cell: (info) => formatDate(info.getValue() as string),
    },
    {
      accessorKey: 'executionState',
      header: t('audit_logs.actions.columns.status'),
    },
  ], [t, noneLabel])

  const undoButton = latestUndoable?.undoToken ? (
    <Button variant="secondary" size="sm" onClick={handleUndo} disabled={undoing}>
      {undoing ? t('audit_logs.actions.undoing') : t('audit_logs.actions.undo')}
    </Button>
  ) : null

  const combinedActions = undoButton || headerExtras
    ? <div className="flex items-center gap-2">{headerExtras}{undoButton}</div>
    : undefined

  return (
    <DataTable<ActionLogItem>
      title={t('audit_logs.actions.title')}
      data={actionItems}
      columns={columns}
      actions={combinedActions}
      isLoading={Boolean(isLoading) || undoing}
    />
  )
}

function formatResource(item: { resourceKind?: string | null; resourceId?: string | null }, fallback: string) {
  if (!item.resourceKind && !item.resourceId) return fallback
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
