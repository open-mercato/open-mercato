'use client'

import * as React from 'react'
import { extensionPoints } from '@open-mercato/core/modules/audit_logs/extension-points'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable, type PaginationProps } from '@open-mercato/ui/backend/DataTable'
import type { RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { auditRecordName, auditChangeSummary, auditExecutionState } from '../lib/rowPresentation'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { ActionLogDetailsDialog } from './ActionLogDetailsDialog'
import { Undo2, RotateCcw } from 'lucide-react'
import { markRedoConsumed, markUndoSuccess } from '@open-mercato/ui/backend/operations/store'
import { useAuditPermissions, canUndoEntry, canRedoEntry } from '@open-mercato/ui/backend/version-history'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('audit_logs').child({ component: 'AuditLogsActions' })

function AuditLogRowActions({ children }: { items: RowActionItem[]; children: React.ReactNode }) {
  return <div className="flex justify-end gap-1" data-actions-cell>{children}</div>
}

/**
 * `raiseCrudError` prefers the server's `error` body over the fallback message and stamps
 * `status` on anything it builds from an HTTP response, so a numeric `status` is what
 * distinguishes a route's refusal from a client-side failure. Without that check an
 * offline or aborted request would put a raw "Failed to fetch" into the operator's
 * banner; those keep the generic fallback instead.
 */
function resolveServerReason(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined
  const status = (err as Error & { status?: unknown }).status
  if (typeof status !== 'number') return undefined
  const message = err.message?.trim()
  return message ? message : undefined
}

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
  pagination,
}: {
  items: ActionLogItem[] | undefined
  onRefresh: () => Promise<void>
  isLoading?: boolean
  headerExtras?: React.ReactNode
  /** Receives the server's reason when it sent one, so the page can show why the undo was refused. */
  onUndoError?: (reason?: string) => void
  onRedoError?: (reason?: string) => void
  pagination?: PaginationProps
}) {
  const t = useT()
  const locale = useLocale()
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
      logger.error('Undo action failed', { err })
      onUndoError?.(resolveServerReason(err))
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
      logger.error('Redo action failed', { err })
      onRedoError?.(resolveServerReason(err))
    } finally {
      setRedoingId(null)
    }
  }, [onRefresh, onRedoError, t])

  const columns = React.useMemo<ColumnDef<ActionLogItem, unknown>[]>(() => [
    {
      accessorKey: 'actionLabel',
      header: t('audit_logs.actions.columns.action'),
      cell: (info) => {
        const item = info.row.original
        const summary = auditChangeSummary(item, t)
        return (
          <div className="max-w-72">
            <div>{item.actionLabel || item.commandId}</div>
            <div className="truncate text-xs text-muted-foreground" title={summary}>{summary}</div>
          </div>
        )
      },
    },
    {
      accessorKey: 'resourceKind',
      header: t('audit_logs.actions.columns.resource'),
      cell: (info) => {
        const item = info.row.original
        const name = auditRecordName(item)
        const resource = formatResource(item, noneLabel)
        return (
          <div className="max-w-72">
            {name ? <div className="truncate font-medium" title={name}>{name}</div> : null}
            <div className={name ? 'truncate text-xs text-muted-foreground' : 'truncate'} title={resource}>{resource}</div>
          </div>
        )
      },
    },
    {
      accessorKey: 'actorUserId',
      header: t('audit_logs.actions.columns.user'),
      cell: (info) => info.row.original.actorUserName || noneLabel,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'tenantId',
      header: t('audit_logs.actions.columns.tenant'),
      cell: (info) => info.row.original.tenantName || info.row.original.tenantId || noneLabel,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'organizationId',
      header: t('audit_logs.actions.columns.organization'),
      cell: (info) => info.row.original.organizationName || info.row.original.organizationId || noneLabel,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'createdAt',
      header: t('audit_logs.actions.columns.when'),
      cell: (info) => formatDate(info.getValue() as string, locale),
    },
    {
      accessorKey: 'executionState',
      header: t('audit_logs.actions.columns.status'),
      cell: (info) => auditExecutionState(info.row.original.executionState, t),
    },
  ], [t, locale, noneLabel])

  const rowActions = React.useCallback((item: ActionLogItem) => {
    const itemCanUndo = canUndoEntry(permissions, item.actorUserId)
    const itemCanRedo = canRedoEntry(permissions, item.actorUserId)
    const canUndo = itemCanUndo && Boolean(item.undoToken) && item.executionState === 'done' && isLatestUndoableForItem(item)
    const showRedo = itemCanRedo && item.executionState === 'undone'
    const canRedo = showRedo && isRedoCandidate(item)
    if (!canUndo && !showRedo) return null
    const undoDisabled = undoingToken === item.undoToken || Boolean(redoingId)
    const redoDisabled = !canRedo || redoingId === item.id || Boolean(undoingToken)
    const undoLabel = t('audit_logs.actions.undo_this')
    const redoLabel = t('audit_logs.actions.redo_this')
    const onUndo = () => { void handleUndo(item.undoToken) }
    const onRedo = () => { void handleRedo(item.id) }
    const items: RowActionItem[] = []
    if (canUndo && !undoDisabled) items.push({ id: 'undo', label: undoLabel, onSelect: onUndo })
    if (canRedo && !redoDisabled) items.push({ id: 'redo', label: redoLabel, onSelect: onRedo })
    return (
      <AuditLogRowActions items={items}>
        {canUndo ? (
          <IconButton
            variant="ghost"
            size="lg"
            type="button"
            aria-label={undoLabel}
            title={undoLabel}
            onClick={onUndo}
            disabled={undoDisabled}
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </IconButton>
        ) : null}
        {showRedo ? (
          <IconButton
            variant="ghost"
            size="lg"
            type="button"
            aria-label={redoLabel}
            title={redoLabel}
            onClick={onRedo}
            disabled={redoDisabled}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </IconButton>
        ) : null}
      </AuditLogRowActions>
    )
  }, [t, handleUndo, handleRedo, isLatestUndoableForItem, isRedoCandidate, undoingToken, redoingId, permissions])

  const undoButton = latestUndoable?.undoToken && canUndoEntry(permissions, latestUndoable.actorUserId) ? (
    <Button
      type="button"
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
        <Alert status="information" className="mb-4">
          <AlertDescription>
            {t('audit_logs.hint.view_self_only', 'Showing only your own changes. Contact an administrator for broader access.')}
          </AlertDescription>
        </Alert>
      ) : null}
      <DataTable<ActionLogItem>
        title={t('audit_logs.actions.title')}
        titleHeadingLevel={2}
        data={actionItems}
        columns={columns}
        rowActions={rowActions}
        stickyActionsColumn
        actions={combinedActions}
        perspective={{ tableId: extensionPoints.hosts.actionsTable.tableId }}
        isLoading={Boolean(isLoading) || Boolean(undoingToken) || Boolean(redoingId)}
        onRowClick={(item) => setSelected(item)}
        pagination={pagination}
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

function formatDate(value: string, locale?: string) {
  return formatDisplayDateTime(value, locale) ?? value
}
