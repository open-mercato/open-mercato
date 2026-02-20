"use client"

import * as React from 'react'
import type { ObjectDetailProps } from '@open-mercato/shared/modules/messages/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LeaveRequestPreview } from './LeaveRequestPreview'

export function LeaveRequestDetail(props: ObjectDetailProps) {
  const t = useT()
  const [executingActionId, setExecutingActionId] = React.useState<string | null>(null)
  const [actionTakenByName, setActionTakenByName] = React.useState<string | null>(null)
  const actionTakenAtLabel = formatDateTime(props.actionTakenAt)
  const hasActionTaken = Boolean(props.actionTaken)
  const actionTakenId = extractActionId(props.actionTaken)
  const actionTakenLabel = resolveActionLabel(actionTakenId, props.actions, t)
  const actionTakenByLabel = formatUserLabel(props.actionTakenByUserId, actionTakenByName, t)

  React.useEffect(() => {
    const userId = props.actionTakenByUserId
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      setActionTakenByName(null)
      return
    }

    let cancelled = false
    const safeUserId = userId.trim()
    async function loadActionTakenByUserName() {
      const call = await apiCall<{ items?: Array<{ id?: string; name?: string | null; email?: string | null }> }>(
        `/api/auth/users?id=${encodeURIComponent(safeUserId)}`,
      )
      const entry = Array.isArray(call.result?.items) ? call.result.items[0] : null
      const resolvedName = typeof entry?.name === 'string' && entry.name.trim().length > 0
        ? entry.name.trim()
        : typeof entry?.email === 'string' && entry.email.trim().length > 0
          ? entry.email.trim()
          : null
      if (!cancelled) {
        setActionTakenByName(resolvedName)
      }
    }

    void loadActionTakenByUserName()
    return () => { cancelled = true }
  }, [props.actionTakenByUserId])

  return (
    <div className="space-y-3 rounded border p-3">
      <LeaveRequestPreview
        entityId={props.entityId}
        entityModule={props.entityModule}
        entityType={props.entityType}
        snapshot={props.snapshot}
        previewData={props.previewData}
        actionRequired={props.actionRequired}
        actionType={props.actionType}
        actionLabel={props.actionLabel}
      />

      {props.actions.length ? (
        <div className="flex flex-wrap gap-2">
          {props.actions.map((action) => (
            <Button
              key={action.id}
              type="button"
              size="sm"
              variant={action.variant ?? 'default'}
              disabled={executingActionId !== null || hasActionTaken}
              onClick={async () => {
                if (executingActionId !== null || hasActionTaken) return
                setExecutingActionId(action.id)
                try {
                  await props.onAction(action.id, { id: props.entityId })
                } finally {
                  setExecutingActionId(null)
                }
              }}
            >
              {executingActionId === action.id
                ? t('messages.actions.executing', 'Executing...')
                : t(action.labelKey ?? action.id, action.id)}
            </Button>
          ))}
        </div>
      ) : null}

      {hasActionTaken ? (
        <p className="text-xs text-muted-foreground">
          {t('messages.actions.taken', 'Action taken')}: {actionTakenLabel}
          {actionTakenAtLabel ? ` (${actionTakenAtLabel})` : ''}
          {actionTakenByLabel ? ` ${t('messages.actions.by', 'by')} ${actionTakenByLabel}` : ''}
        </p>
      ) : null}
    </div>
  )
}

function formatDateTime(value?: Date | string | null): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

function extractActionId(actionTaken?: string | null): string | null {
  if (!actionTaken) return null
  const value = actionTaken.trim()
  if (value.length === 0) return null
  const parts = value.split(':')
  return parts[parts.length - 1] ?? value
}

function resolveActionLabel(
  actionId: string | null,
  actions: ObjectDetailProps['actions'],
  t: ReturnType<typeof useT>,
): string {
  if (!actionId) return '-'
  const action = actions.find((item) => item.id === actionId)
  if (!action) return actionId
  return t(action.labelKey ?? action.id, action.id)
}

function formatUserLabel(
  userId: string | null | undefined,
  userName: string | null,
  t: ReturnType<typeof useT>,
): string {
  if (!userId) return ''
  if (userName) return userName
  return t('common.user', 'user')
}

export default LeaveRequestDetail
