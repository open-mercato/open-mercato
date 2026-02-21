"use client"

import * as React from 'react'
import { createPortal } from 'react-dom'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import {
  clearRecordLockFormState,
  getRecordLockFormState,
  setRecordLockFormState,
  subscribeRecordLockFormState,
  type RecordLockUiConflict,
  type RecordLockUiView,
} from '@open-mercato/enterprise/modules/record_locks/lib/clientLockStore'

type CrudInjectionContext = {
  formId: string
  entityId?: string
  resourceKind?: string
  resourceId?: string
  recordId?: string
}

type AcquireResponse = {
  ok?: boolean
  acquired?: boolean
  allowForceUnlock?: boolean
  heartbeatSeconds?: number
  latestActionLogId?: string | null
  lock?: RecordLockUiView | null
  currentUserId?: string
  error?: string
  code?: string
}

type ValidateResponse = {
  ok: boolean
  latestActionLogId?: string | null
  lock?: RecordLockUiView | null
  conflict?: RecordLockUiConflict | null
}

type ConflictChange = NonNullable<RecordLockUiConflict['changes']>[number]

function formatIpAddress(ip: string | null | undefined, t: ReturnType<typeof useT>): string | null {
  if (!ip) return null
  const normalized = ip.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === '::1' || normalized === '127.0.0.1' || normalized === 'localhost') {
    return t('record_locks.banner.local_machine', 'local machine')
  }
  return ip
}

function formatFieldLabel(rawField: string): string {
  const trimmedField = rawField.trim()
  const withoutNamespace = trimmedField.includes('::') ? (trimmedField.split('::').pop() ?? trimmedField) : trimmedField
  const withoutPrefix = withoutNamespace.includes('.') ? (withoutNamespace.split('.').pop() ?? withoutNamespace) : withoutNamespace
  const words = withoutPrefix
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  if (!words.length) return trimmedField
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatConflictValue(value: unknown, emptyLabel: string): string {
  if (value == null) return emptyLabel
  const text = String(value).trim()
  return text.length ? text : emptyLabel
}

function ConflictFieldComparisonRow({
  change,
  incomingLabel,
  mineLabel,
  emptyLabel,
}: {
  change: ConflictChange
  incomingLabel: string
  mineLabel: string
  emptyLabel: string
}) {
  return (
    <div className="border-b last:border-b-0 px-3 py-2">
      <div className="font-medium">{formatFieldLabel(change.field)}</div>
      <div className="text-xs text-muted-foreground">
        {incomingLabel}: {formatConflictValue(change.incomingValue, emptyLabel)}
      </div>
      <div className="text-xs text-muted-foreground">
        {mineLabel}: {formatConflictValue(change.mineValue, emptyLabel)}
      </div>
    </div>
  )
}

function ConflictFieldComparisonList({
  changes,
  incomingLabel,
  mineLabel,
  emptyLabel,
}: {
  changes: ConflictChange[]
  incomingLabel: string
  mineLabel: string
  emptyLabel: string
}) {
  if (!changes.length) return null

  return (
    <div className="max-h-[280px] overflow-auto rounded border">
      {changes.map((change) => (
        <ConflictFieldComparisonRow
          key={change.field}
          change={change}
          incomingLabel={incomingLabel}
          mineLabel={mineLabel}
          emptyLabel={emptyLabel}
        />
      ))}
    </div>
  )
}

function resolveResourceKind(context: CrudInjectionContext): string | null {
  if (context.resourceKind && context.resourceKind.trim()) return context.resourceKind
  const entityId = context.entityId
  if (!entityId || !entityId.includes(':')) return null
  const [moduleId, rawEntity] = entityId.split(':')
  const entity = rawEntity ?? ''
  const normalizedModuleId = moduleId.trim()
  const normalizedEntity = entity.trim()
  if (!normalizedModuleId || !normalizedEntity) return null

  const singularModuleId = normalizedModuleId.endsWith('s')
    ? normalizedModuleId.slice(0, -1)
    : normalizedModuleId

  const stripPrefixes = [
    `${normalizedModuleId}_`,
    `${singularModuleId}_`,
  ]

  let finalEntity = normalizedEntity
  for (const prefix of stripPrefixes) {
    if (finalEntity.startsWith(prefix)) {
      finalEntity = finalEntity.slice(prefix.length)
      break
    }
  }

  return finalEntity ? `${normalizedModuleId}.${finalEntity}` : null
}

function resolveResourceId(context: CrudInjectionContext, data: unknown): string | null {
  if (context.resourceId && context.resourceId.trim()) return context.resourceId
  if (context.recordId && context.recordId.trim()) return context.recordId
  if (data && typeof data === 'object' && 'id' in data) {
    const id = (data as { id?: unknown }).id
    if (typeof id === 'string' && id.trim()) return id
  }
  return null
}

async function releaseLock(state: {
  resourceKind: string
  resourceId: string
  token?: string | null
  reason?: 'saved' | 'cancelled' | 'unmount'
}) {
  await apiCall('/api/record_locks/release', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resourceKind: state.resourceKind,
      resourceId: state.resourceId,
      token: state.token ?? undefined,
      reason: state.reason ?? 'cancelled',
    }),
  })
}

export default function RecordLockingWidget({
  context,
  data,
}: InjectionWidgetComponentProps<CrudInjectionContext, Record<string, unknown>>) {
  const t = useT()
  const resourceKind = React.useMemo(() => resolveResourceKind(context), [context])
  const resourceId = React.useMemo(() => resolveResourceId(context, data), [context, data])
  const formId = context.formId
  const [, forceRender] = React.useReducer((value) => value + 1, 0)
  const state = getRecordLockFormState(formId)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => subscribeRecordLockFormState(formId, () => forceRender()), [formId])

  React.useEffect(() => {
    if (!resourceKind || !resourceId) return
    setRecordLockFormState(formId, { formId, resourceKind, resourceId })
  }, [formId, resourceId, resourceKind])

  React.useEffect(() => {
    if (!resourceKind || !resourceId) return
    let active = true
    const acquire = async () => {
      const call = await apiCall<AcquireResponse>('/api/record_locks/acquire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resourceKind, resourceId }),
      })
      const payload = call.result ?? {}
      if (!active) return
      if (!call.ok) {
        const defaultMessage = call.status === 403
          ? t('api.errors.forbidden', 'Forbidden')
          : t('record_locks.errors.acquire_failed', 'Failed to load record lock status.')
        const message = typeof payload.error === 'string' && payload.error.trim().length
          ? payload.error
          : defaultMessage
        flash(message, 'error')
        setRecordLockFormState(formId, {
          formId,
          resourceKind,
          resourceId,
          acquired: false,
          lock: null,
          currentUserId: payload.currentUserId ?? null,
          heartbeatSeconds: payload.heartbeatSeconds ?? 15,
          latestActionLogId: payload.latestActionLogId ?? null,
          allowForceUnlock: payload.allowForceUnlock ?? false,
        })
        return
      }
      setRecordLockFormState(formId, {
        formId,
        resourceKind,
        resourceId,
        acquired: payload.acquired ?? false,
        lock: payload.lock ?? null,
        currentUserId: payload.currentUserId ?? null,
        heartbeatSeconds: payload.heartbeatSeconds ?? 15,
        latestActionLogId: payload.latestActionLogId ?? null,
        allowForceUnlock: payload.allowForceUnlock ?? false,
      })
    }
    void acquire()
    return () => {
      active = false
    }
  }, [formId, resourceId, resourceKind])

  const mine = Boolean(
    state?.lock
    && (
      state.acquired === true
      || (state.currentUserId && state.lock.lockedByUserId === state.currentUserId)
    )
  )

  React.useEffect(() => {
    if (!state?.lock?.token || !mine || !state.resourceKind || !state.resourceId) return
    const intervalMs = Math.max((state.heartbeatSeconds ?? 15) * 1000, 5000)
    const interval = window.setInterval(() => {
      void apiCall('/api/record_locks/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resourceKind: state.resourceKind,
          resourceId: state.resourceId,
          token: state.lock?.token,
        }),
      })
    }, intervalMs)
    return () => window.clearInterval(interval)
  }, [mine, state?.heartbeatSeconds, state?.lock?.token, state?.resourceId, state?.resourceKind])

  React.useEffect(() => {
    return () => {
      const current = getRecordLockFormState(formId)
      if (current?.lock?.token && current.resourceKind && current.resourceId) {
        void releaseLock({
          resourceKind: current.resourceKind,
          resourceId: current.resourceId,
          token: current.lock.token,
          reason: 'unmount',
        })
      }
      clearRecordLockFormState(formId)
    }
  }, [formId])

  const handleTakeOver = React.useCallback(async () => {
    if (!state?.resourceKind || !state?.resourceId) return
    const call = await apiCall<AcquireResponse>('/api/record_locks/force-release', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceKind: state.resourceKind,
        resourceId: state.resourceId,
      }),
    })
    if (!call.ok) {
      flash(t('record_locks.errors.force_release_failed', 'Failed to take over editing.'), 'error')
      return
    }
    const acquire = await apiCall<AcquireResponse>('/api/record_locks/acquire', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceKind: state.resourceKind, resourceId: state.resourceId }),
    })
    if (!acquire.ok) {
      flash(t('record_locks.errors.force_release_failed', 'Failed to take over editing.'), 'error')
      return
    }
    const payload = acquire.result ?? {}
    setRecordLockFormState(formId, {
      acquired: payload.acquired ?? false,
      lock: payload.lock ?? null,
      currentUserId: payload.currentUserId ?? null,
      allowForceUnlock: payload.allowForceUnlock ?? false,
      latestActionLogId: payload.latestActionLogId ?? null,
      heartbeatSeconds: payload.heartbeatSeconds ?? 15,
      conflict: null,
      pendingResolution: 'normal',
    })
  }, [formId, state?.resourceId, state?.resourceKind, t])

  const handleAcceptIncoming = React.useCallback(async () => {
    if (!state?.conflict || !state?.resourceKind || !state?.resourceId) return
    await apiCall('/api/record_locks/release', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceKind: state.resourceKind,
        resourceId: state.resourceId,
        token: state.lock?.token ?? undefined,
        reason: 'conflict_resolved',
        conflictId: state.conflict.id,
        resolution: 'accept_incoming',
      }),
    })
    setRecordLockFormState(formId, { conflict: null, pendingResolution: 'normal' })
    window.location.reload()
  }, [formId, state?.conflict, state?.lock?.token, state?.resourceId, state?.resourceKind])

  const handleKeepMine = React.useCallback(() => {
    if (!state?.conflict) return
    setRecordLockFormState(formId, {
      pendingResolution: 'accept_mine',
      conflict: null,
    })
    flash(t('record_locks.conflict.accept_mine', 'Keep my changes'), 'info')
  }, [formId, state?.conflict, t])

  const handleKeepEditing = React.useCallback(() => {
    if (!state?.conflict) return
    setRecordLockFormState(formId, {
      conflict: null,
      pendingResolution: 'normal',
    })
  }, [formId, state?.conflict])

  const incomingValueLabel = t('record_locks.conflict.incoming_value', 'Incoming value')
  const mineValueLabel = t('record_locks.conflict.mine_value', 'Your value')
  const emptyValueLabel = t('record_locks.conflict.empty_value', '(empty)')
  const canOverrideIncoming = Boolean(
    state?.conflict?.canOverrideIncoming
    && state?.conflict?.resolutionOptions?.includes('accept_mine'),
  )
  const showOverrideBlockedNotice = Boolean(
    state?.conflict?.allowIncomingOverride
    && !state?.conflict?.canOverrideIncoming,
  )

  if (!state?.lock || (mine && state.acquired !== false)) {
    return (
      <Dialog open={Boolean(state?.conflict)} onOpenChange={(open) => {
        if (open) return
        setRecordLockFormState(formId, { conflict: null })
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('record_locks.conflict.title', 'Conflict detected')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {t('record_locks.conflict.description', 'The record was changed by another user after you started editing.')}
            </p>
            <ConflictFieldComparisonList
              changes={state?.conflict?.changes ?? []}
              incomingLabel={incomingValueLabel}
              mineLabel={mineValueLabel}
              emptyLabel={emptyValueLabel}
            />
            {(state?.conflict?.changes?.length ?? 0) === 0 ? (
              <Notice compact variant="info">
                {t(
                  'record_locks.conflict.no_field_details',
                  'Field-level conflict details are unavailable for this record. Choose a resolution to continue.'
                )}
              </Notice>
            ) : null}
            {showOverrideBlockedNotice ? (
              <Notice compact variant="warning">
                {t(
                  'record_locks.conflict.override_blocked_notice',
                  'You cannot keep your version because you do not have permission to override incoming changes.',
                )}
              </Notice>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleAcceptIncoming}>
                {t('record_locks.conflict.accept_incoming', 'Accept incoming')}
              </Button>
              {canOverrideIncoming ? (
                <Button onClick={handleKeepMine}>
                  {t('record_locks.conflict.accept_mine', 'Keep my changes')}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={handleKeepEditing}>
                {t('record_locks.conflict.keep_editing', 'Keep editing')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const actorName = state.lock.lockedByName?.trim() || null
  const actorEmail = state.lock.lockedByEmail?.trim() || null
  const actorIdentity = actorName && actorEmail
    ? `${actorName} (${actorEmail})`
    : actorName || actorEmail || state.lock.lockedByUserId
  const ipAddress = formatIpAddress(state.lock.lockedByIp, t)
  const ipLabel = ipAddress ? ` (${ipAddress})` : ''
  const actorDetails = actorIdentity ? `${actorIdentity}${ipLabel}` : ipAddress
  const showSameUserSessionBanner = mine && state.acquired === false
  const bannerMessageRaw = showSameUserSessionBanner
    ? t('record_locks.banner.same_user_session', 'This record is already open in another session.')
    : t('record_locks.banner.optimistic_notice', 'Another user is editing this record. Conflicts may occur on save.')
  const bannerMessage = typeof bannerMessageRaw === 'string' && bannerMessageRaw.trim().length > 0
    ? bannerMessageRaw
    : showSameUserSessionBanner
      ? 'This record is already open in another session.'
      : 'Another user is editing this record. Conflicts may occur on save.'

  const lockBanner = (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
      <div className="font-medium">
        {bannerMessage}
      </div>
      {actorDetails ? (
        <div className="mt-1 text-xs text-amber-900/90">
          {actorDetails}
        </div>
      ) : null}
      {state.allowForceUnlock && !showSameUserSessionBanner ? (
        <div className="mt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTakeOver}
            className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-900"
          >
            {t('record_locks.banner.take_over', 'Take over editing')}
          </Button>
        </div>
      ) : null}
    </div>
  )

  const topBannerTarget = mounted ? document.getElementById('om-top-banners') : null

  return (
    <>
      {topBannerTarget ? createPortal(lockBanner, topBannerTarget) : lockBanner}
      <Dialog open={Boolean(state?.conflict)} onOpenChange={(open) => {
        if (open) return
        setRecordLockFormState(formId, { conflict: null })
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('record_locks.conflict.title', 'Conflict detected')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {t('record_locks.conflict.description', 'The record was changed by another user after you started editing.')}
            </p>
            <ConflictFieldComparisonList
              changes={state?.conflict?.changes ?? []}
              incomingLabel={incomingValueLabel}
              mineLabel={mineValueLabel}
              emptyLabel={emptyValueLabel}
            />
            {(state?.conflict?.changes?.length ?? 0) === 0 ? (
              <Notice compact variant="info">
                {t(
                  'record_locks.conflict.no_field_details',
                  'Field-level conflict details are unavailable for this record. Choose a resolution to continue.'
                )}
              </Notice>
            ) : null}
            {showOverrideBlockedNotice ? (
              <Notice compact variant="warning">
                {t(
                  'record_locks.conflict.override_blocked_notice',
                  'You cannot keep your version because you do not have permission to override incoming changes.',
                )}
              </Notice>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleAcceptIncoming}>
                {t('record_locks.conflict.accept_incoming', 'Accept incoming')}
              </Button>
              {canOverrideIncoming ? (
                <Button onClick={handleKeepMine}>
                  {t('record_locks.conflict.accept_mine', 'Keep my changes')}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={handleKeepEditing}>
                {t('record_locks.conflict.keep_editing', 'Keep editing')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export async function validateBeforeSave(
  data: Record<string, unknown>,
  context: CrudInjectionContext,
): Promise<ValidateResponse> {
  const formId = context.formId
  const state = getRecordLockFormState(formId)
  const resourceKind = state?.resourceKind || resolveResourceKind(context)
  const resourceId = state?.resourceId || resolveResourceId(context, data)
  if (!resourceKind || !resourceId) {
    return { ok: true }
  }
  const resolution = state?.pendingResolution ?? 'normal'
  const conflictId = resolution === 'normal' ? undefined : state?.conflict?.id
  const call = await apiCall<ValidateResponse>('/api/record_locks/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resourceKind,
      resourceId,
      method: 'PUT',
      token: state?.lock?.token ?? undefined,
      baseLogId: state?.latestActionLogId ?? state?.lock?.baseActionLogId ?? undefined,
      conflictId,
      resolution,
      mutationPayload: data,
    }),
  })
  const payload = call.result ?? { ok: false }
  if (payload.ok) {
    setRecordLockFormState(formId, {
      resourceKind,
      resourceId,
      latestActionLogId: payload.latestActionLogId ?? state?.latestActionLogId ?? null,
      lock: payload.lock ?? state?.lock ?? null,
      conflict: null,
      pendingResolution: 'normal',
    })
    return payload
  }
  setRecordLockFormState(formId, {
    resourceKind,
    resourceId,
    lock: payload.lock ?? state?.lock ?? null,
    conflict: payload.conflict ?? null,
    pendingResolution: 'normal',
  })
  return payload
}
