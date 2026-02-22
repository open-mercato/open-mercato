"use client"

import * as React from 'react'
import { createPortal } from 'react-dom'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { BACKEND_MUTATION_ERROR_EVENT } from '@open-mercato/ui/backend/injection/mutationEvents'
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
  type RecordLockFormState,
  type RecordLockUiConflict,
  type RecordLockUiView,
} from '@open-mercato/enterprise/modules/record_locks/lib/clientLockStore'

type CrudInjectionContext = {
  formId?: string
  entityId?: string
  resourceKind?: string
  resourceId?: string
  recordId?: string
  path?: string
  query?: string
  kind?: string
  personId?: string
  companyId?: string
  dealId?: string
  retryLastMutation?: () => Promise<boolean | void> | boolean | void
}

type RecordLockWidgetOwner = {
  instanceId: string
  priority: number
}

const GLOBAL_RECORD_LOCK_OWNERS_KEY = '__openMercatoRecordLockWidgetOwners__'

function getRecordLockOwnerMap(): Map<string, RecordLockWidgetOwner> {
  const store = globalThis as Record<string, unknown>
  const existing = store[GLOBAL_RECORD_LOCK_OWNERS_KEY]
  if (existing instanceof Map) return existing as Map<string, RecordLockWidgetOwner>
  const next = new Map<string, RecordLockWidgetOwner>()
  store[GLOBAL_RECORD_LOCK_OWNERS_KEY] = next
  return next
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
  status?: number
  code?: string
  latestActionLogId?: string | null
  lock?: RecordLockUiView | null
  conflict?: RecordLockUiConflict | null
}

type CrudSaveErrorEventDetail = {
  contextId?: string
  formId?: string
  error?: unknown
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isUuid(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
}

function extractErrorStatus(error: unknown): number | null {
  const queue: unknown[] = [error]
  const visited = new Set<unknown>()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    if (!isObjectRecord(current)) continue

    const status = current.status
    if (typeof status === 'number' && Number.isFinite(status)) return status
    if (typeof status === 'string') {
      const parsed = Number(status)
      if (Number.isFinite(parsed)) return parsed
    }

    const statusCode = current.statusCode
    if (typeof statusCode === 'number' && Number.isFinite(statusCode)) return statusCode
    if (typeof statusCode === 'string') {
      const parsed = Number(statusCode)
      if (Number.isFinite(parsed)) return parsed
    }

    const nested = ['body', 'response', 'data', 'details', 'error', 'cause']
    for (const key of nested) {
      const next = current[key]
      if (next && !visited.has(next)) queue.push(next)
    }
  }

  return null
}

function extractRecordLockConflictPayload(error: unknown): {
  conflict: RecordLockUiConflict
  lock?: RecordLockUiView | null
  latestActionLogId?: string | null
} | null {
  const queue: unknown[] = [error]
  const visited = new Set<unknown>()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    if (!isObjectRecord(current)) continue

    const nested = ['body', 'response', 'data', 'details', 'error']
    for (const key of nested) {
      const next = current[key]
      if (next && !visited.has(next)) queue.push(next)
    }

    const code = typeof current.code === 'string' ? current.code : null
    const status = extractErrorStatus(current)
    const hasLockMarkers = (
      isObjectRecord(current.lock)
      || isObjectRecord(current.conflict)
      || typeof current.conflictId === 'string'
      || typeof current.resourceKind === 'string'
      || typeof current.resourceId === 'string'
      || Array.isArray(current.resolutionOptions)
      || typeof current.allowIncomingOverride === 'boolean'
      || typeof current.canOverrideIncoming === 'boolean'
    )
    const message = typeof current.message === 'string'
      ? current.message.toLowerCase()
      : typeof current.error === 'string'
        ? current.error.toLowerCase()
        : ''
    const looksLikeLockConflictMessage = (
      message.includes('record conflict')
      || message.includes('record_lock_conflict')
      || message.includes('conflict detected')
    )
    const isRecordLockConflict = (
      code === 'record_lock_conflict'
      || (status === 409 && (hasLockMarkers || looksLikeLockConflictMessage))
    )
    if (!isRecordLockConflict) continue
    if (!isObjectRecord(current.conflict)) {
      const lock = isObjectRecord(current.lock) ? (current.lock as RecordLockUiView) : undefined
      const fallbackConflictId = typeof current.conflictId === 'string' && isUuid(current.conflictId)
        ? current.conflictId
        : 'unresolved'
      const fallbackConflict: RecordLockUiConflict = {
        id: fallbackConflictId,
        resourceKind:
          (typeof current.resourceKind === 'string' && current.resourceKind.trim().length > 0
            ? current.resourceKind
            : lock?.resourceKind) ?? '',
        resourceId:
          (typeof current.resourceId === 'string' && current.resourceId.trim().length > 0
            ? current.resourceId
            : lock?.resourceId) ?? '',
        baseActionLogId:
          typeof current.baseActionLogId === 'string' || current.baseActionLogId === null
            ? current.baseActionLogId
            : lock?.baseActionLogId ?? null,
        incomingActionLogId:
          typeof current.incomingActionLogId === 'string' || current.incomingActionLogId === null
            ? current.incomingActionLogId
            : null,
        allowIncomingOverride: Boolean(current.allowIncomingOverride),
        canOverrideIncoming: Boolean(current.canOverrideIncoming),
        resolutionOptions: Array.isArray(current.resolutionOptions) && current.resolutionOptions.includes('accept_mine')
          ? ['accept_mine']
          : [],
        changes: [],
      }
      return {
        conflict: fallbackConflict,
        lock,
        latestActionLogId: typeof current.latestActionLogId === 'string' || current.latestActionLogId === null
          ? current.latestActionLogId
          : undefined,
      }
    }
    return {
      conflict: current.conflict as RecordLockUiConflict,
      lock: isObjectRecord(current.lock) ? (current.lock as RecordLockUiView) : undefined,
      latestActionLogId: typeof current.latestActionLogId === 'string' || current.latestActionLogId === null
        ? current.latestActionLogId
        : undefined,
    }
  }

  return null
}

function isRecordDeletedError(error: unknown): boolean {
  const queue: unknown[] = [error]
  const visited = new Set<unknown>()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    if (!isObjectRecord(current)) continue

    const status = extractErrorStatus(current)
    const code = typeof current.code === 'string' ? current.code.toLowerCase() : ''
    const message = typeof current.message === 'string'
      ? current.message.toLowerCase()
      : typeof current.error === 'string'
        ? current.error.toLowerCase()
        : ''

    const matchesCode = (
      code === 'record_not_found'
      || code === 'not_found'
      || code === 'record_deleted'
    )
    const matchesMessage = (
      message.includes('not found')
      || message.includes('was deleted')
      || message.includes('record deleted')
    )

    if (status === 404 || matchesCode || matchesMessage) {
      return true
    }

    const nested = ['body', 'response', 'data', 'details', 'error', 'cause']
    for (const key of nested) {
      const next = current[key]
      if (next && !visited.has(next)) queue.push(next)
    }
  }

  return false
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
  if (context.kind === 'order') return 'sales.order'
  if (context.kind === 'quote') return 'sales.quote'
  if (context.personId) return 'customers.person'
  if (context.companyId) return 'customers.company'
  if (context.dealId) return 'customers.deal'
  const entityId = context.entityId
  if (entityId && entityId.includes(':')) {
    const [moduleId, rawEntity] = entityId.split(':')
    const entity = rawEntity ?? ''
    const normalizedModuleId = moduleId.trim()
    const normalizedEntity = entity.trim()
    if (normalizedModuleId && normalizedEntity) {
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

      if (finalEntity) return `${normalizedModuleId}.${finalEntity}`
    }
  }

  const path = context.path ?? ''
  if (path.startsWith('/backend/customers/people/')) return 'customers.person'
  if (path.startsWith('/backend/customers/companies/')) return 'customers.company'
  if (path.startsWith('/backend/customers/deals/')) return 'customers.deal'
  if (path.startsWith('/backend/sales/orders/')) return 'sales.order'
  if (path.startsWith('/backend/sales/quotes/')) return 'sales.quote'
  if (path.startsWith('/backend/sales/documents/')) {
    const query = context.query ?? ''
    const params = new URLSearchParams(query)
    const kind = params.get('kind')
    if (kind === 'order') return 'sales.order'
    if (kind === 'quote') return 'sales.quote'
  }

  return null
}

function resolveResourceId(context: CrudInjectionContext, data: unknown): string | null {
  if (context.resourceId && context.resourceId.trim()) return context.resourceId
  if (context.recordId && context.recordId.trim()) return context.recordId
  if (context.personId && context.personId.trim()) return context.personId
  if (context.companyId && context.companyId.trim()) return context.companyId
  if (context.dealId && context.dealId.trim()) return context.dealId
  if (data && typeof data === 'object' && 'id' in data) {
    const id = (data as { id?: unknown }).id
    if (typeof id === 'string' && id.trim()) return id
  }
  if (data && typeof data === 'object') {
    const nestedPersonId = (data as { person?: { id?: unknown } }).person?.id
    if (typeof nestedPersonId === 'string' && nestedPersonId.trim()) return nestedPersonId
    const nestedCompanyId = (data as { company?: { id?: unknown } }).company?.id
    if (typeof nestedCompanyId === 'string' && nestedCompanyId.trim()) return nestedCompanyId
    const nestedDealId = (data as { deal?: { id?: unknown } }).deal?.id
    if (typeof nestedDealId === 'string' && nestedDealId.trim()) return nestedDealId
  }
  const path = context.path ?? ''
  const parts = path.split('/').filter((part) => part.length > 0)
  const candidates = [
    ['backend', 'customers', 'people'],
    ['backend', 'customers', 'companies'],
    ['backend', 'customers', 'deals'],
    ['backend', 'sales', 'orders'],
    ['backend', 'sales', 'quotes'],
    ['backend', 'sales', 'documents'],
  ] as const
  for (const prefix of candidates) {
    const matchesPrefix = prefix.every((segment, index) => parts[index] === segment)
    if (!matchesPrefix || parts.length <= prefix.length) continue
    const rawId = parts[prefix.length] ?? ''
    if (!rawId) continue
    try {
      const decoded = decodeURIComponent(rawId).trim()
      if (decoded.length > 0) return decoded
    } catch {
      const trimmed = rawId.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  return null
}

function resolveFormId(
  context: CrudInjectionContext,
  resourceKind: string | null,
  resourceId: string | null,
): string {
  if (context.formId && context.formId.trim().length > 0) return context.formId
  if (resourceKind && resourceId) return `record-lock:${resourceKind}:${resourceId}`
  if (context.path && context.path.trim().length > 0) {
    const query = context.query?.trim()
    return `record-lock:${context.path}${query ? `?${query}` : ''}`
  }
  return 'record-lock:global'
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
  }).catch((error) => {
    console.warn('[RecordLockingWidget] Failed to release lock with keepalive fallback', error)
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
  const formId = React.useMemo(
    () => resolveFormId(context, resourceKind, resourceId),
    [context, resourceId, resourceKind],
  )
  const [, forceRender] = React.useReducer((value) => value + 1, 0)
  const state = getRecordLockFormState(formId)
  const [mounted, setMounted] = React.useState(false)
  const [showIncomingChangesRequested, setShowIncomingChangesRequested] = React.useState(false)
  const [showLockContentionBanner, setShowLockContentionBanner] = React.useState(false)
  const [isConflictDialogOpen, setIsConflictDialogOpen] = React.useState(false)
  const instanceId = React.useMemo(
    () =>
      `record-lock-widget:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`,
    [],
  )
  const ownerPriority = context.formId ? 2 : 1
  const ownerKey = resourceKind && resourceId ? `${resourceKind}:${resourceId}` : null
  const [isPrimaryInstance, setIsPrimaryInstance] = React.useState(true)
  const releasePayloadRef = React.useRef<{
    resourceKind: string
    resourceId: string
    token: string
  } | null>(null)
  const keepMineRetryVersionRef = React.useRef(0)

  React.useEffect(() => {
    if (!ownerKey) {
      setIsPrimaryInstance(true)
      return
    }

    const owners = getRecordLockOwnerMap()
    const notifyOwnersChanged = () => {
      if (typeof window === 'undefined') return
      window.dispatchEvent(
        new CustomEvent('om:record-lock-owner-changed', {
          detail: { ownerKey },
        }),
      )
    }

    const claimOwnership = () => {
      const current = owners.get(ownerKey)
      if (!current) {
        owners.set(ownerKey, { instanceId, priority: ownerPriority })
        setIsPrimaryInstance(true)
        notifyOwnersChanged()
        return
      }
      if (current.instanceId === instanceId) {
        setIsPrimaryInstance(true)
        return
      }
      if (ownerPriority > current.priority) {
        owners.set(ownerKey, { instanceId, priority: ownerPriority })
        setIsPrimaryInstance(true)
        notifyOwnersChanged()
        return
      }
      setIsPrimaryInstance(false)
    }

    claimOwnership()
    const onOwnersChanged = () => claimOwnership()
    if (typeof window !== 'undefined') {
      window.addEventListener('om:record-lock-owner-changed', onOwnersChanged)
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('om:record-lock-owner-changed', onOwnersChanged)
      }
      const current = owners.get(ownerKey)
      if (current?.instanceId === instanceId) {
        owners.delete(ownerKey)
        notifyOwnersChanged()
      }
    }
  }, [instanceId, ownerKey, ownerPriority])

  React.useEffect(() => {
    if (isPrimaryInstance) return
    const current = getRecordLockFormState(formId)
    if (!current?.lock?.token || !current.resourceKind || !current.resourceId) {
      clearRecordLockFormState(formId)
      return
    }
    void releaseLock({
      resourceKind: current.resourceKind,
      resourceId: current.resourceId,
      token: current.lock.token,
      reason: 'cancelled',
    }).catch((error) => {
      console.warn('[RecordLockingWidget] Failed to release lock while demoting owner', error)
    })
    clearRecordLockFormState(formId)
  }, [formId, isPrimaryInstance])

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
    if (!state?.conflict) {
      setIsConflictDialogOpen(false)
      return
    }
    setIsConflictDialogOpen(true)
  }, [
    state?.conflict?.id,
    state?.conflict?.incomingActionLogId,
    state?.conflict?.baseActionLogId,
  ])

  React.useEffect(() => {
    if (!isPrimaryInstance) return
    if (!resourceKind || !resourceId) return
    setRecordLockFormState(formId, { formId, resourceKind, resourceId })
  }, [formId, isPrimaryInstance, resourceId, resourceKind])

  React.useEffect(() => {
    if (!isPrimaryInstance) return
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
          lock: payload.lock ?? null,
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
  }, [formId, isPrimaryInstance, resourceId, resourceKind])

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
    if (!isPrimaryInstance) return
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
  }, [isPrimaryInstance, mine, state?.lock?.id])

  React.useEffect(() => {
    if (!isPrimaryInstance) return
    if (!state?.resourceKind || !state?.resourceId) return
    if (state.recordDeleted === true) return
    let cancelled = false

    const syncRecordDeletedState = async () => {
      const call = await apiCall<{
        items?: Array<{
          sourceEntityId?: string | null
          bodyVariables?: Record<string, string> | null
        }>
      }>('/api/notifications?status=unread&type=record_locks.record.deleted&pageSize=20')
      if (cancelled) return
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      const hasUnreadRecordDeleted = items.some((item) => {
        const matchesResourceId = item.sourceEntityId === state.resourceId
        if (!matchesResourceId) return false
        const kindFromBody = typeof item.bodyVariables?.resourceKind === 'string'
          ? item.bodyVariables.resourceKind.trim()
          : ''
        if (!kindFromBody) return true
        return kindFromBody === state.resourceKind
      })
      if (!hasUnreadRecordDeleted) return
      setIsConflictDialogOpen(true)
      setRecordLockFormState(formId, {
        recordDeleted: true,
        acquired: false,
        lock: null,
        conflict: null,
        pendingConflictId: null,
        pendingResolution: 'normal',
        pendingResolutionArmed: false,
      })
    }

    void syncRecordDeletedState()
    const interval = window.setInterval(() => {
      void syncRecordDeletedState()
    }, 5000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [formId, isPrimaryInstance, state?.recordDeleted, state?.resourceId, state?.resourceKind])

  React.useEffect(() => {
    if (!isPrimaryInstance) return
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
  }, [isPrimaryInstance, state?.heartbeatSeconds, state?.lock?.token, state?.resourceId, state?.resourceKind])

  React.useEffect(() => {
    if (!isPrimaryInstance) return
    const hasUnresolvedConflict = Boolean(state?.conflict)
      && !(
        state?.pendingResolutionArmed === true
        && typeof state?.pendingResolution === 'string'
        && state.pendingResolution !== 'normal'
      )
    if (hasUnresolvedConflict) return
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
      const payload = call.result ?? {}
      if (cancelled) return
      if (!call.ok) {
        const currentState = getRecordLockFormState(formId)
        setRecordLockFormState(formId, {
          resourceKind: state.resourceKind,
          resourceId: state.resourceId,
          acquired: false,
          lock: payload.lock ?? null,
          currentUserId: payload.currentUserId ?? currentState?.currentUserId ?? null,
          heartbeatSeconds: payload.heartbeatSeconds ?? currentState?.heartbeatSeconds ?? 15,
          latestActionLogId: payload.latestActionLogId ?? currentState?.latestActionLogId ?? null,
          allowForceUnlock: payload.allowForceUnlock ?? false,
        })
        return
      }
      const currentState = getRecordLockFormState(formId)
      const previousToken = currentState?.lock?.token ?? null
      const nextToken = payload.lock?.token ?? null
      const isSameSession = Boolean(previousToken && nextToken && previousToken === nextToken)
      const nextLatestActionLogId = isSameSession
        ? (currentState?.latestActionLogId ?? null)
        : (payload.latestActionLogId ?? currentState?.latestActionLogId ?? null)

      setRecordLockFormState(formId, {
        resourceKind: state.resourceKind,
        resourceId: state.resourceId,
        acquired: payload.acquired ?? false,
        lock: payload.lock ?? null,
        currentUserId: payload.currentUserId ?? null,
        heartbeatSeconds: payload.heartbeatSeconds ?? 15,
        latestActionLogId: nextLatestActionLogId,
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
    isPrimaryInstance,
    state?.conflict,
    state?.pendingResolution,
    state?.pendingResolutionArmed,
    state?.resourceId,
    state?.resourceKind,
  ])

  React.useEffect(() => {
    if (!isPrimaryInstance) return
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
  }, [context, isPrimaryInstance, showIncomingChangesRequested, state?.lock, state?.resourceId, state?.resourceKind, t])

  React.useEffect(() => {
    if (!isPrimaryInstance) return
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
  }, [isPrimaryInstance, state?.lock?.token, state?.resourceId, state?.resourceKind])

  React.useEffect(() => {
    if (!isPrimaryInstance) return
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
  }, [isPrimaryInstance])

  React.useEffect(() => {
    if (!isPrimaryInstance) return
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
  }, [formId, isPrimaryInstance])

  React.useEffect(() => {
    if (!isPrimaryInstance) return
    const onCrudSaveError = (event: Event) => {
      const applyConflictPayload = (payload: {
        conflict: RecordLockUiConflict
        lock?: RecordLockUiView | null
        latestActionLogId?: string | null
      }) => {
        setIsConflictDialogOpen(true)
        const nextPatch: Partial<RecordLockFormState> = {
          conflict: payload.conflict,
          pendingConflictId: payload.conflict.id,
          pendingResolution: 'normal',
          pendingResolutionArmed: false,
        }
        if (payload.lock !== undefined) {
          nextPatch.lock = payload.lock
        }
        if (payload.latestActionLogId !== undefined) {
          nextPatch.latestActionLogId = payload.latestActionLogId
        }
        setRecordLockFormState(formId, {
          ...nextPatch,
        })
      }

      const buildFallbackConflict = (currentState: RecordLockFormState) => {
        const preferredConflictId = isUuid(currentState.pendingConflictId)
          ? currentState.pendingConflictId
          : isUuid(currentState.conflict?.id)
            ? currentState.conflict.id
            : 'unresolved'
        return ({
          conflict: {
            id: preferredConflictId,
            resourceKind: currentState.resourceKind ?? '',
            resourceId: currentState.resourceId ?? '',
          baseActionLogId: currentState.latestActionLogId ?? null,
          incomingActionLogId: null,
          allowIncomingOverride: false,
          canOverrideIncoming: false,
          resolutionOptions: [],
          changes: [],
        } as RecordLockUiConflict,
        lock: currentState.lock ?? undefined,
        latestActionLogId: currentState.latestActionLogId ?? null,
      })
      }

      const detail = (event as CustomEvent<CrudSaveErrorEventDetail>).detail
      if (!detail) return
      const eventContextId = detail.contextId ?? detail.formId
      let payload = extractRecordLockConflictPayload(detail.error)
      const currentState = getRecordLockFormState(formId)
      const eventTargetsCurrentForm = !eventContextId || eventContextId === formId
      if (!eventTargetsCurrentForm) {
        if (!payload || !currentState?.resourceKind || !currentState?.resourceId) return
        const payloadResourceKind = payload.conflict.resourceKind?.trim() ?? ''
        const payloadResourceId = payload.conflict.resourceId?.trim() ?? ''
        if (!payloadResourceKind || !payloadResourceId) return
        if (payloadResourceKind !== currentState.resourceKind || payloadResourceId !== currentState.resourceId) return
      }
        if (!payload) {
        if (!currentState?.resourceKind || !currentState?.resourceId) return
        if (isRecordDeletedError(detail.error)) {
          setIsConflictDialogOpen(true)
          setRecordLockFormState(formId, {
            recordDeleted: true,
            acquired: false,
            lock: null,
            conflict: null,
            pendingConflictId: null,
            pendingResolution: 'normal',
            pendingResolutionArmed: false,
          })
          return
        }
        if (extractErrorStatus(detail.error) === 409) {
          applyConflictPayload(buildFallbackConflict(currentState))
        }
        return
      }

      applyConflictPayload(payload)
    }

    window.addEventListener(BACKEND_MUTATION_ERROR_EVENT, onCrudSaveError)
    window.addEventListener('om:crud-save-error', onCrudSaveError)
    return () => {
      window.removeEventListener(BACKEND_MUTATION_ERROR_EVENT, onCrudSaveError)
      window.removeEventListener('om:crud-save-error', onCrudSaveError)
    }
  }, [formId, isPrimaryInstance])

  const handleTakeOver = React.useCallback(async () => {
    keepMineRetryVersionRef.current += 1
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
      pendingResolutionArmed: false,
    })
  }, [formId, state?.resourceId, state?.resourceKind, t])

  const handleAcceptIncoming = React.useCallback(async () => {
    keepMineRetryVersionRef.current += 1
    if (!state?.conflict || !state?.resourceKind || !state?.resourceId) return
    let conflictId: string | undefined = isUuid(state.conflict.id) ? state.conflict.id : undefined
    if (!conflictId) {
      const validation = await validateBeforeSave({}, context)
      conflictId = isUuid(validation.conflict?.id) ? validation.conflict.id : undefined
      if (!conflictId) {
        flash(
          t(
            'record_locks.conflict.refresh_required',
            'Could not confirm conflict details. Save again to refresh conflict data.',
          ),
          'error',
        )
        return
      }
    }
    await apiCallOrThrow('/api/record_locks/release', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceKind: state.resourceKind,
        resourceId: state.resourceId,
        token: state.lock?.token ?? undefined,
        reason: 'conflict_resolved',
        conflictId,
        resolution: 'accept_incoming',
      }),
    })
    setRecordLockFormState(formId, {
      conflict: null,
      pendingConflictId: null,
      pendingResolution: 'normal',
      pendingResolutionArmed: false,
    })
    window.location.reload()
  }, [context, formId, state?.conflict, state?.lock?.token, state?.resourceId, state?.resourceKind, t])

  const handleKeepMine = React.useCallback(() => {
    if (!state?.conflict) return
    const applyAcceptMine = async () => {
      const keepMineRetryVersion = keepMineRetryVersionRef.current + 1
      keepMineRetryVersionRef.current = keepMineRetryVersion
      let conflictId: string | null = isUuid(state.conflict?.id) ? state.conflict.id : null
      if (!conflictId) {
        const validation = await validateBeforeSave({}, context)
        conflictId = isUuid(validation.conflict?.id) ? validation.conflict.id : null
      }
      if (!conflictId) {
        flash(
          t(
            'record_locks.conflict.refresh_required',
            'Could not confirm conflict details. Save again to refresh conflict data.',
          ),
          'error',
        )
        return
      }
      setRecordLockFormState(formId, {
        pendingResolution: 'accept_mine',
        pendingConflictId: conflictId,
        pendingResolutionArmed: true,
      })
      window.setTimeout(async () => {
        if (keepMineRetryVersionRef.current !== keepMineRetryVersion) return
        const currentState = getRecordLockFormState(formId)
        if (currentState?.pendingResolution !== 'accept_mine') return
        const submitted = submitCrudForm(formId)
        if (submitted) return
        const retried = await Promise.resolve(context.retryLastMutation?.()).catch(() => false)
        if (!retried) {
          flash(
            t(
              'record_locks.conflict.retry_save_after_accept_mine',
              'Click save again to apply your changes.',
            ),
            'info',
          )
        }
      }, 0)
    }
    void applyAcceptMine()
  }, [context, context.retryLastMutation, formId, state?.conflict, t])

  const handleKeepEditing = React.useCallback(() => {
    keepMineRetryVersionRef.current += 1
    setIsConflictDialogOpen(false)
  }, [])

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
  const isRecordDeleted = state?.recordDeleted === true
  const showOverrideBlockedNotice = Boolean(
    state?.conflict?.allowIncomingOverride
    && !state?.conflict?.canOverrideIncoming,
  )
  const conflictDialog = (
    <Dialog open={Boolean(state?.conflict || isRecordDeleted) && isConflictDialogOpen} onOpenChange={(open) => {
      if (open) {
        setIsConflictDialogOpen(true)
        return
      }
      if (isRecordDeleted) {
        setIsConflictDialogOpen(true)
        return
      }
      setIsConflictDialogOpen(false)
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isRecordDeleted
              ? t('record_locks.conflict.record_deleted_title', 'Record was deleted')
              : t('record_locks.conflict.title', 'Conflict detected')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {isRecordDeleted
              ? t(
                'record_locks.conflict.record_deleted_description',
                'This record was deleted by another user while you were editing. Saving is blocked to avoid unexpected results.',
              )
              : t('record_locks.conflict.description', 'The record was changed by another user after you started editing.')}
          </p>
          {!isRecordDeleted ? (
          <ChangedFieldsTable
            changeRows={conflictChangeRows}
            noneLabel={noneLabel}
            t={t}
            beforeLabel={t('record_locks.conflict.incoming_label', 'Incoming')}
            afterLabel={t('record_locks.conflict.current_label', 'Current')}
          />
          ) : null}
          {(state?.conflict?.changes?.length ?? 0) === 0 ? (
            !isRecordDeleted ? (
            <Notice compact variant="info">
              {t(
                'record_locks.conflict.no_field_details',
                'Field-level conflict details are unavailable for this record. Choose a resolution to continue.'
              )}
            </Notice>
            ) : null
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
            {isRecordDeleted ? null : (
              <>
            <Button
              type="button"
              variant="outline"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void handleAcceptIncoming()
              }}
            >
              {t('record_locks.conflict.accept_incoming', 'Accept incoming')}
            </Button>
            {canKeepMyChanges ? (
              <Button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void handleKeepMine()
                }}
              >
                {t('record_locks.conflict.accept_mine', 'Keep my changes')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                handleKeepEditing()
              }}
            >
              {t('record_locks.conflict.keep_editing', 'Keep editing')}
            </Button>
              </>
            )}
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

  if (!isPrimaryInstance) return null
  if (!state?.lock) return conflictDialog

  const defaultPresenceMessage = activeParticipantCount > 1
    ? `${activeParticipantCount} users are currently on this record.`
    : 'This record is currently locked by another user.'
  const bannerMessageRaw = !mine
    ? t('record_locks.banner.locked_by_other', 'This record is currently locked by another user.')
    : showLockContentionBanner
      ? t('record_locks.banner.contention_notice', 'Another user opened this record while you are editing it. Conflicts may occur on save.')
      : t('record_locks.banner.participants_notice', 'Multiple users are currently on this record.')
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
          type="button"
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
            type="button"
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
  const contextResourceKind = resolveResourceKind(context)
  const contextResourceId = resolveResourceId(context, data)
  const formId = resolveFormId(context, contextResourceKind, contextResourceId)
  const state = getRecordLockFormState(formId)
  const resourceKind = state?.resourceKind || contextResourceKind
  const resourceId = state?.resourceId || contextResourceId
  if (!resourceKind || !resourceId) {
    return { ok: true }
  }
  const hasSelectedConflictResolution = Boolean(
    state?.pendingResolutionArmed === true
    && typeof state?.pendingResolution === 'string'
    && state.pendingResolution !== 'normal',
  )
  if (state?.conflict && !hasSelectedConflictResolution) {
    return {
      ok: false,
      status: 409,
      code: 'record_lock_conflict',
      lock: state.lock ?? null,
      conflict: state.conflict,
      latestActionLogId: state.latestActionLogId ?? null,
    }
  }
  const hasResolvableConflict = Boolean(state?.conflict?.id && isUuid(state.conflict.id))
  const requestedResolution = state?.pendingResolution ?? 'normal'
  const resolution = requestedResolution !== 'normal' && !hasResolvableConflict
    ? 'normal'
    : requestedResolution
  const rawConflictId = resolution === 'normal' || !hasResolvableConflict
    ? undefined
    : (state?.pendingConflictId ?? state?.conflict?.id ?? undefined)
  const conflictId = isUuid(rawConflictId) ? rawConflictId : undefined
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
    const preserveConflictUntilSuccessfulSave = nextResolution !== 'normal'
    setRecordLockFormState(formId, {
      resourceKind,
      resourceId,
      latestActionLogId: payload.latestActionLogId ?? state?.latestActionLogId ?? null,
      lock: payload.lock ?? state?.lock ?? null,
      conflict: preserveConflictUntilSuccessfulSave ? (state?.conflict ?? null) : null,
      pendingConflictId: nextResolution === 'normal' ? null : (conflictId ?? state?.pendingConflictId ?? null),
      pendingResolution: nextResolution,
      pendingResolutionArmed: nextResolution === 'normal' ? false : Boolean(state?.pendingResolutionArmed),
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
    pendingResolutionArmed: resolution === 'normal' ? false : Boolean(state?.pendingResolutionArmed),
  })
  return payload
}
