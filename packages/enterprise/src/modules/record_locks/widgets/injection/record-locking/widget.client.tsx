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
import { useSearchParams } from 'next/navigation'
import {
  ChangedFieldsTable,
  type ChangeRow,
} from '@open-mercato/core/modules/audit_logs/lib/display-helpers'
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

function clearIncomingChangesQueryFlag() {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('showIncomingChanges') !== '1') return
    url.searchParams.delete('showIncomingChanges')
    const nextUrl = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState(window.history.state, '', nextUrl)
  } catch {
    // ignore URL parse failures
  }
}

function clearLockContentionQueryFlag() {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('showLockContention') !== '1') return
    url.searchParams.delete('showLockContention')
    const nextUrl = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState(window.history.state, '', nextUrl)
  } catch {
    // ignore URL parse failures
  }
}

function submitCrudForm(formId: string): boolean {
  if (typeof document === 'undefined') return false
  const form = document.getElementById(formId)
  if (!(form instanceof HTMLFormElement)) return false
  form.requestSubmit()
  return true
}

function formatIpAddress(ip: string | null | undefined, t: ReturnType<typeof useT>): string | null {
  if (!ip) return null
  const normalized = ip.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === '::1' || normalized === '127.0.0.1' || normalized === 'localhost') {
    return t('record_locks.banner.local_machine', 'local machine')
  }
  return ip
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
  const searchParams = useSearchParams()
  const resourceKind = React.useMemo(() => resolveResourceKind(context), [context])
  const resourceId = React.useMemo(() => resolveResourceId(context, data), [context, data])
  const formId = context.formId
  const [, forceRender] = React.useReducer((value) => value + 1, 0)
  const state = getRecordLockFormState(formId)
  const [mounted, setMounted] = React.useState(false)
  const [showIncomingChangesRequested, setShowIncomingChangesRequested] = React.useState(false)
  const [showLockContentionBanner, setShowLockContentionBanner] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => {
    const showIncomingChanges = searchParams?.get('showIncomingChanges') === '1'
    const showLockContention = searchParams?.get('showLockContention') === '1'

    if (showIncomingChanges) {
      setShowIncomingChangesRequested(true)
      clearIncomingChangesQueryFlag()
    }

    if (showLockContention) {
      setShowLockContentionBanner(true)
      clearLockContentionQueryFlag()
    }
  }, [searchParams])

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
    if (!mine || !state?.lock?.id) return
    let cancelled = false

    const syncContentionBanner = async () => {
      const call = await apiCall<{ items?: Array<{ sourceEntityId?: string | null; type?: string }> }>(
        '/api/notifications?status=unread&type=record_locks.lock.contended&pageSize=20'
      )
      if (cancelled) return
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      const hasUnreadContention = items.some((item) => item.sourceEntityId === state.lock?.id)
      if (hasUnreadContention) {
        setShowLockContentionBanner(true)
      }
    }

    void syncContentionBanner()
    const interval = window.setInterval(() => {
      void syncContentionBanner()
    }, 5000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [mine, state?.lock?.id])

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
    if (!showIncomingChangesRequested) return
    if (!state?.resourceKind || !state?.resourceId || !state?.lock) return
    let cancelled = false
    const openIncomingChangesDialog = async () => {
      clearIncomingChangesQueryFlag()
      setShowIncomingChangesRequested(false)
      await validateBeforeSave({}, context)
      if (cancelled) return
    }
    void openIncomingChangesDialog()
    return () => {
      cancelled = true
    }
  }, [context, showIncomingChangesRequested, state?.lock, state?.resourceId, state?.resourceKind, t])

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
      pendingConflictId: null,
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
    setRecordLockFormState(formId, { conflict: null, pendingConflictId: null, pendingResolution: 'normal' })
    window.location.reload()
  }, [formId, state?.conflict, state?.lock?.token, state?.resourceId, state?.resourceKind])

  const handleKeepMine = React.useCallback(() => {
    if (!state?.conflict) return
    setRecordLockFormState(formId, {
      pendingResolution: 'accept_mine',
      pendingConflictId: state.conflict.id,
      conflict: null,
    })
    window.setTimeout(() => {
      submitCrudForm(formId)
    }, 0)
  }, [formId, state?.conflict])

  const handleKeepEditing = React.useCallback(() => {
    if (!state?.conflict) return
    setRecordLockFormState(formId, {
      conflict: null,
      pendingConflictId: null,
      pendingResolution: 'normal',
    })
  }, [formId, state?.conflict])

  const noneLabel = t('audit_logs.common.none')
  const conflictChangeRows = React.useMemo<ChangeRow[]>(
    () => (state?.conflict?.changes ?? []).map((change) => ({
      field: change.field,
      from: change.incomingValue,
      to: change.mineValue,
    })),
    [state?.conflict?.changes],
  )
  const canKeepMyChanges = Boolean(
    state?.conflict?.allowIncomingOverride
    && state?.conflict?.canOverrideIncoming === true
    && state?.conflict?.resolutionOptions?.includes('accept_mine'),
  )
  const showOverrideBlockedNotice = Boolean(
    state?.conflict?.allowIncomingOverride
    && !state?.conflict?.canOverrideIncoming,
  )
  const conflictDialog = (
    <Dialog open={Boolean(state?.conflict)} onOpenChange={(open) => {
      if (open) return
      setRecordLockFormState(formId, {
        conflict: null,
        pendingConflictId: null,
        pendingResolution: 'normal',
      })
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('record_locks.conflict.title', 'Conflict detected')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {t('record_locks.conflict.description', 'The record was changed by another user after you started editing.')}
          </p>
          <ChangedFieldsTable
            changeRows={conflictChangeRows}
            noneLabel={noneLabel}
            t={t}
            beforeLabel={t('record_locks.conflict.incoming_label', 'Incoming')}
            afterLabel={t('record_locks.conflict.current_label', 'Current')}
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
          <div className="-mx-6 -mb-6 mt-4 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={handleAcceptIncoming}>
              {t('record_locks.conflict.accept_incoming', 'Accept incoming')}
            </Button>
            {canKeepMyChanges ? (
              <Button onClick={handleKeepMine}>
                {t('record_locks.conflict.accept_mine', 'Keep my changes')}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={handleKeepEditing}>
              {t('record_locks.conflict.keep_editing', 'Keep editing')}
            </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )

  const ownerContentionBanner = mine && showLockContentionBanner ? (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
      <div className="font-medium">
        {t(
          'record_locks.banner.contention_notice',
          'Another user opened this record while you are editing it. Conflicts may occur on save.',
        )}
      </div>
      <div className="mt-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowLockContentionBanner(false)}
          className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-900"
        >
          {t('common.close', 'Close')}
        </Button>
      </div>
    </div>
  ) : null
  const topBannerTarget = mounted ? document.getElementById('om-top-banners') : null

  if (!state?.lock || mine) {
    if (!ownerContentionBanner) return conflictDialog
    return (
      <>
        {topBannerTarget ? createPortal(ownerContentionBanner, topBannerTarget) : ownerContentionBanner}
        {conflictDialog}
      </>
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
  const bannerMessageRaw = t('record_locks.banner.optimistic_notice', 'Another user is editing this record. Conflicts may occur on save.')
  const bannerMessage = typeof bannerMessageRaw === 'string' && bannerMessageRaw.trim().length > 0
    ? bannerMessageRaw
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
      {state.allowForceUnlock ? (
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

  return (
    <>
      {topBannerTarget ? createPortal(lockBanner, topBannerTarget) : lockBanner}
      {conflictDialog}
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
  const conflictId = resolution === 'normal'
    ? undefined
    : (state?.pendingConflictId ?? state?.conflict?.id ?? undefined)
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
    const nextResolution = resolution === 'normal' ? 'normal' : resolution
    setRecordLockFormState(formId, {
      resourceKind,
      resourceId,
      latestActionLogId: payload.latestActionLogId ?? state?.latestActionLogId ?? null,
      lock: payload.lock ?? state?.lock ?? null,
      conflict: null,
      pendingConflictId: nextResolution === 'normal' ? null : (conflictId ?? state?.pendingConflictId ?? null),
      pendingResolution: nextResolution,
    })
    return payload
  }
  setRecordLockFormState(formId, {
    resourceKind,
    resourceId,
    lock: payload.lock ?? state?.lock ?? null,
    conflict: payload.conflict ?? state?.conflict ?? null,
    pendingConflictId: payload.conflict?.id ?? conflictId ?? state?.pendingConflictId ?? null,
    pendingResolution: resolution === 'normal' ? 'normal' : resolution,
  })
  return payload
}
