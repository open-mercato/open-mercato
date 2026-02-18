import type { AwilixContainer } from 'awilix'

export type CrudRecordLockResolution = 'normal' | 'accept_mine' | 'merged'

export type CrudRecordLockHeaders = {
  resourceKind?: string
  resourceId?: string
  token?: string
  baseLogId?: string
  resolution?: CrudRecordLockResolution
  conflictId?: string
}

export type CrudRecordLockValidationInput = {
  tenantId: string
  organizationId?: string | null
  userId: string
  resourceKind: string
  resourceId: string
  method: 'PUT' | 'DELETE'
  headers: CrudRecordLockHeaders
}

export type CrudRecordLockValidationSuccess = {
  ok: true
  shouldReleaseOnSuccess: boolean
}

export type CrudRecordLockValidationFailure = {
  ok: false
  status: 409 | 423
  error: string
  code: 'record_lock_conflict' | 'record_locked'
  lock?: unknown
  conflict?: unknown
}

export type CrudRecordLockValidationResult =
  | CrudRecordLockValidationSuccess
  | CrudRecordLockValidationFailure

export type CrudRecordLockReleaseInput = {
  tenantId: string
  organizationId?: string | null
  userId: string
  resourceKind: string
  resourceId: string
  token: string
  reason?: 'saved' | 'cancelled' | 'unmount' | 'conflict_resolved'
}

type RecordLockServiceLike = {
  validateMutation: (input: CrudRecordLockValidationInput) => Promise<CrudRecordLockValidationResult>
  releaseAfterMutation: (input: CrudRecordLockReleaseInput) => Promise<void>
}

function trimToUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function normalizeResolution(value: string | null | undefined): CrudRecordLockResolution | undefined {
  const trimmed = trimToUndefined(value)
  if (!trimmed) return undefined
  if (trimmed === 'normal' || trimmed === 'accept_mine' || trimmed === 'merged') {
    return trimmed
  }
  return undefined
}

function resolveRecordLockService(container: AwilixContainer): RecordLockServiceLike | null {
  try {
    const service = container.resolve<RecordLockServiceLike>('recordLockService')
    if (!service) return null
    if (typeof service.validateMutation !== 'function') return null
    if (typeof service.releaseAfterMutation !== 'function') return null
    return service
  } catch {
    return null
  }
}

export function readCrudRecordLockHeaders(headers: Headers): CrudRecordLockHeaders {
  return {
    resourceKind: trimToUndefined(headers.get('x-om-record-lock-kind')),
    resourceId: trimToUndefined(headers.get('x-om-record-lock-resource-id')),
    token: trimToUndefined(headers.get('x-om-record-lock-token')),
    baseLogId: trimToUndefined(headers.get('x-om-record-lock-base-log-id')),
    resolution: normalizeResolution(headers.get('x-om-record-lock-resolution')),
    conflictId: trimToUndefined(headers.get('x-om-record-lock-conflict-id')),
  }
}

export async function validateCrudRecordLock(
  container: AwilixContainer,
  input: CrudRecordLockValidationInput,
): Promise<CrudRecordLockValidationResult | null> {
  const service = resolveRecordLockService(container)
  if (!service) return null
  return service.validateMutation(input)
}

export async function releaseCrudRecordLockAfterSuccess(
  container: AwilixContainer,
  input: CrudRecordLockReleaseInput,
): Promise<void> {
  const service = resolveRecordLockService(container)
  if (!service) return
  await service.releaseAfterMutation(input)
}
