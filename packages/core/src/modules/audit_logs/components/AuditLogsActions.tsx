'use client'

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ActionLogDetailsDialog } from './ActionLogDetailsDialog'
import { Undo2, RotateCcw } from 'lucide-react'
import { markRedoConsumed, markUndoSuccess } from '@open-mercato/ui/backend/operations/store'
import { useAuditPermissions, canUndoEntry, canRedoEntry } from '@open-mercato/ui/backend/version-history'
import { Notice } from '@open-mercato/ui/primitives/Notice'

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
  updatedAt: string
  snapshotBefore?: unknown | null
  snapshotAfter?: unknown | null
  changes?: Record<string, unknown> | null
  context?: Record<string, unknown> | null
}

export function AuditLogsActions({
  items,
  onRefresh,
  isLoading,
  headerExtras,
  onUndoError,
  onRedoError,
}: {
  items: ActionLogItem[] | undefined
  onRefresh: () => Promise<void>
  isLoading?: boolean
  headerExtras?: React.ReactNode
  onUndoError?: () => void
  onRedoError?: () => void
}) {
  const t = useT()
  const permissions = useAuditPermissions(true)
  const [undoingToken, setUndoingToken] = React.useState<string | null>(null)
  const [redoingId, setRedoingId] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<ActionLogItem | null>(null)
  const actionItems = Array.isArray(items) ? items : []
  const latestUndoable = React.useMemo(() => actionItems.find((item) => !!item.undoToken && item.executionState === 'done'), [actionItems])
  const noneLabel = t('audit_logs.common.none')
  const latestPerResource = React.useMemo(() => {
    const map = new Map<string, string>()
    let fallback: string | null = null
    for (const item of actionItems) {
      if (!item.undoToken || item.executionState !== 'done') continue
      const key = buildResourceKey(item)
      if (key) {
        if (!map.has(key)) map.set(key, item.id)
      } else if (!fallback) {
        fallback = item.id
      }
    }
    return { map, fallback }
  }, [actionItems])
  const latestUndoneId = React.useMemo(() => {
    const undone = actionItems.filter((item) => item.executionState === 'undone')
    if (!undone.length) return null
    const sorted = [...undone].sort((a, b) => {
      const aTs = Date.parse(a.updatedAt)
      const bTs = Date.parse(b.updatedAt)
      return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0)
    })
    return sorted[0]?.id ?? null
  }, [actionItems])

  const isLatestUndoableForItem = React.useCallback((item: ActionLogItem) => {
    const key = buildResourceKey(item)
    if (key) return latestPerResource.map.get(key) === item.id
    return latestPerResource.fallback === item.id
  }, [latestPerResource])

  const isRedoCandidate = React.useCallback((item: ActionLogItem) => item.executionState === 'undone' && latestUndoneId === item.id, [latestUndoneId])

  const handleUndo = React.useCallback(async (token: string | null) => {
    if (!token) return
    setUndoingToken(token)
    try {
      await apiCallOrThrow('/api/audit_logs/audit-logs/actions/undo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ undoToken: token }),
      }, { errorMessage: t('audit_logs.error.undo') })
      markUndoSuccess(token)
      await onRefresh()
    } catch (err) {
      console.error(t('audit_logs.actions.undo'), err)
      onUndoError?.()
    } finally {
      setUndoingToken(null)
    }
  }, [onRefresh, onUndoError, t])

  const handleRedo = React.useCallback(async (logId: string | null) => {
    if (!logId) return
    setRedoingId(logId)
    try {
      await apiCallOrThrow('/api/audit_logs/audit-logs/actions/redo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ logId }),
      }, { errorMessage: t('audit_logs.error.redo') })
      markRedoConsumed(logId)
      await onRefresh()
    } catch (err) {
      console.error(t('audit_logs.actions.redo'), err)
      onRedoError?.()
    } finally {
      setRedoingId(null)
    }
  }, [onRefresh, onRedoError, t])

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
    {
      id: 'controls',
      header: t('audit_logs.actions.columns.controls'),
      enableSorting: false,
      cell: (info) => {
        const item = info.row.original
        const itemCanUndo = canUndoEntry(permissions, item.actorUserId)
        const itemCanRedo = canRedoEntry(permissions, item.actorUserId)
        const canUndo = itemCanUndo && Boolean(item.undoToken) && item.executionState === 'done' && isLatestUndoableForItem(item)
        const showRedo = itemCanRedo && item.executionState === 'undone'
        const canRedo = showRedo && isRedoCandidate(item)
        if (!canUndo && !showRedo) return null
        return (
          <div className="flex justify-end gap-1">
            {canUndo ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('audit_logs.actions.undo')}
                onClick={() => { void handleUndo(item.undoToken) }}
                disabled={undoingToken === item.undoToken || Boolean(redoingId)}
              >
                <Undo2 className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
            {showRedo ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('audit_logs.actions.redo')}
                onClick={() => { void handleRedo(item.id) }}
                disabled={!canRedo || redoingId === item.id || Boolean(undoingToken)}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        )
      },
      meta: { align: 'right' },
    },
  ], [t, noneLabel, handleUndo, handleRedo, isLatestUndoableForItem, isRedoCandidate, undoingToken, redoingId, permissions])

  const undoButton = latestUndoable?.undoToken && canUndoEntry(permissions, latestUndoable.actorUserId) ? (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => { void handleUndo(latestUndoable.undoToken) }}
      disabled={Boolean(undoingToken) || Boolean(redoingId)}
    >
      {undoingToken ? t('audit_logs.actions.undoing') : t('audit_logs.actions.undo')}
    </Button>
  ) : null

  const combinedActions = undoButton || headerExtras
    ? <div className="flex items-center gap-2">{headerExtras}{undoButton}</div>
    : undefined

  const showSelfOnlyHint = !permissions.isLoading && !permissions.canViewTenant && !!permissions.currentUserId

  return (
    <>
      {showSelfOnlyHint ? (
        <Notice compact className="mb-4">
          {t('audit_logs.hint.view_self_only', 'Showing only your own changes. Contact an administrator for broader access.')}
        </Notice>
      ) : null}
      <DataTable<ActionLogItem>
        title={t('audit_logs.actions.title')}
        data={actionItems}
        columns={columns}
        actions={combinedActions}
        perspective={{ tableId: 'audit_logs.actions.list' }}
        isLoading={Boolean(isLoading) || Boolean(undoingToken) || Boolean(redoingId)}
        onRowClick={(item) => setSelected(item)}
      />
      {selected ? (
        <ActionLogDetailsDialog
          item={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  )
}

function formatResource(item: { resourceKind?: string | null; resourceId?: string | null }, fallback: string) {
  if (!item.resourceKind && !item.resourceId) return fallback
  return [item.resourceKind, item.resourceId].filter(Boolean).join(' · ')
}

function buildResourceKey(item: { resourceKind?: string | null; resourceId?: string | null }) {
  const kind = typeof item.resourceKind === 'string' ? item.resourceKind.trim() : ''
  const id = typeof item.resourceId === 'string' ? item.resourceId.trim() : ''
  if (!kind && !id) return null
  return `${kind}::${id}`
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
