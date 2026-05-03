import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Material, MaterialLifecycleEvent } from '../data/entities'
import {
  lifecycleTransitionSchema,
  MATERIAL_LIFECYCLE_TRANSITIONS,
  type LifecycleTransitionInput,
} from '../data/validators'

/**
 * Material lifecycle transitions (Phase 1 Step 10).
 *
 * State machine — only allowed transitions per spec:
 *   draft → active
 *   active → phase_out
 *   phase_out → obsolete
 *   phase_out → active        (reverse — only this one)
 *   obsolete → (nothing — terminal)
 *
 * Mutations performed in a single command:
 *  1. Append a MaterialLifecycleEvent row (audit log, append-only).
 *  2. Update Material.lifecycle_state to to_state.
 *  3. If to_state === 'obsolete', set Material.replacement_material_id to the optional pointer.
 *  4. Emit `materials.material.lifecycle_changed` with the from/to + replacement payload.
 *
 * Undo restores the prior lifecycle_state + replacement pointer AND deletes the audit event.
 * Audit append-only is a domain rule on the API layer; undo is the audit log's
 * own bypass valve. The lifecycle_changed event is re-emitted with reversed states so any
 * downstream subscribers can observe the rollback.
 */

type LifecycleSnapshot = {
  materialId: string
  organizationId: string
  tenantId: string
  beforeState: string
  beforeReplacementMaterialId: string | null
}

type LifecycleResult = {
  materialId: string
  eventId: string
  fromState: string
  toState: string
}

type LifecycleUndoPayload = {
  before: LifecycleSnapshot
  eventId: string
  toState: string
  replacementMaterialId: string | null
  reason: string | null
}

const lifecycleCommand: CommandHandler<LifecycleTransitionInput, LifecycleResult> = {
  id: 'materials.material.lifecycle_change',
  async prepare(rawInput, ctx) {
    const parsed = lifecycleTransitionSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const material = await em.findOne(Material, { id: parsed.materialId, deletedAt: null })
    if (!material) return {}
    return {
      before: {
        materialId: material.id,
        organizationId: material.organizationId,
        tenantId: material.tenantId,
        beforeState: material.lifecycleState,
        beforeReplacementMaterialId: material.replacementMaterialId ?? null,
      } satisfies LifecycleSnapshot,
    }
  },
  async execute(rawInput, ctx) {
    const parsed = lifecycleTransitionSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const material = await em.findOne(Material, { id: parsed.materialId, deletedAt: null })
    if (!material) {
      throw new CrudHttpError(404, {
        error: translate('materials.material.errors.not_found', 'Material not found'),
      })
    }
    if (material.organizationId !== parsed.organizationId || material.tenantId !== parsed.tenantId) {
      throw new CrudHttpError(403, {
        error: translate('materials.errors.cross_org_forbidden', 'Material belongs to a different organization'),
      })
    }

    const fromState = material.lifecycleState
    const toState = parsed.toState

    // No-op (same state) is rejected — caller should treat 200 vs 204 explicitly elsewhere.
    if (fromState === toState) {
      throw new CrudHttpError(409, {
        error: translate(
          'materials.lifecycle.errors.no_op',
          'Material is already in the requested lifecycle state',
        ),
      })
    }
    const allowed = MATERIAL_LIFECYCLE_TRANSITIONS[fromState] ?? []
    if (!allowed.includes(toState)) {
      throw new CrudHttpError(409, {
        error: translate(
          'materials.lifecycle.errors.invalid_transition',
          'Invalid lifecycle transition',
        ),
        details: { fromState, toState, allowed },
      })
    }

    // Replacement pointer is only meaningful when transitioning to obsolete; in any other
    // case ignore whatever the client supplied and clear the master's pointer.
    const replacementId = toState === 'obsolete' ? parsed.replacementMaterialId ?? null : null
    if (replacementId) {
      // Replacement must exist in same scope (cross-org would leak data).
      const replacement = await em.findOne(Material, { id: replacementId, deletedAt: null })
      if (
        !replacement ||
        replacement.organizationId !== material.organizationId ||
        replacement.tenantId !== material.tenantId
      ) {
        throw new CrudHttpError(422, {
          error: translate(
            'materials.lifecycle.errors.replacement_invalid',
            'Replacement material is not available in this organization',
          ),
        })
      }
      if (replacement.id === material.id) {
        throw new CrudHttpError(422, {
          error: translate(
            'materials.lifecycle.errors.replacement_self',
            'Material cannot replace itself',
          ),
        })
      }
    }

    const changedAt = new Date()
    const auditEvent = em.create(MaterialLifecycleEvent, {
      organizationId: material.organizationId,
      tenantId: material.tenantId,
      materialId: material.id,
      fromState,
      toState,
      changedByUserId: ctx.auth?.sub ?? null,
      reason: parsed.reason ?? null,
      replacementMaterialId: replacementId,
      changedAt,
    })
    em.persist(auditEvent)

    material.lifecycleState = toState
    material.replacementMaterialId = replacementId

    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const eventBus = ctx.container.resolve('eventBus') as
      | { emitEvent: (event: string, payload: unknown, options?: { persistent?: boolean }) => Promise<void> }
      | undefined
    if (eventBus) {
      await eventBus
        .emitEvent(
          'materials.material.lifecycle_changed',
          {
            id: material.id,
            fromState,
            toState,
            replacementMaterialId: replacementId,
            reason: parsed.reason ?? null,
            organizationId: material.organizationId,
            tenantId: material.tenantId,
          },
          { persistent: true },
        )
        .catch(() => undefined)
    }
    void dataEngine

    return {
      materialId: material.id,
      eventId: auditEvent.id,
      fromState,
      toState,
    }
  },
  buildLog: async ({ snapshots, result }) => {
    const before = snapshots.before as LifecycleSnapshot | undefined
    if (!before || !result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('materials.audit.lifecycle.change', 'Change material lifecycle state'),
      resourceKind: 'materials.material',
      resourceId: result.materialId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: { lifecycleState: before.beforeState },
      snapshotAfter: { lifecycleState: result.toState },
      changes: { lifecycleState: { before: before.beforeState, after: result.toState } },
      payload: {
        undo: {
          before,
          eventId: result.eventId,
          toState: result.toState,
          replacementMaterialId: null,
          reason: null,
        } satisfies LifecycleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LifecycleUndoPayload>(logEntry)
    if (!payload?.before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const material = await em.findOne(Material, { id: payload.before.materialId })
    if (material) {
      material.lifecycleState = payload.before.beforeState as Material['lifecycleState']
      material.replacementMaterialId = payload.before.beforeReplacementMaterialId
    }
    if (payload.eventId) {
      const event = await em.findOne(MaterialLifecycleEvent, { id: payload.eventId })
      if (event) em.remove(event)
    }
    await em.flush()

    const eventBus = ctx.container.resolve('eventBus') as
      | { emitEvent: (event: string, payload: unknown, options?: { persistent?: boolean }) => Promise<void> }
      | undefined
    if (eventBus && material) {
      await eventBus
        .emitEvent(
          'materials.material.lifecycle_changed',
          {
            id: material.id,
            fromState: payload.toState,
            toState: payload.before.beforeState,
            replacementMaterialId: payload.before.beforeReplacementMaterialId,
            reason: 'undo',
            organizationId: material.organizationId,
            tenantId: material.tenantId,
          },
          { persistent: true },
        )
        .catch(() => undefined)
    }
  },
}

registerCommand(lifecycleCommand)
