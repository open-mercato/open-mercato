import { randomUUID } from 'crypto'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
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

export type RecordLockScope = {
  tenantId: string
  organizationId?: string | null
  userId: string
}

export type RecordLockResource = {
  resourceKind: string
  resourceId: string
}

export type RecordLockAcquireInput = RecordLockScope & RecordLockResource

export type RecordLockHeartbeatInput = RecordLockScope & RecordLockResource & {
  token: string
}

export type RecordLockReleaseInput = RecordLockScope & RecordLockResource & {
  token: string
  reason?: Exclude<RecordLockReleaseReason, 'expired' | 'force'>
}

export type RecordLockForceReleaseInput = RecordLockScope & RecordLockResource & {
  reason?: string | null
}

export type RecordLockMutationValidationInput = RecordLockScope & RecordLockResource & {
  method: 'PUT' | 'DELETE'
  headers: Partial<RecordLockMutationHeaders>
}

export type RecordLockConflictPayload = {
  id: string
  resourceKind: string
  resourceId: string
  baseActionLogId: string | null
  incomingActionLogId: string | null
  resolutionOptions: Array<'accept_incoming' | 'accept_mine' | 'merged'>
}

export type RecordLockView = {
  id: string
  resourceKind: string
  resourceId: string
  token: string | null
  strategy: RecordLockStrategy
  status: RecordLockStatus
  lockedByUserId: string
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
  heartbeatSeconds: number
  acquired: boolean
  latestActionLogId: string | null
  lock: RecordLockView | null
}

export type RecordLockHeartbeatResult = {
  ok: true
  expiresAt: string | null
}

export type RecordLockReleaseResult = {
  ok: true
  released: boolean
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

  constructor(deps: RecordLockServiceDeps) {
    this.em = deps.em
    this.moduleConfigService = deps.moduleConfigService ?? null
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

  async acquire(input: RecordLockAcquireInput): Promise<RecordLockAcquireResult | RecordLockValidationFailure> {
    const settings = await this.getSettings()
    const latest = await this.findLatestActionLog(input)
    const resourceEnabled = isRecordLockingEnabledForResource(settings, input.resourceKind)

    if (!resourceEnabled) {
      return {
        ok: true,
        enabled: settings.enabled,
        resourceEnabled: false,
        strategy: settings.strategy,
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
      if (settings.strategy === 'pessimistic') {
        return {
          ok: false,
          status: 423,
          error: 'Record is currently locked by another user',
          code: 'record_locked',
          lock,
        }
      }

      return {
        ok: true,
        enabled: settings.enabled,
        resourceEnabled: true,
        strategy: settings.strategy,
        heartbeatSeconds: settings.heartbeatSeconds,
        acquired: false,
        latestActionLogId: latest?.id ?? null,
        lock,
      }
    }

    if (active && active.lockedByUserId === input.userId) {
      active.strategy = settings.strategy
      active.lastHeartbeatAt = now
      active.expiresAt = new Date(now.getTime() + settings.timeoutSeconds * 1000)
      active.baseActionLogId = latest?.id ?? active.baseActionLogId ?? null
      await this.em.flush()

      return {
        ok: true,
        enabled: settings.enabled,
        resourceEnabled: true,
        strategy: settings.strategy,
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
      baseActionLogId: latest?.id ?? null,
      lockedAt: now,
      lastHeartbeatAt: now,
      expiresAt: new Date(now.getTime() + settings.timeoutSeconds * 1000),
      tenantId: input.tenantId,
      organizationId: normalizeScopeOrganization(input.organizationId),
    })

    this.em.persist(lock)
    await this.em.flush()

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
    if (!resourceEnabled) return { ok: true, released: false }

    const lock = await this.findOwnedLockByToken(input)
    if (!lock) return { ok: true, released: false }

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

    return { ok: true, released: true }
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
    const settings = await this.getSettings()
    const resourceEnabled = isRecordLockingEnabledForResource(settings, input.resourceKind)

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
    const now = new Date()
    const active = await this.findActiveLock(input, now)
    const latest = await this.findLatestActionLog(input)
    const shouldReleaseOnSuccess = Boolean(
      active
      && active.lockedByUserId === input.userId
      && parsedHeaders.token
      && active.token === parsedHeaders.token,
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
        if (!parsedHeaders.token || active.token !== parsedHeaders.token) {
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
      if (parsedHeaders.resolution === 'accept_mine' || parsedHeaders.resolution === 'merged') {
        await this.resolveConflict(existingConflict, parsedHeaders.resolution, input.userId)
      } else {
        return {
          ok: false,
          status: 409,
          error: 'Record conflict requires resolution before saving',
          code: 'record_lock_conflict',
          lock: active ? this.toLockView(active, false) : null,
          conflict: this.toConflictPayload(existingConflict),
        }
      }
    }

    if (parsedHeaders.resolution === 'normal') {
      const baseActionLogId = parsedHeaders.baseLogId
        ?? (active && active.lockedByUserId === input.userId ? active.baseActionLogId : null)

      const isConflictingWrite = Boolean(
        latest?.id
        && baseActionLogId
        && latest.id !== baseActionLogId
        && latest.actorUserId
        && latest.actorUserId !== input.userId,
      )

      if (isConflictingWrite) {
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
          conflict: this.toConflictPayload(conflict),
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
    input: Pick<RecordLockScope, 'tenantId' | 'organizationId' | 'userId'> & RecordLockResource & { token: string },
  ): Promise<RecordLock | null> {
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

  private toLockView(lock: RecordLock, includeToken: boolean): RecordLockView {
    return {
      id: lock.id,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      token: includeToken ? lock.token : null,
      strategy: lock.strategy,
      status: lock.status,
      lockedByUserId: lock.lockedByUserId,
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
    resolution: Extract<RecordLockMutationHeaders['resolution'], 'accept_mine' | 'merged'>,
    resolvedByUserId: string,
  ): Promise<void> {
    const now = new Date()

    const resolutionMap: Record<Extract<RecordLockMutationHeaders['resolution'], 'accept_mine' | 'merged'>, {
      status: RecordLockConflictStatus
      resolution: RecordLockConflictResolution
    }> = {
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

    return this.em.findOne(RecordLockConflict, where)
  }

  private toConflictPayload(conflict: RecordLockConflict): RecordLockConflictPayload {
    return {
      id: conflict.id,
      resourceKind: conflict.resourceKind,
      resourceId: conflict.resourceId,
      baseActionLogId: conflict.baseActionLogId,
      incomingActionLogId: conflict.incomingActionLogId,
      resolutionOptions: ['accept_incoming', 'accept_mine', 'merged'],
    }
  }
}

export function createRecordLockService(deps: RecordLockServiceDeps): RecordLockService {
  return new RecordLockService(deps)
}
