"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import {
  clearRecordLockFormState,
  getRecordLockFormState,
  setRecordLockFormState,
  subscribeRecordLockFormState,
  type RecordLockUiConflict,
  type RecordLockUiView,
} from '../../../lib/clientLockStore'

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

function resolveResourceKind(context: CrudInjectionContext): string | null {
  if (context.resourceKind && context.resourceKind.trim()) return context.resourceKind
  const entityId = context.entityId
  if (!entityId || !entityId.includes(':')) return null
  const [moduleId, rawEntity] = entityId.split(':')
  const entity = rawEntity ?? ''
  if (moduleId === 'customers') {
    if (entity.includes('deal')) return 'customers.deal'
    if (entity.includes('person')) return 'customers.person'
    if (entity.includes('company')) return 'customers.company'
  }
  if (moduleId === 'sales') {
    if (entity.includes('quote')) return 'sales.quote'
    if (entity.includes('order')) return 'sales.order'
  }
  const normalized = entity.replace(new RegExp(`^${moduleId}_`), '')
  return normalized ? `${moduleId}.${normalized}` : null
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
      setRecordLockFormState(formId, {
        formId,
        resourceKind,
        resourceId,
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
    && state.currentUserId
    && state.lock.lockedByUserId === state.currentUserId
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

  if (!state?.lock || mine) {
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
            {state?.conflict?.changes?.length ? (
              <div className="max-h-[280px] overflow-auto rounded border">
                {state.conflict.changes.map((change) => (
                  <div key={change.field} className="border-b last:border-b-0 px-3 py-2">
                    <div className="font-medium">{change.field}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('record_locks.conflict.incoming_value', 'Incoming value')}: {String(change.incomingValue ?? t('record_locks.conflict.empty_value', '(empty)'))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('record_locks.conflict.mine_value', 'Your value')}: {String(change.mineValue ?? t('record_locks.conflict.empty_value', '(empty)'))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleAcceptIncoming}>
                {t('record_locks.conflict.accept_incoming', 'Accept incoming')}
              </Button>
              <Button onClick={handleKeepMine}>
                {t('record_locks.conflict.accept_mine', 'Keep my changes')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const actorLabel = state.lock.lockedByName || state.lock.lockedByEmail || state.lock.lockedByUserId
  const ipLabel = state.lock.lockedByIp ? ` (${state.lock.lockedByIp})` : ''

  return (
    <>
      <div className="rounded-md border border-blue-300/40 bg-blue-100/70 px-4 py-3 text-sm text-blue-900">
        <div className="font-medium">
          {t('record_locks.banner.optimistic_notice', 'Another user is editing this record. Conflicts may occur on save.')}
        </div>
        <div className="mt-1 text-xs">
          {actorLabel}{ipLabel}
        </div>
        {state.allowForceUnlock ? (
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={handleTakeOver}>
              {t('record_locks.banner.take_over', 'Take over editing')}
            </Button>
          </div>
        ) : null}
      </div>
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
            {state?.conflict?.changes?.length ? (
              <div className="max-h-[280px] overflow-auto rounded border">
                {state.conflict.changes.map((change) => (
                  <div key={change.field} className="border-b last:border-b-0 px-3 py-2">
                    <div className="font-medium">{change.field}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('record_locks.conflict.incoming_value', 'Incoming value')}: {String(change.incomingValue ?? t('record_locks.conflict.empty_value', '(empty)'))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('record_locks.conflict.mine_value', 'Your value')}: {String(change.mineValue ?? t('record_locks.conflict.empty_value', '(empty)'))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleAcceptIncoming}>
                {t('record_locks.conflict.accept_incoming', 'Accept incoming')}
              </Button>
              <Button onClick={handleKeepMine}>
                {t('record_locks.conflict.accept_mine', 'Keep my changes')}
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
