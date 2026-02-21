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
import { Mail } from 'lucide-react'
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

function releaseLockWithKeepalive(state: {
  resourceKind: string
  resourceId: string
  token?: string | null
  reason?: 'saved' | 'cancelled' | 'unmount'
}) {
  const payload = JSON.stringify({
    resourceKind: state.resourceKind,
    resourceId: state.resourceId,
    token: state.token ?? undefined,
    reason: state.reason ?? 'unmount',
  })

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' })
      const sent = navigator.sendBeacon('/api/record_locks/release', blob)
      if (sent) return
    }
  } catch {
    // ignore and fallback to fetch
  }

  void fetch('/api/record_locks/release', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
    keepalive: true,
    credentials: 'include',
  }).catch(() => {})
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
  const releasePayloadRef = React.useRef<{
    resourceKind: string
    resourceId: string
    token: string
  } | null>(null)

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

  const mine = Boolean(state?.lock?.token)
  const participants = React.useMemo(() => {
    if (!state?.lock) return []
    const fromPayload = Array.isArray(state.lock.participants) ? state.lock.participants : []
    if (fromPayload.length) return fromPayload
    return [{
      userId: state.lock.lockedByUserId,
      lockedByName: state.lock.lockedByName,
      lockedByEmail: state.lock.lockedByEmail,
      lockedByIp: state.lock.lockedByIp,
      lockedAt: state.lock.lockedAt,
      lastHeartbeatAt: state.lock.lastHeartbeatAt,
      expiresAt: state.lock.expiresAt,
    }]
  }, [state?.lock])
  const activeParticipantCount = state?.lock?.activeParticipantCount ?? participants.length
  const otherParticipants = React.useMemo(() => {
    if (!state?.currentUserId) return participants
    return participants.filter((participant) => participant.userId !== state.currentUserId)
  }, [participants, state?.currentUserId])

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
    if (!state?.lock?.token || !state.resourceKind || !state.resourceId) return
    const intervalMs = 10_000
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
  }, [state?.heartbeatSeconds, state?.lock?.token, state?.resourceId, state?.resourceKind])

  React.useEffect(() => {
    if (!state?.resourceKind || !state?.resourceId) return
    let cancelled = false
    const refreshPresence = async () => {
      const call = await apiCall<AcquireResponse>('/api/record_locks/acquire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resourceKind: state.resourceKind,
          resourceId: state.resourceId,
        }),
      })
      if (cancelled || !call.ok) return
      const payload = call.result ?? {}
      setRecordLockFormState(formId, {
        resourceKind: state.resourceKind,
        resourceId: state.resourceId,
        acquired: payload.acquired ?? false,
        lock: payload.lock ?? null,
        currentUserId: payload.currentUserId ?? null,
        heartbeatSeconds: payload.heartbeatSeconds ?? 15,
        latestActionLogId: payload.latestActionLogId ?? null,
        allowForceUnlock: payload.allowForceUnlock ?? false,
      })
    }

    const interval = window.setInterval(() => {
      void refreshPresence()
    }, 4000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [
    formId,
    state?.resourceId,
    state?.resourceKind,
  ])

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
    if (
      state?.resourceKind
      && state?.resourceId
      && typeof state.lock?.token === 'string'
      && state.lock.token.trim().length > 0
    ) {
      releasePayloadRef.current = {
        resourceKind: state.resourceKind,
        resourceId: state.resourceId,
        token: state.lock.token,
      }
      return
    }
    releasePayloadRef.current = null
  }, [state?.lock?.token, state?.resourceId, state?.resourceKind])

  React.useEffect(() => {
    const onPageHide = () => {
      const payload = releasePayloadRef.current
      if (!payload) return
      releaseLockWithKeepalive({
        ...payload,
        reason: 'unmount',
      })
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])

  React.useEffect(() => {
    return () => {
      const payload = releasePayloadRef.current
      if (payload) {
        void releaseLock({
          ...payload,
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

  const participantEmails = React.useMemo(() => {
    return otherParticipants
      .map((participant) => participant.lockedByEmail?.trim() ?? '')
      .filter((email, index, all) => email.length > 0 && all.indexOf(email) === index)
      .slice(0, 4)
  }, [otherParticipants])

  React.useEffect(() => {
    if (!showLockContentionBanner) return
    if (!mine) return
    if (activeParticipantCount > 1) return
    setShowLockContentionBanner(false)
  }, [activeParticipantCount, mine, showLockContentionBanner])

  const topBannerTarget = mounted ? document.getElementById('om-top-banners') : null

  if (!state?.lock) return conflictDialog

  const defaultPresenceMessage = activeParticipantCount > 1
    ? `${activeParticipantCount} users are currently on this record.`
    : 'This record is currently locked by another user.'
  const bannerMessageRaw = mine
    ? t('record_locks.banner.participants_notice', 'Multiple users are currently on this record.')
    : t('record_locks.banner.optimistic_notice', defaultPresenceMessage)
  const bannerMessage = typeof bannerMessageRaw === 'string' && bannerMessageRaw.trim().length > 0
    ? bannerMessageRaw
    : defaultPresenceMessage
  const shouldShowPresenceBanner = Boolean(
    showLockContentionBanner
    || activeParticipantCount > 1
    || !mine,
  )

  const lockBanner = shouldShowPresenceBanner ? (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
      <div className="font-medium">
        {bannerMessage}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-900/90">
        <span>{`${t('record_locks.banner.active_users_label', 'Active users')}: ${activeParticipantCount}`}</span>
        {participantEmails.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900"
          >
            <Mail className="h-3 w-3" />
            <span>{email}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
      {state.allowForceUnlock && !mine ? (
        <Button
          size="sm"
          variant="outline"
          onClick={handleTakeOver}
          className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-900"
        >
          {t('record_locks.banner.take_over', 'Take over editing')}
        </Button>
      ) : null}
      {showLockContentionBanner ? (
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
      ) : null}
      </div>
    </div>
  ) : null

  return (
    <>
      {lockBanner ? (topBannerTarget ? createPortal(lockBanner, topBannerTarget) : lockBanner) : null}
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
