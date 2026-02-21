import { randomUUID } from 'crypto'
import { UniqueConstraintViolationException, type FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { emitRecordLocksEvent } from '../events'
import {
  RecordLock,
  RecordLockConflict,
  type RecordLockStatus,
  type RecordLockReleaseReason,
  type RecordLockConflictResolution,
  type RecordLockConflictStatus,
} from '../data/entities'
import {
  recordLockMutationHeaderSchema,
  type RecordLockMutationHeaders,
  type RecordLockReleaseInput as RecordLockReleasePayloadInput,
  type RecordLockSettingsInput,
} from '../data/validators'
import {
  DEFAULT_RECORD_LOCK_SETTINGS,
  RECORD_LOCKS_MODULE_ID,
  RECORD_LOCKS_SETTINGS_NAME,
  isRecordLockingEnabledForResource,
  normalizeRecordLockSettings,
  type RecordLockSettings,
  type RecordLockStrategy,
} from './config'

const ACTIVE_LOCK_STATUS: RecordLockStatus = 'active'
const ACTIVE_SCOPE_UNIQUE_CONSTRAINTS = new Set([
  'record_locks_active_scope_org_unique',
  'record_locks_active_scope_tenant_unique',
])
const LOCK_CONTENTION_EVENT_TTL_MS = 15_000
const lockContentionEventThrottle = new Map<string, number>()
const LOCK_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const LOCK_RETENTION_MS = 3 * 24 * 60 * 60 * 1000
const RESOLVED_CONFLICT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const PENDING_CONFLICT_RETENTION_MS = 24 * 60 * 60 * 1000
const lockCleanupStateByTenant = new Map<string, { lastRunAt: number; inFlight: boolean }>()

export type RecordLockScope = {
  tenantId: string
  organizationId?: string | null
  userId: string
}

export type RecordLockResource = {
  resourceKind: string
  resourceId: string
}

export type RecordLockAcquireInput = RecordLockScope & RecordLockResource & {
  lockedByIp?: string | null
}

export type RecordLockHeartbeatInput = RecordLockScope & RecordLockResource & {
  token: string
}

export type RecordLockReleaseInput = RecordLockScope & RecordLockResource & {
  token?: string
  reason?: Exclude<RecordLockReleaseReason, 'expired' | 'force'>
} & Pick<RecordLockReleasePayloadInput, 'conflictId' | 'resolution'>

export type RecordLockForceReleaseInput = RecordLockScope & RecordLockResource & {
  reason?: string | null
}

export type RecordLockMutationValidationInput = RecordLockScope & RecordLockResource & {
  method: 'PUT' | 'DELETE'
  headers: Partial<RecordLockMutationHeaders>
  mutationPayload?: Record<string, unknown> | null
}

export type RecordLockConflictChange = {
  field: string
  displayValue: unknown
  baseValue: unknown
  incomingValue: unknown
  mineValue: unknown
}

export type RecordLockConflictPayload = {
  id: string
  resourceKind: string
  resourceId: string
  baseActionLogId: string | null
  incomingActionLogId: string | null
  allowIncomingOverride: boolean
  canOverrideIncoming: boolean
  resolutionOptions: Array<'accept_mine'>
  changes: RecordLockConflictChange[]
}

export type RecordLockView = {
  id: string
  resourceKind: string
  resourceId: string
  token: string | null
  strategy: RecordLockStrategy
  status: RecordLockStatus
  lockedByUserId: string
  lockedByIp: string | null
  baseActionLogId: string | null
  lockedAt: string
  lastHeartbeatAt: string
  expiresAt: string
}

export type RecordLockAcquireResult = {
  ok: true
  enabled: boolean
  resourceEnabled: boolean
  strategy: RecordLockStrategy
  allowForceUnlock: boolean
  heartbeatSeconds: number
  acquired: boolean
  latestActionLogId: string | null
  lock: RecordLockView | null
}

export type RecordLockAcquireFailure = RecordLockValidationFailure & {
  allowForceUnlock: boolean
}

export type RecordLockHeartbeatResult = {
  ok: true
  expiresAt: string | null
}

export type RecordLockReleaseResult = {
  ok: true
  released: boolean
  conflictResolved: boolean
}

export type RecordLockForceReleaseResult = {
  ok: true
  released: boolean
  lock: RecordLockView | null
}

export type RecordLockValidationSuccess = {
  ok: true
  enabled: boolean
  resourceEnabled: boolean
  strategy: RecordLockStrategy
  shouldReleaseOnSuccess: boolean
  lock: RecordLockView | null
  latestActionLogId: string | null
}

export type RecordLockValidationFailure = {
  ok: false
  status: 409 | 423
  error: string
  code: 'record_lock_conflict' | 'record_locked'
  lock: RecordLockView | null
  conflict?: RecordLockConflictPayload
}

export type RecordLockValidationResult = RecordLockValidationSuccess | RecordLockValidationFailure

export type RecordLockServiceDeps = {
  em: EntityManager
  moduleConfigService?: ModuleConfigService | null
  actionLogService?: ActionLogService | null
  rbacService?: RbacService | null
}

export type ParsedRecordLockHeaders = Partial<RecordLockMutationHeaders>

function normalizeDate(value: Date): string {
  return value.toISOString()
}

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeScopeOrganization(value: string | null | undefined): string | null {
  const trimmed = trimToNull(value)
  return trimmed ?? null
}

function shouldEmitLockContentionEvent(input: {
  tenantId: string
  organizationId?: string | null
  resourceKind: string
  resourceId: string
  lockedByUserId: string
  attemptedByUserId: string
}): boolean {
  if (process.env.NODE_ENV === 'test') return true
  const now = Date.now()
  const key = [
    input.tenantId,
    normalizeScopeOrganization(input.organizationId) ?? 'global',
    input.resourceKind,
    input.resourceId,
    input.lockedByUserId,
    input.attemptedByUserId,
  ].join('|')

  const lastEmittedAt = lockContentionEventThrottle.get(key)
  if (typeof lastEmittedAt === 'number' && now - lastEmittedAt < LOCK_CONTENTION_EVENT_TTL_MS) {
    return false
  }

  lockContentionEventThrottle.set(key, now)

  for (const [cachedKey, cachedAt] of lockContentionEventThrottle.entries()) {
    if (now - cachedAt > LOCK_CONTENTION_EVENT_TTL_MS) {
      lockContentionEventThrottle.delete(cachedKey)
    }
  }

  return true
}

function isActiveLockScopeUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) {
    const errorWithConstraint = error as unknown as { constraint?: unknown }
    const constraint = typeof errorWithConstraint.constraint === 'string'
      ? errorWithConstraint.constraint
      : null
    if (constraint && ACTIVE_SCOPE_UNIQUE_CONSTRAINTS.has(constraint)) return true
  }
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (code !== '23505') return false
  const message = typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message.toLowerCase()
    : ''
  for (const constraint of ACTIVE_SCOPE_UNIQUE_CONSTRAINTS) {
    if (message.includes(constraint)) return true
  }
  return false
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

const SKIPPED_CONFLICT_FIELDS = new Set([
  'updatedAt',
  'updated_at',
  'createdAt',
  'created_at',
  'deletedAt',
  'deleted_at',
])

function shouldSkipConflictField(path: string): boolean {
  if (!path.trim().length) return true
  if (SKIPPED_CONFLICT_FIELDS.has(path)) return true
  const segments = path.split('.').filter((segment) => segment.length > 0)
  if (!segments.length) return true
  return SKIPPED_CONFLICT_FIELDS.has(segments[segments.length - 1] ?? '')
}

const MISSING_CONFLICT_VALUE = Symbol('record_lock_conflict_missing_value')

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) {
    const iso = value.toISOString()
    return Number.isNaN(value.getTime()) ? null : iso
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function valuesEqual(a: unknown, b: unknown, seen?: Set<unknown>): boolean {
  if (Object.is(a, b)) return true

  if (a instanceof Date || b instanceof Date) {
    const left = toIsoDate(a)
    const right = toIsoDate(b)
    return left !== null && right !== null && left === right
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      if (!valuesEqual(a[index], b[index], seen)) return false
    }
    return true
  }

  if (isRecordValue(a) && isRecordValue(b)) {
    if (!seen) seen = new Set()
    if (seen.has(a) || seen.has(b)) return false
    seen.add(a)
    seen.add(b)
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false
      if (!valuesEqual(a[key], b[key], seen)) return false
    }
    return true
  }

  return false
}

function readPathValue(source: unknown, path: string): unknown | typeof MISSING_CONFLICT_VALUE {
  if (!path.trim().length || !isRecordValue(source)) return MISSING_CONFLICT_VALUE
  if (Object.prototype.hasOwnProperty.call(source, path)) return source[path]

  const segments = path.split('.').filter((segment) => segment.length > 0)
  if (!segments.length) return MISSING_CONFLICT_VALUE

  let current: unknown = source
  for (const segment of segments) {
    if (!isRecordValue(current)) return MISSING_CONFLICT_VALUE
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return MISSING_CONFLICT_VALUE
    current = current[segment]
  }
  return current
}

function buildPathVariants(path: string): string[] {
  const trimmed = path.trim()
  if (!trimmed.length) return []

  const segments = trimmed.split('.').filter((segment) => segment.length > 0)
  if (segments.length <= 1) return [trimmed]

  const variants = new Set<string>([trimmed])
  for (let index = 1; index < segments.length; index += 1) {
    variants.add(segments.slice(index).join('.'))
  }
  return Array.from(variants)
}

function readPathValueLoose(source: unknown, path: string): unknown | typeof MISSING_CONFLICT_VALUE {
  const variants = buildPathVariants(path)
  for (const variant of variants) {
    const value = readPathValue(source, variant)
    if (value !== MISSING_CONFLICT_VALUE) return value
  }
  return MISSING_CONFLICT_VALUE
}

function normalizeConflictValue(value: unknown): unknown {
  return value === undefined ? null : value
}

function formatChangedFieldLabel(rawField: string): string {
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

export function readRecordLockHeaders(headers: Headers): ParsedRecordLockHeaders {
  const raw = {
    resourceKind: trimToNull(headers.get('x-om-record-lock-kind')) ?? undefined,
    resourceId: trimToNull(headers.get('x-om-record-lock-resource-id')) ?? undefined,
    token: trimToNull(headers.get('x-om-record-lock-token')) ?? undefined,
    baseLogId: trimToNull(headers.get('x-om-record-lock-base-log-id')) ?? undefined,
    resolution: trimToNull(headers.get('x-om-record-lock-resolution')) ?? undefined,
    conflictId: trimToNull(headers.get('x-om-record-lock-conflict-id')) ?? undefined,
  }

  const parsed = recordLockMutationHeaderSchema.partial().safeParse(raw)
  if (!parsed.success) return {}
  return parsed.data
}

export class RecordLockService {
  private readonly em: EntityManager

  private readonly moduleConfigService: ModuleConfigService | null

  private readonly actionLogService: ActionLogService | null

  private readonly rbacService: RbacService | null

  constructor(deps: RecordLockServiceDeps) {
    this.em = deps.em
    this.moduleConfigService = deps.moduleConfigService ?? null
    this.actionLogService = deps.actionLogService ?? null
    this.rbacService = deps.rbacService ?? null
  }

  async getSettings(): Promise<RecordLockSettings> {
    if (!this.moduleConfigService) return DEFAULT_RECORD_LOCK_SETTINGS

    const value = await this.moduleConfigService.getValue<RecordLockSettings>(
      RECORD_LOCKS_MODULE_ID,
      RECORD_LOCKS_SETTINGS_NAME,
      { defaultValue: DEFAULT_RECORD_LOCK_SETTINGS },
    )

    return normalizeRecordLockSettings(value ?? DEFAULT_RECORD_LOCK_SETTINGS)
  }

  async saveSettings(input: RecordLockSettingsInput): Promise<RecordLockSettings> {
    const settings = normalizeRecordLockSettings(input)
    if (!this.moduleConfigService) return settings

    await this.moduleConfigService.setValue(RECORD_LOCKS_MODULE_ID, RECORD_LOCKS_SETTINGS_NAME, settings)
    return settings
  }

  async acquire(input: RecordLockAcquireInput): Promise<RecordLockAcquireResult | RecordLockAcquireFailure> {
    this.scheduleCleanup(input.tenantId)
    const settings = await this.getSettings()
    const latest = await this.findLatestActionLogWithScopeFallback(input)
    const resourceEnabled = isRecordLockingEnabledForResource(settings, input.resourceKind)

    if (!resourceEnabled) {
      return {
        ok: true,
        enabled: settings.enabled,
        resourceEnabled: false,
        strategy: settings.strategy,
        allowForceUnlock: settings.allowForceUnlock,
        heartbeatSeconds: settings.heartbeatSeconds,
        acquired: false,
        latestActionLogId: latest?.id ?? null,
        lock: null,
      }
    }

    const now = new Date()
    const active = await this.findActiveLock(input, now)

    if (active && active.lockedByUserId !== input.userId) {
      const lock = this.toLockView(active, false)
      if (shouldEmitLockContentionEvent({
        tenantId: active.tenantId,
        organizationId: active.organizationId,
        resourceKind: active.resourceKind,
        resourceId: active.resourceId,
        lockedByUserId: active.lockedByUserId,
        attemptedByUserId: input.userId,
      })) {
        await emitRecordLocksEvent('record_locks.lock.contended', {
          lockId: active.id,
          resourceKind: active.resourceKind,
          resourceId: active.resourceId,
          tenantId: active.tenantId,
          organizationId: active.organizationId,
          lockedByUserId: active.lockedByUserId,
          attemptedByUserId: input.userId,
        })
      }
      if (settings.strategy === 'pessimistic') {
        return {
          ok: false,
          status: 423,
          error: 'Record is currently locked by another user',
          code: 'record_locked',
          allowForceUnlock: settings.allowForceUnlock,
          lock,
        }
      }

      return {
        ok: true,
        enabled: settings.enabled,
        resourceEnabled: true,
        strategy: settings.strategy,
        allowForceUnlock: settings.allowForceUnlock,
        heartbeatSeconds: settings.heartbeatSeconds,
        acquired: false,
        latestActionLogId: latest?.id ?? null,
        lock,
      }
    }

    if (active && active.lockedByUserId === input.userId) {
      active.strategy = settings.strategy
      active.lockedByIp = input.lockedByIp ?? active.lockedByIp ?? null
      active.lastHeartbeatAt = now
      active.expiresAt = new Date(now.getTime() + settings.timeoutSeconds * 1000)
      active.baseActionLogId = latest?.id ?? active.baseActionLogId ?? null
      await this.em.flush()

      return {
        ok: true,
        enabled: settings.enabled,
        resourceEnabled: true,
        strategy: settings.strategy,
        allowForceUnlock: settings.allowForceUnlock,
        heartbeatSeconds: settings.heartbeatSeconds,
        acquired: false,
        latestActionLogId: latest?.id ?? null,
        lock: this.toLockView(active, true),
      }
    }

    const lock = this.em.create(RecordLock, {
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      token: randomUUID(),
      strategy: settings.strategy,
      status: ACTIVE_LOCK_STATUS,
      lockedByUserId: input.userId,
      lockedByIp: input.lockedByIp ?? null,
      baseActionLogId: latest?.id ?? null,
      lockedAt: now,
      lastHeartbeatAt: now,
      expiresAt: new Date(now.getTime() + settings.timeoutSeconds * 1000),
      tenantId: input.tenantId,
      organizationId: normalizeScopeOrganization(input.organizationId),
    })

    this.em.persist(lock)
    try {
      await this.em.flush()
    } catch (error) {
      if (!isActiveLockScopeUniqueViolation(error)) throw error
      const competing = await this.findActiveLock(input, now)
      if (!competing) throw error
      if (competing.lockedByUserId !== input.userId) {
        const lockView = this.toLockView(competing, false)
        if (shouldEmitLockContentionEvent({
          tenantId: competing.tenantId,
          organizationId: competing.organizationId,
          resourceKind: competing.resourceKind,
          resourceId: competing.resourceId,
          lockedByUserId: competing.lockedByUserId,
          attemptedByUserId: input.userId,
        })) {
          await emitRecordLocksEvent('record_locks.lock.contended', {
            lockId: competing.id,
            resourceKind: competing.resourceKind,
            resourceId: competing.resourceId,
            tenantId: competing.tenantId,
            organizationId: competing.organizationId,
            lockedByUserId: competing.lockedByUserId,
            attemptedByUserId: input.userId,
          })
        }
        if (settings.strategy === 'pessimistic') {
          return {
            ok: false,
            status: 423,
            error: 'Record is currently locked by another user',
            code: 'record_locked',
            allowForceUnlock: settings.allowForceUnlock,
            lock: lockView,
          }
        }

        return {
          ok: true,
          enabled: settings.enabled,
          resourceEnabled: true,
          strategy: settings.strategy,
          allowForceUnlock: settings.allowForceUnlock,
          heartbeatSeconds: settings.heartbeatSeconds,
          acquired: false,
          latestActionLogId: latest?.id ?? null,
          lock: lockView,
        }
      }

      competing.strategy = settings.strategy
      competing.lockedByIp = input.lockedByIp ?? competing.lockedByIp ?? null
      competing.lastHeartbeatAt = now
      competing.expiresAt = new Date(now.getTime() + settings.timeoutSeconds * 1000)
      competing.baseActionLogId = latest?.id ?? competing.baseActionLogId ?? null
      await this.em.flush()

      return {
        ok: true,
        enabled: settings.enabled,
        resourceEnabled: true,
        strategy: settings.strategy,
        allowForceUnlock: settings.allowForceUnlock,
        heartbeatSeconds: settings.heartbeatSeconds,
        acquired: false,
        latestActionLogId: latest?.id ?? null,
        lock: this.toLockView(competing, true),
      }
    }

    await emitRecordLocksEvent('record_locks.lock.acquired', {
      lockId: lock.id,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      tenantId: lock.tenantId,
      organizationId: lock.organizationId,
      lockedByUserId: lock.lockedByUserId,
      strategy: lock.strategy,
      baseActionLogId: lock.baseActionLogId,
    })

    return {
      ok: true,
      enabled: settings.enabled,
      resourceEnabled: true,
      strategy: settings.strategy,
      allowForceUnlock: settings.allowForceUnlock,
      heartbeatSeconds: settings.heartbeatSeconds,
      acquired: true,
      latestActionLogId: latest?.id ?? null,
      lock: this.toLockView(lock, true),
    }
  }

  async heartbeat(input: RecordLockHeartbeatInput): Promise<RecordLockHeartbeatResult> {
    const settings = await this.getSettings()
    const resourceEnabled = isRecordLockingEnabledForResource(settings, input.resourceKind)
    if (!resourceEnabled) return { ok: true, expiresAt: null }

    const lock = await this.findOwnedLockByToken(input)
    if (!lock) return { ok: true, expiresAt: null }

    const now = new Date()
    if (lock.expiresAt <= now) {
      this.markLockReleased(lock, {
        status: 'expired',
        reason: 'expired',
        releasedByUserId: lock.lockedByUserId,
        now,
      })
      await this.em.flush()
      return { ok: true, expiresAt: null }
    }

    lock.lastHeartbeatAt = now
    lock.expiresAt = new Date(now.getTime() + settings.timeoutSeconds * 1000)
    await this.em.flush()
    return { ok: true, expiresAt: normalizeDate(lock.expiresAt) }
  }

  async release(input: RecordLockReleaseInput): Promise<RecordLockReleaseResult> {
    const settings = await this.getSettings()
    const resourceEnabled = isRecordLockingEnabledForResource(settings, input.resourceKind)
    if (!resourceEnabled) return { ok: true, released: false, conflictResolved: false }

    let conflictResolved = false
    if (input.reason === 'conflict_resolved' && input.conflictId && input.resolution === 'accept_incoming') {
      const conflict = await this.findConflictById(input.conflictId, input)
      if (conflict && conflict.status === 'pending' && conflict.conflictActorUserId === input.userId) {
        await this.resolveConflict(conflict, input.resolution, input.userId)
        conflictResolved = true
      }
    }

    const lock = input.token
      ? await this.findOwnedLockByToken(input)
      : await this.findOwnedActiveLock(input)
    if (!lock) return { ok: true, released: false, conflictResolved }

    const now = new Date()
    this.markLockReleased(lock, {
      status: 'released',
      reason: input.reason ?? 'cancelled',
      releasedByUserId: input.userId,
      now,
    })
    await this.em.flush()

    await emitRecordLocksEvent('record_locks.lock.released', {
      lockId: lock.id,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      tenantId: lock.tenantId,
      organizationId: lock.organizationId,
      lockedByUserId: lock.lockedByUserId,
      releasedByUserId: input.userId,
      reason: lock.releaseReason,
    })

    return { ok: true, released: true, conflictResolved }
  }

  async forceRelease(input: RecordLockForceReleaseInput): Promise<RecordLockForceReleaseResult> {
    const settings = await this.getSettings()
    const resourceEnabled = isRecordLockingEnabledForResource(settings, input.resourceKind)
    if (!resourceEnabled || !settings.allowForceUnlock) {
      return { ok: true, released: false, lock: null }
    }

    const now = new Date()
    const lock = await this.findActiveLock(input, now)
    if (!lock) return { ok: true, released: false, lock: null }

    this.markLockReleased(lock, {
      status: 'force_released',
      reason: 'force',
      releasedByUserId: input.userId,
      now,
    })
    await this.em.flush()

    await emitRecordLocksEvent('record_locks.lock.force_released', {
      lockId: lock.id,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      tenantId: lock.tenantId,
      organizationId: lock.organizationId,
      lockedByUserId: lock.lockedByUserId,
      releasedByUserId: input.userId,
      reason: input.reason ?? null,
    })

    return { ok: true, released: true, lock: this.toLockView(lock, false) }
  }

  async validateMutation(input: RecordLockMutationValidationInput): Promise<RecordLockValidationResult> {
    this.scheduleCleanup(input.tenantId)
    const settings = await this.getSettings()
    const resourceEnabled = isRecordLockingEnabledForResource(settings, input.resourceKind)
    const canOverrideIncoming = await this.canUserOverrideIncoming(input, settings)

    if (!resourceEnabled) {
      return {
        ok: true,
        enabled: settings.enabled,
        resourceEnabled: false,
        strategy: settings.strategy,
        shouldReleaseOnSuccess: false,
        lock: null,
        latestActionLogId: null,
      }
    }

    const parsedHeaders = this.normalizeMutationHeaders(input.headers)
    const keepMineResolution = parsedHeaders.resolution === 'accept_mine' || parsedHeaders.resolution === 'merged'
      ? parsedHeaders.resolution
      : null
    const hasKeepMineIntent = keepMineResolution !== null
    const now = new Date()
    const active = await this.findActiveLock(input, now)
    const latest = await this.findLatestActionLogWithScopeFallback(input)
    const shouldReleaseOnSuccess = Boolean(
      active
      && active.lockedByUserId === input.userId
      && (!parsedHeaders.token || active.token === parsedHeaders.token),
    )

    if (settings.strategy === 'pessimistic') {
      if (active && active.lockedByUserId !== input.userId) {
        return {
          ok: false,
          status: 423,
          error: 'Record is currently locked by another user',
          code: 'record_locked',
          lock: this.toLockView(active, false),
        }
      }

      if (active && active.lockedByUserId === input.userId) {
        if (parsedHeaders.token && active.token !== parsedHeaders.token) {
          return {
            ok: false,
            status: 423,
            error: 'Valid lock token is required for this mutation',
            code: 'record_locked',
            lock: this.toLockView(active, false),
          }
        }
      }

      return {
        ok: true,
        enabled: settings.enabled,
        resourceEnabled: true,
        strategy: settings.strategy,
        shouldReleaseOnSuccess,
        lock: active ? this.toLockView(active, false) : null,
        latestActionLogId: latest?.id ?? null,
      }
    }

    const existingConflict = parsedHeaders.conflictId
      ? await this.findConflictById(parsedHeaders.conflictId, input)
      : null

    if (existingConflict) {
      const canResolveExistingConflict = existingConflict.status === 'pending'
        && existingConflict.conflictActorUserId === input.userId

      if (parsedHeaders.resolution === 'accept_mine' || parsedHeaders.resolution === 'merged') {
        const isAlreadyResolvedByRequester = existingConflict.conflictActorUserId === input.userId
          && existingConflict.status !== 'pending'
          && existingConflict.resolution === parsedHeaders.resolution

        if (!canResolveExistingConflict && !isAlreadyResolvedByRequester) {
          return {
            ok: false,
            status: 409,
            error: 'Record conflict requires resolution before saving',
            code: 'record_lock_conflict',
            lock: active ? this.toLockView(active, false) : null,
            conflict: await this.toConflictPayload(existingConflict, input.mutationPayload ?? null, settings.allowIncomingOverride, canOverrideIncoming),
          }
        }
        if (!canOverrideIncoming) {
          return {
            ok: false,
            status: 409,
            error: 'Record conflict requires resolution before saving',
            code: 'record_lock_conflict',
            lock: active ? this.toLockView(active, false) : null,
            conflict: await this.toConflictPayload(existingConflict, input.mutationPayload ?? null, settings.allowIncomingOverride, canOverrideIncoming),
          }
        }
        if (canResolveExistingConflict) {
          await this.resolveConflict(existingConflict, parsedHeaders.resolution, input.userId)
        }
      } else {
        return {
          ok: false,
          status: 409,
          error: 'Record conflict requires resolution before saving',
          code: 'record_lock_conflict',
          lock: active ? this.toLockView(active, false) : null,
          conflict: await this.toConflictPayload(existingConflict, input.mutationPayload ?? null, settings.allowIncomingOverride, canOverrideIncoming),
        }
      }
    }

    if (!existingConflict) {
      const baseActionLogId = parsedHeaders.baseLogId
        ?? (active && active.lockedByUserId === input.userId ? active.baseActionLogId : null)

      const hasConflictingBaseLog = Boolean(
        latest?.id
        && baseActionLogId
        && latest.id !== baseActionLogId
      )
      const hasConflictingWriteAfterLockStart = Boolean(
        latest?.id
        && !baseActionLogId
        && active
        && active.lockedByUserId === input.userId
        && latest.createdAt instanceof Date
        && active.lockedAt instanceof Date
        && latest.createdAt.getTime() > active.lockedAt.getTime()
        && latest.actorUserId !== input.userId
      )
      const isConflictingWrite = hasConflictingBaseLog || hasConflictingWriteAfterLockStart

      if (isConflictingWrite) {
        if (keepMineResolution && canOverrideIncoming) {
          const autoResolvedConflict = await this.createConflict({
            scope: input,
            baseActionLogId,
            incomingActionLogId: latest?.id ?? null,
            conflictActorUserId: input.userId,
            incomingActorUserId: latest?.actorUserId ?? null,
          })
          await this.resolveConflict(autoResolvedConflict, keepMineResolution, input.userId)

          return {
            ok: true,
            enabled: settings.enabled,
            resourceEnabled: true,
            strategy: settings.strategy,
            shouldReleaseOnSuccess,
            lock: active ? this.toLockView(active, false) : null,
            latestActionLogId: latest?.id ?? null,
          }
        }

        const conflict = await this.createConflict({
          scope: input,
          baseActionLogId,
          incomingActionLogId: latest?.id ?? null,
          conflictActorUserId: input.userId,
          incomingActorUserId: latest?.actorUserId ?? null,
        })

        return {
          ok: false,
          status: 409,
          error: 'Record conflict detected',
          code: 'record_lock_conflict',
          lock: active ? this.toLockView(active, false) : null,
          conflict: await this.toConflictPayload(conflict, input.mutationPayload ?? null, settings.allowIncomingOverride, canOverrideIncoming),
        }
      }
    }

    return {
      ok: true,
      enabled: settings.enabled,
      resourceEnabled: true,
      strategy: settings.strategy,
      shouldReleaseOnSuccess,
      lock: active ? this.toLockView(active, false) : null,
      latestActionLogId: latest?.id ?? null,
    }
  }

  async releaseAfterMutation(input: RecordLockReleaseInput): Promise<void> {
    const releaseResult = await this.release({
      ...input,
      reason: input.reason ?? 'saved',
    })
    if (!releaseResult.released) return
  }

  async emitIncomingChangesNotificationAfterMutation(input: {
    tenantId: string
    organizationId?: string | null
    userId: string
    resourceKind: string
    resourceId: string
    method: 'PUT' | 'DELETE'
  }): Promise<void> {
    if (input.method !== 'PUT') return
    const settings = await this.getSettings()
    if (!settings.notifyOnConflict || !isRecordLockingEnabledForResource(settings, input.resourceKind)) return

    const now = new Date()
    let candidateLocks = await this.em.find(RecordLock, {
      ...this.buildScopeWhere(input),
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      status: ACTIVE_LOCK_STATUS,
    }, { orderBy: { updatedAt: 'desc' } })
    if (!Array.isArray(candidateLocks) || candidateLocks.length === 0) {
      candidateLocks = await this.em.find(RecordLock, {
        tenantId: input.tenantId,
        deletedAt: null,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        status: ACTIVE_LOCK_STATUS,
      }, { orderBy: { updatedAt: 'desc' } })
    }
    const activeLocks = Array.isArray(candidateLocks) ? candidateLocks : []

    let hasExpiredLocks = false
    const recipientUserIds = new Set<string>()
    for (const lock of activeLocks) {
      if (lock.expiresAt <= now) {
        this.markLockReleased(lock, {
          status: 'expired',
          reason: 'expired',
          releasedByUserId: lock.lockedByUserId,
          now,
        })
        hasExpiredLocks = true
        continue
      }
      if (lock.lockedByUserId !== input.userId) {
        recipientUserIds.add(lock.lockedByUserId)
      }
    }
    if (hasExpiredLocks) await this.em.flush()
    if (!recipientUserIds.size) {
      const fallbackWindowMs = Math.max((settings.timeoutSeconds ?? 300) * 1000, 60_000)
      const fallbackSince = new Date(now.getTime() - fallbackWindowMs)
      const recentLocks = await this.em.find(RecordLock, {
        tenantId: input.tenantId,
        deletedAt: null,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        updatedAt: { $gte: fallbackSince },
      }, { orderBy: { updatedAt: 'desc' }, limit: 50 })

      for (const lock of (Array.isArray(recentLocks) ? recentLocks : [])) {
        if (lock.lockedByUserId !== input.userId) {
          recipientUserIds.add(lock.lockedByUserId)
        }
      }
    }
    if (!recipientUserIds.size) return

    let latest = await this.findLatestActionLog(input)
    if (!latest) {
      latest = await this.findLatestActionLog({
        tenantId: input.tenantId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
      })
    }
    let actorLog = latest?.actorUserId === input.userId
      ? latest
      : await this.findLatestActionLogByActor(input, input.userId)
    if (!actorLog) {
      actorLog = await this.findLatestActionLogByActor({
        tenantId: input.tenantId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
      }, input.userId)
    }
    const incomingLog = actorLog ?? latest

    const changedFields = incomingLog
      ? this.summarizeChangedFieldsFromActionLog(incomingLog)
      : ''

    await emitRecordLocksEvent('record_locks.incoming_changes.available', {
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      tenantId: input.tenantId,
      organizationId: normalizeScopeOrganization(input.organizationId),
      incomingActorUserId: input.userId,
      incomingActionLogId: incomingLog?.id ?? null,
      recipientUserIds: Array.from(recipientUserIds),
      changedFields: changedFields || '-',
    })
  }

  async resolveConflictById(input: {
    conflictId: string
    tenantId: string
    organizationId?: string | null
    userId: string
    resolution: 'accept_incoming' | 'accept_mine' | 'merged'
  }): Promise<boolean> {
    const settings = await this.getSettings()
    const canOverrideIncoming = await this.canUserOverrideIncoming(input, settings)
    const conflict = await this.em.findOne(RecordLockConflict, {
      id: input.conflictId,
      tenantId: input.tenantId,
      organizationId: normalizeScopeOrganization(input.organizationId),
      deletedAt: null,
    })
    if (!conflict || conflict.status !== 'pending' || conflict.conflictActorUserId !== input.userId) {
      return false
    }
    if ((input.resolution === 'accept_mine' || input.resolution === 'merged') && !canOverrideIncoming) {
      return false
    }
    await this.resolveConflict(conflict, input.resolution, input.userId)
    return true
  }

  private async canUserOverrideIncoming(
    input: Pick<RecordLockScope, 'tenantId' | 'organizationId' | 'userId'>,
    settings: RecordLockSettings,
  ): Promise<boolean> {
    if (!settings.allowIncomingOverride) return false
    if (!this.rbacService) return false

    try {
      return await this.rbacService.userHasAllFeatures(
        input.userId,
        ['record_locks.override_incoming'],
        {
          tenantId: input.tenantId,
          organizationId: normalizeScopeOrganization(input.organizationId),
        },
      )
    } catch {
      return false
    }
  }

  private scheduleCleanup(tenantId: string): void {
    const now = Date.now()
    const state = lockCleanupStateByTenant.get(tenantId) ?? { lastRunAt: 0, inFlight: false }
    if (state.inFlight) return
    if (now - state.lastRunAt < LOCK_CLEANUP_INTERVAL_MS) return

    state.inFlight = true
    state.lastRunAt = now
    lockCleanupStateByTenant.set(tenantId, state)

    void this.cleanupHistoricalRecords(tenantId).finally(() => {
      const current = lockCleanupStateByTenant.get(tenantId)
      if (!current) return
      current.inFlight = false
      lockCleanupStateByTenant.set(tenantId, current)
    })
  }

  private async cleanupHistoricalRecords(tenantId: string): Promise<void> {
    try {
      const knex = getKnex(this.em)
      const now = Date.now()
      const lockCutoff = new Date(now - LOCK_RETENTION_MS)
      const resolvedConflictCutoff = new Date(now - RESOLVED_CONFLICT_RETENTION_MS)
      const pendingConflictCutoff = new Date(now - PENDING_CONFLICT_RETENTION_MS)

      await knex('record_locks')
        .where({ tenant_id: tenantId })
        .whereNull('deleted_at')
        .whereNot('status', ACTIVE_LOCK_STATUS)
        .andWhere('updated_at', '<', lockCutoff)
        .delete()

      await knex('record_lock_conflicts')
        .where({ tenant_id: tenantId })
        .whereNull('deleted_at')
        .andWhere((query) => {
          query
            .where((pending) => {
              pending.where('status', 'pending').andWhere('created_at', '<', pendingConflictCutoff)
            })
            .orWhere((resolved) => {
              resolved.whereNot('status', 'pending').andWhere('updated_at', '<', resolvedConflictCutoff)
            })
        })
        .delete()
    } catch {
      // Best-effort cleanup must never fail lock workflows.
    }
  }

  private normalizeMutationHeaders(headers: Partial<RecordLockMutationHeaders>): Partial<RecordLockMutationHeaders> {
    const parsed = recordLockMutationHeaderSchema.partial().safeParse(headers)
    if (!parsed.success) return {}
    return parsed.data
  }

  private buildScopeWhere(scope: Pick<RecordLockScope, 'tenantId' | 'organizationId'>): {
    tenantId: string
    deletedAt: null
    organizationId?: string | null
  } {
    const where: {
      tenantId: string
      deletedAt: null
      organizationId?: string | null
    } = {
      tenantId: scope.tenantId,
      deletedAt: null,
    }

    if (scope.organizationId !== undefined) {
      where.organizationId = normalizeScopeOrganization(scope.organizationId)
    }

    return where
  }

  private async findActiveLock(
    input: Pick<RecordLockScope, 'tenantId' | 'organizationId'> & RecordLockResource,
    now: Date,
  ): Promise<RecordLock | null> {
    const where: FilterQuery<RecordLock> = {
      ...this.buildScopeWhere(input),
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      status: ACTIVE_LOCK_STATUS,
    }

    const locks = await this.em.find(RecordLock, where, { orderBy: { updatedAt: 'desc' } })
    if (!locks.length) return null

    let active: RecordLock | null = null
    let dirty = false

    for (const lock of locks) {
      if (lock.expiresAt <= now) {
        this.markLockReleased(lock, {
          status: 'expired',
          reason: 'expired',
          releasedByUserId: lock.lockedByUserId,
          now,
        })
        dirty = true
        continue
      }

      if (!active) {
        active = lock
      }
    }

    if (dirty) await this.em.flush()
    return active
  }

  private async findOwnedLockByToken(
    input: Pick<RecordLockScope, 'tenantId' | 'organizationId' | 'userId'> & RecordLockResource & { token?: string },
  ): Promise<RecordLock | null> {
    if (!input.token) return null

    const where: FilterQuery<RecordLock> = {
      ...this.buildScopeWhere(input),
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      token: input.token,
      lockedByUserId: input.userId,
      status: ACTIVE_LOCK_STATUS,
    }

    return this.em.findOne(RecordLock, where)
  }

  private async findOwnedActiveLock(
    input: Pick<RecordLockScope, 'tenantId' | 'organizationId' | 'userId'> & RecordLockResource,
  ): Promise<RecordLock | null> {
    const where: FilterQuery<RecordLock> = {
      ...this.buildScopeWhere(input),
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      lockedByUserId: input.userId,
      status: ACTIVE_LOCK_STATUS,
    }
    return this.em.findOne(RecordLock, where)
  }

  private markLockReleased(
    lock: RecordLock,
    params: {
      status: RecordLockStatus
      reason: RecordLockReleaseReason
      releasedByUserId: string
      now: Date
    },
  ) {
    lock.status = params.status
    lock.releaseReason = params.reason
    lock.releasedByUserId = params.releasedByUserId
    lock.releasedAt = params.now
    lock.updatedAt = params.now
  }

  private async findLatestActionLog(
    input: Pick<RecordLockScope, 'tenantId' | 'organizationId'> & RecordLockResource,
  ): Promise<ActionLog | null> {
    const where: FilterQuery<ActionLog> = {
      tenantId: input.tenantId,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      deletedAt: null,
    }

    if (input.organizationId !== undefined) {
      where.organizationId = normalizeScopeOrganization(input.organizationId)
    }

    return this.em.findOne(ActionLog, where, { orderBy: { createdAt: 'desc' } })
  }

  private async findLatestActionLogWithScopeFallback(
    input: Pick<RecordLockScope, 'tenantId' | 'organizationId'> & RecordLockResource,
  ): Promise<ActionLog | null> {
    const scoped = await this.findLatestActionLog(input)
    if (scoped) return scoped
    if (input.organizationId !== null) return null

    return this.findLatestActionLog({
      tenantId: input.tenantId,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
    })
  }

  private async findLatestActionLogByActor(
    input: Pick<RecordLockScope, 'tenantId' | 'organizationId'> & RecordLockResource,
    actorUserId: string,
  ): Promise<ActionLog | null> {
    const where: FilterQuery<ActionLog> = {
      tenantId: input.tenantId,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      actorUserId,
      deletedAt: null,
    }

    if (input.organizationId !== undefined) {
      where.organizationId = normalizeScopeOrganization(input.organizationId)
    }

    return this.em.findOne(ActionLog, where, { orderBy: { createdAt: 'desc' } })
  }

  private summarizeChangedFieldsFromActionLog(log: ActionLog | null): string {
    if (!log) return ''

    if (isRecordValue(log.changesJson)) {
      const fromChanges = Object.keys(log.changesJson)
        .filter((field) => !shouldSkipConflictField(field))
        .slice(0, 12)
        .map(formatChangedFieldLabel)
        .join(', ')
      if (fromChanges) return fromChanges
    }

    const before = isRecordValue(log.snapshotBefore) ? log.snapshotBefore : null
    const after = isRecordValue(log.snapshotAfter) ? log.snapshotAfter : null
    if (!before || !after) return ''

    const diffPaths = new Set<string>()
    this.collectSnapshotDiffPaths(before, after, null, diffPaths, new Set<unknown>())

    return Array.from(diffPaths)
      .filter((field) => !shouldSkipConflictField(field))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 12)
      .map(formatChangedFieldLabel)
      .join(', ')
  }

  private toLockView(lock: RecordLock, includeToken: boolean): RecordLockView {
    return {
      id: lock.id,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      token: includeToken ? lock.token : null,
      strategy: lock.strategy,
      status: lock.status,
      lockedByUserId: lock.lockedByUserId,
      lockedByIp: lock.lockedByIp ?? null,
      baseActionLogId: lock.baseActionLogId,
      lockedAt: normalizeDate(lock.lockedAt),
      lastHeartbeatAt: normalizeDate(lock.lastHeartbeatAt),
      expiresAt: normalizeDate(lock.expiresAt),
    }
  }

  private async createConflict(input: {
    scope: Pick<RecordLockScope, 'tenantId' | 'organizationId'> & RecordLockResource
    baseActionLogId: string | null
    incomingActionLogId: string | null
    conflictActorUserId: string
    incomingActorUserId: string | null
  }): Promise<RecordLockConflict> {
    const conflict = this.em.create(RecordLockConflict, {
      resourceKind: input.scope.resourceKind,
      resourceId: input.scope.resourceId,
      status: 'pending',
      resolution: null,
      baseActionLogId: input.baseActionLogId,
      incomingActionLogId: input.incomingActionLogId,
      conflictActorUserId: input.conflictActorUserId,
      incomingActorUserId: input.incomingActorUserId,
      tenantId: input.scope.tenantId,
      organizationId: normalizeScopeOrganization(input.scope.organizationId),
    })

    this.em.persist(conflict)
    await this.em.flush()

    await emitRecordLocksEvent('record_locks.conflict.detected', {
      conflictId: conflict.id,
      resourceKind: conflict.resourceKind,
      resourceId: conflict.resourceId,
      tenantId: conflict.tenantId,
      organizationId: conflict.organizationId,
      conflictActorUserId: conflict.conflictActorUserId,
      incomingActorUserId: conflict.incomingActorUserId,
      baseActionLogId: conflict.baseActionLogId,
      incomingActionLogId: conflict.incomingActionLogId,
    })

    return conflict
  }

  private async resolveConflict(
    conflict: RecordLockConflict,
    resolution: 'accept_incoming' | Extract<RecordLockMutationHeaders['resolution'], 'accept_mine' | 'merged'>,
    resolvedByUserId: string,
  ): Promise<void> {
    const now = new Date()

    const resolutionMap: Record<'accept_incoming' | Extract<RecordLockMutationHeaders['resolution'], 'accept_mine' | 'merged'>, {
      status: RecordLockConflictStatus
      resolution: RecordLockConflictResolution
    }> = {
      accept_incoming: { status: 'resolved_accept_incoming', resolution: 'accept_incoming' },
      accept_mine: { status: 'resolved_accept_mine', resolution: 'accept_mine' },
      merged: { status: 'resolved_merged', resolution: 'merged' },
    }

    const target = resolutionMap[resolution]
    conflict.status = target.status
    conflict.resolution = target.resolution
    conflict.resolvedByUserId = resolvedByUserId
    conflict.resolvedAt = now
    conflict.updatedAt = now
    await this.em.flush()

    await emitRecordLocksEvent('record_locks.conflict.resolved', {
      conflictId: conflict.id,
      resourceKind: conflict.resourceKind,
      resourceId: conflict.resourceId,
      tenantId: conflict.tenantId,
      organizationId: conflict.organizationId,
      conflictActorUserId: conflict.conflictActorUserId,
      incomingActorUserId: conflict.incomingActorUserId,
      resolution: conflict.resolution,
      resolvedByUserId,
    })
  }

  private async findConflictById(
    conflictId: string,
    scope: Pick<RecordLockScope, 'tenantId' | 'organizationId'> & RecordLockResource,
  ): Promise<RecordLockConflict | null> {
    const where: FilterQuery<RecordLockConflict> = {
      id: conflictId,
      tenantId: scope.tenantId,
      resourceKind: scope.resourceKind,
      resourceId: scope.resourceId,
      deletedAt: null,
    }

    if (scope.organizationId !== undefined) {
      where.organizationId = normalizeScopeOrganization(scope.organizationId)
    }

    const scoped = await this.em.findOne(RecordLockConflict, where)
    if (scoped || scope.organizationId === undefined) return scoped

    return this.em.findOne(RecordLockConflict, {
      id: conflictId,
      tenantId: scope.tenantId,
      resourceKind: scope.resourceKind,
      resourceId: scope.resourceId,
      deletedAt: null,
    })
  }

  private async findActionLogById(
    logId: string | null,
    scope: Pick<RecordLockScope, 'tenantId' | 'organizationId'> & RecordLockResource,
  ): Promise<ActionLog | null> {
    if (!logId) return null

    let resolved = this.actionLogService
      ? await this.actionLogService.findById(logId)
      : null
    if (!resolved) {
      resolved = await this.em.findOne(ActionLog, { id: logId, deletedAt: null })
    }
    if (!resolved || resolved.deletedAt) return null

    if (resolved.tenantId !== scope.tenantId) return null

    if (scope.organizationId !== undefined) {
      const expectedOrganizationId = normalizeScopeOrganization(scope.organizationId)
      if (normalizeScopeOrganization(resolved.organizationId) !== expectedOrganizationId) return null
    }

    if (resolved.resourceKind !== scope.resourceKind || resolved.resourceId !== scope.resourceId) {
      return null
    }

    return resolved
  }

  private collectSnapshotDiffPaths(
    before: unknown,
    after: unknown,
    pathPrefix: string | null,
    output: Set<string>,
    seen: Set<unknown>,
  ): void {
    if (valuesEqual(before, after)) return

    const beforeRecord = isRecordValue(before) ? before : null
    const afterRecord = isRecordValue(after) ? after : null

    if (!beforeRecord || !afterRecord) {
      if (pathPrefix) output.add(pathPrefix)
      return
    }

    if (seen.has(beforeRecord) || seen.has(afterRecord)) {
      if (pathPrefix) output.add(pathPrefix)
      return
    }

    seen.add(beforeRecord)
    seen.add(afterRecord)

    const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])
    for (const key of keys) {
      if (SKIPPED_CONFLICT_FIELDS.has(key)) continue
      const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key
      this.collectSnapshotDiffPaths(beforeRecord[key], afterRecord[key], nextPath, output, seen)
    }
  }

  private async buildConflictChanges(
    conflict: RecordLockConflict,
    mutationPayload: Record<string, unknown> | null,
  ): Promise<RecordLockConflictChange[]> {
    const scope = {
      tenantId: conflict.tenantId,
      organizationId: conflict.organizationId,
      resourceKind: conflict.resourceKind,
      resourceId: conflict.resourceId,
    }

    const baseLog = await this.findActionLogById(conflict.baseActionLogId, scope)
    const incomingLog = await this.findActionLogById(conflict.incomingActionLogId, scope)

    const baseSnapshot = isRecordValue(baseLog?.snapshotAfter) ? baseLog.snapshotAfter : null
    const incomingBeforeSnapshot = isRecordValue(incomingLog?.snapshotBefore) ? incomingLog.snapshotBefore : null
    const incomingAfterSnapshot = isRecordValue(incomingLog?.snapshotAfter) ? incomingLog.snapshotAfter : null
    const fallbackBaseSnapshot = baseSnapshot ?? incomingBeforeSnapshot

    const changeMap = new Map<string, { baseValue: unknown; incomingValue: unknown }>()

    const incomingChanges = isRecordValue(incomingLog?.changesJson) ? incomingLog.changesJson : null
    if (incomingChanges) {
      for (const [fieldPathRaw, rawChange] of Object.entries(incomingChanges)) {
        const fieldPath = fieldPathRaw.trim()
        if (shouldSkipConflictField(fieldPath)) continue

        const changeRecord = isRecordValue(rawChange) ? rawChange : null
        const fromValue = changeRecord && Object.prototype.hasOwnProperty.call(changeRecord, 'from')
          ? changeRecord.from
          : readPathValueLoose(fallbackBaseSnapshot, fieldPath)
        const toValue = changeRecord && Object.prototype.hasOwnProperty.call(changeRecord, 'to')
          ? changeRecord.to
          : readPathValueLoose(incomingAfterSnapshot, fieldPath)

        changeMap.set(fieldPath, {
          baseValue: fromValue === MISSING_CONFLICT_VALUE ? null : normalizeConflictValue(fromValue),
          incomingValue: toValue === MISSING_CONFLICT_VALUE ? null : normalizeConflictValue(toValue),
        })
      }
    }

    if (!changeMap.size && fallbackBaseSnapshot && incomingAfterSnapshot) {
      const diffPaths = new Set<string>()
      this.collectSnapshotDiffPaths(
        fallbackBaseSnapshot,
        incomingAfterSnapshot,
        null,
        diffPaths,
        new Set<unknown>(),
      )

      for (const fieldPath of diffPaths) {
        if (shouldSkipConflictField(fieldPath)) continue
        const fromValue = readPathValueLoose(fallbackBaseSnapshot, fieldPath)
        const toValue = readPathValueLoose(incomingAfterSnapshot, fieldPath)
        changeMap.set(fieldPath, {
          baseValue: fromValue === MISSING_CONFLICT_VALUE ? null : normalizeConflictValue(fromValue),
          incomingValue: toValue === MISSING_CONFLICT_VALUE ? null : normalizeConflictValue(toValue),
        })
      }
    }

    if (!changeMap.size && mutationPayload && incomingAfterSnapshot) {
      for (const fieldPath of Object.keys(mutationPayload)) {
        if (shouldSkipConflictField(fieldPath)) continue
        const mineValue = readPathValueLoose(mutationPayload, fieldPath)
        const incomingValue = readPathValueLoose(incomingAfterSnapshot, fieldPath)
        if (mineValue === MISSING_CONFLICT_VALUE || incomingValue === MISSING_CONFLICT_VALUE) continue
        if (valuesEqual(mineValue, incomingValue)) continue
        const baseValue = readPathValueLoose(fallbackBaseSnapshot, fieldPath)
        changeMap.set(fieldPath, {
          baseValue: baseValue === MISSING_CONFLICT_VALUE ? null : normalizeConflictValue(baseValue),
          incomingValue: normalizeConflictValue(incomingValue),
        })
      }
    }

    if (!changeMap.size) return []

    const allFields = Array.from(changeMap.keys())
    const preferredFields = mutationPayload
      ? allFields.filter((fieldPath) => {
          const mineValue = readPathValueLoose(mutationPayload, fieldPath)
          if (mineValue === MISSING_CONFLICT_VALUE) return false
          const incomingValue = changeMap.get(fieldPath)?.incomingValue
          return !valuesEqual(mineValue, incomingValue)
        })
      : []
    const selectedFields = (preferredFields.length ? preferredFields : allFields)
      .filter((fieldPath) => !shouldSkipConflictField(fieldPath))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 25)

    return selectedFields.map((fieldPath) => {
      const entry = changeMap.get(fieldPath) ?? { baseValue: null, incomingValue: null }
      const mineValueRaw = mutationPayload ? readPathValueLoose(mutationPayload, fieldPath) : MISSING_CONFLICT_VALUE
      const mineValue = mineValueRaw === MISSING_CONFLICT_VALUE
        ? entry.baseValue
        : normalizeConflictValue(mineValueRaw)

      return {
        field: fieldPath,
        displayValue: normalizeConflictValue(entry.baseValue),
        baseValue: normalizeConflictValue(entry.baseValue),
        incomingValue: normalizeConflictValue(entry.incomingValue),
        mineValue: normalizeConflictValue(mineValue),
      }
    })
  }

  private async toConflictPayload(
    conflict: RecordLockConflict,
    mutationPayload: Record<string, unknown> | null,
    allowIncomingOverride: boolean,
    canOverrideIncoming: boolean,
  ): Promise<RecordLockConflictPayload> {
    const changes = await this.buildConflictChanges(conflict, mutationPayload)
    return {
      id: conflict.id,
      resourceKind: conflict.resourceKind,
      resourceId: conflict.resourceId,
      baseActionLogId: conflict.baseActionLogId,
      incomingActionLogId: conflict.incomingActionLogId,
      allowIncomingOverride,
      canOverrideIncoming,
      resolutionOptions: canOverrideIncoming ? ['accept_mine'] : [],
      changes,
    }
  }
}

export function createRecordLockService(deps: RecordLockServiceDeps): RecordLockService {
  return new RecordLockService(deps)
}
