import type { EntityManager } from '@mikro-orm/postgresql'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import { AiPendingAction } from '../entities'
import {
  AI_PENDING_ACTION_ALLOWED_TRANSITIONS,
  AiPendingActionStateError,
  resolveAiPendingActionTtlSeconds,
  type AiPendingActionExecutionResult,
  type AiPendingActionFailedRecord,
  type AiPendingActionFieldDiff,
  type AiPendingActionQueueMode,
  type AiPendingActionRecordDiff,
  type AiPendingActionStatus,
} from '../../lib/pending-action-types'

export interface AiPendingActionContext {
  tenantId: string
  organizationId?: string | null
  userId?: string | null
}

export interface AiPendingActionCreateInput {
  agentId: string
  toolName: string
  idempotencyKey: string
  createdByUserId: string
  normalizedInput: Record<string, unknown>
  conversationId?: string | null
  targetEntityType?: string | null
  targetRecordId?: string | null
  fieldDiff?: AiPendingActionFieldDiff[]
  records?: AiPendingActionRecordDiff[] | null
  sideEffectsSummary?: string | null
  recordVersion?: string | null
  attachmentIds?: string[]
  queueMode?: AiPendingActionQueueMode
  /** Optional explicit TTL in seconds; overrides the env/default TTL. */
  ttlSeconds?: number
  /** Optional explicit `now` for deterministic tests. */
  now?: Date
}

export interface AiPendingActionSetStatusExtra {
  resolvedByUserId?: string | null
  executionResult?: AiPendingActionExecutionResult | null
  failedRecords?: AiPendingActionFailedRecord[] | null
  /** Optional explicit `now` for deterministic tests. */
  now?: Date
}

/**
 * Persistent store for the Phase 3 WS-C mutation approval gate (Step 5.5).
 *
 * Responsibilities:
 * - Create new pending rows with a TTL-derived `expiresAt`, honoring
 *   idempotency within the window (same `idempotencyKey` returns the same
 *   row as long as it is still `pending`; any terminal state mints a new row).
 * - Tenant-scoped lookups for the confirm/cancel/reconnect routes and the
 *   in-app UI's "open actions" list.
 * - State-machine enforcement: `setStatus` rejects illegal transitions via
 *   {@link AiPendingActionStateError}. The runtime callers translate this
 *   to a 409 Conflict response.
 * - `listExpired` for the cleanup worker (Step 5.12).
 *
 * Every read goes through `findOneWithDecryption` / `findWithDecryption`
 * even though today no column is GDPR-flagged. This keeps the repo
 * consistent with the rest of the module and preps for a future encrypted
 * `normalizedInput` without a second refactor.
 */
export class AiPendingActionRepository {
  constructor(private readonly em: EntityManager) {}

  async create(
    input: AiPendingActionCreateInput,
    ctx: AiPendingActionContext,
  ): Promise<AiPendingAction> {
    if (!ctx?.tenantId) {
      throw new Error('AiPendingActionRepository.create requires tenantId')
    }
    if (!input?.agentId) {
      throw new Error('AiPendingActionRepository.create requires agentId')
    }
    if (!input?.toolName) {
      throw new Error('AiPendingActionRepository.create requires toolName')
    }
    if (!input?.idempotencyKey) {
      throw new Error(
        'AiPendingActionRepository.create requires idempotencyKey',
      )
    }
    if (!input?.createdByUserId) {
      throw new Error(
        'AiPendingActionRepository.create requires createdByUserId',
      )
    }

    const now = input.now ?? new Date()
    const ttlSeconds = Math.max(
      1,
      Math.floor(
        typeof input.ttlSeconds === 'number' && Number.isFinite(input.ttlSeconds)
          ? input.ttlSeconds
          : resolveAiPendingActionTtlSeconds(),
      ),
    )
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)

    return this.em.transactional(async (tx) => {
      const existing = await findOneWithDecryption<AiPendingAction>(
        tx as unknown as EntityManager,
        AiPendingAction,
        {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId ?? null,
          idempotencyKey: input.idempotencyKey,
        } as any,
        { orderBy: { createdAt: 'desc' } as any },
        {
          tenantId: ctx.tenantId ?? null,
          organizationId: ctx.organizationId ?? null,
        },
      )
      if (existing && existing.status === 'pending') {
        return existing
      }
      const row = tx.create(AiPendingAction, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        agentId: input.agentId,
        toolName: input.toolName,
        conversationId: input.conversationId ?? null,
        targetEntityType: input.targetEntityType ?? null,
        targetRecordId: input.targetRecordId ?? null,
        normalizedInput: input.normalizedInput ?? {},
        fieldDiff: Array.isArray(input.fieldDiff) ? input.fieldDiff : [],
        records: normalizeRecords(input.records),
        failedRecords: null,
        sideEffectsSummary: input.sideEffectsSummary ?? null,
        recordVersion: input.recordVersion ?? null,
        attachmentIds: Array.isArray(input.attachmentIds)
          ? input.attachmentIds
          : [],
        idempotencyKey: input.idempotencyKey,
        createdByUserId: input.createdByUserId,
        status: 'pending' as AiPendingActionStatus,
        queueMode: (input.queueMode ?? 'inline') as AiPendingActionQueueMode,
        executionResult: null,
        createdAt: now,
        expiresAt,
        resolvedAt: null,
        resolvedByUserId: null,
      } as unknown as AiPendingAction)
      await tx.persistAndFlush(row)
      return row
    })
  }

  async getById(
    id: string,
    ctx: AiPendingActionContext,
  ): Promise<AiPendingAction | null> {
    if (!id || !ctx?.tenantId) return null
    const row = await findOneWithDecryption<AiPendingAction>(
      this.em,
      AiPendingAction,
      {
        id,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
      } as any,
      {},
      {
        tenantId: ctx.tenantId ?? null,
        organizationId: ctx.organizationId ?? null,
      },
    )
    return row ?? null
  }

  async listPendingForAgent(
    agentId: string,
    ctx: AiPendingActionContext,
    limit: number = 50,
  ): Promise<AiPendingAction[]> {
    if (!agentId || !ctx?.tenantId) return []
    const capped = Math.max(1, Math.min(Math.floor(limit), 200))
    const rows = await findWithDecryption<AiPendingAction>(
      this.em,
      AiPendingAction,
      {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        agentId,
        status: 'pending',
      } as any,
      {
        orderBy: { createdAt: 'desc' } as any,
        limit: capped,
      },
      {
        tenantId: ctx.tenantId ?? null,
        organizationId: ctx.organizationId ?? null,
      },
    )
    return rows
  }

  async setStatus(
    id: string,
    nextStatus: AiPendingActionStatus,
    ctx: AiPendingActionContext,
    extra?: AiPendingActionSetStatusExtra,
  ): Promise<AiPendingAction> {
    if (!ctx?.tenantId) {
      throw new Error('AiPendingActionRepository.setStatus requires tenantId')
    }
    if (!id) {
      throw new Error('AiPendingActionRepository.setStatus requires id')
    }
    return this.em.transactional(async (tx) => {
      const existing = await findOneWithDecryption<AiPendingAction>(
        tx as unknown as EntityManager,
        AiPendingAction,
        {
          id,
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId ?? null,
        } as any,
        {},
        {
          tenantId: ctx.tenantId ?? null,
          organizationId: ctx.organizationId ?? null,
        },
      )
      if (!existing) {
        throw new Error(`AiPendingAction not found: ${id}`)
      }
      if (existing.status === nextStatus) {
        return existing
      }
      const allowed = AI_PENDING_ACTION_ALLOWED_TRANSITIONS[existing.status] ?? []
      if (!allowed.includes(nextStatus)) {
        throw new AiPendingActionStateError(existing.status, nextStatus)
      }
      const now = extra?.now ?? new Date()
      existing.status = nextStatus
      if (
        nextStatus === 'confirmed' ||
        nextStatus === 'cancelled' ||
        nextStatus === 'expired' ||
        nextStatus === 'failed'
      ) {
        existing.resolvedAt = existing.resolvedAt ?? now
        if (extra && Object.prototype.hasOwnProperty.call(extra, 'resolvedByUserId')) {
          existing.resolvedByUserId = extra.resolvedByUserId ?? null
        } else if (nextStatus === 'expired') {
          existing.resolvedByUserId = null
        }
      }
      if (extra && Object.prototype.hasOwnProperty.call(extra, 'executionResult')) {
        existing.executionResult = extra.executionResult ?? null
      }
      if (extra && Object.prototype.hasOwnProperty.call(extra, 'failedRecords')) {
        existing.failedRecords = normalizeFailedRecords(extra.failedRecords)
      }
      await tx.persistAndFlush(existing)
      return existing
    })
  }

  async listExpired(
    ctx: AiPendingActionContext,
    now: Date,
    limit: number = 100,
  ): Promise<AiPendingAction[]> {
    if (!ctx?.tenantId) return []
    const capped = Math.max(1, Math.min(Math.floor(limit), 500))
    const rows = await findWithDecryption<AiPendingAction>(
      this.em,
      AiPendingAction,
      {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        status: 'pending',
        expiresAt: { $lt: now } as any,
      } as any,
      {
        orderBy: { expiresAt: 'asc' } as any,
        limit: capped,
      },
      {
        tenantId: ctx.tenantId ?? null,
        organizationId: ctx.organizationId ?? null,
      },
    )
    return rows
  }
}

function normalizeRecords(
  records: AiPendingActionRecordDiff[] | null | undefined,
): AiPendingActionRecordDiff[] | null {
  if (!Array.isArray(records) || records.length === 0) return null
  return records
}

function normalizeFailedRecords(
  failed: AiPendingActionFailedRecord[] | null | undefined,
): AiPendingActionFailedRecord[] | null {
  if (!Array.isArray(failed) || failed.length === 0) return null
  return failed
}

export default AiPendingActionRepository
