import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import {
  Code,
  GeneratedCode,
  type PromotionCodeType,
  type PromotionCodeUsageMode,
} from '../data/entities'
import { assertPromotionScopeOrNotFound } from './shared'
import {
  codeReservationReleaseSchema,
  codeReserveInputSchema,
  codeUseInputSchema,
  revertCodeUseInputSchema,
  promotionCodeCreateSchema,
  promotionCodeUpdateSchema,
  promotionCodeDeleteSchema,
  type PromotionCodeCreateInput,
  type PromotionCodeUpdateInput,
  type PromotionCodeDeleteInput,
} from '../data/validators'
import { PromotionCodeService, type PromotionsCodeScope } from '../lib/code-service'
import type { PromotionCodeGenerationService } from '../services/code-generation'
import type { CodeReservationResult, CodeUseResult, RevertCodeUseResult } from '../lib/types'

const codesLogger = createLogger('promotions').child({ component: 'code-commands' })

// SPEC-055 §Amendment A.2a: `reserveCode`, `releaseCode` and `useCode` are "financially
// or budget consequential writes" and go through the command pattern the same as
// `Promotion`/`Code` CRUD. `validateCode`/`extendReservation` are deliberately NOT here
// — §A.2a names exactly five commands for the whole of Phase 3
// (`reserve`/`release`/`use`/`usage.register`/`usage.revert`; the last two are Step
// 6.3's), and the spec explicitly calls `validateCode`/`extendReservation` plain
// reads/housekeeping with no mutation to command-wrap.
//
// Each command wraps `lib/code-service.ts`'s `PromotionCodeService` — the actual
// resolution/locking/transaction logic lives there (§Code Lifecycle,
// §Promotion Usage Lifecycle's row-lock correction applied to `codes/use`); this file
// only resolves the command-runtime scope/EntityManager and dispatches to it, same split
// as `commands/promotions.ts`'s thin command bodies around `data/validators.ts` schemas.

// Mirrors `commands/promotions.ts`'s `resolveActorScope` — a code operation's
// tenant/organization scope is always the caller's own actor scope (never a
// client-supplied value), resolved from `ctx.auth`/`ctx.selectedOrganizationId`.
function resolveActorScope(ctx: CommandRuntimeContext): PromotionsCodeScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, {
      error: '[internal] Tenant and organization scope are required for a promotion code operation',
    })
  }
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  return { tenantId, organizationId }
}

// `ctx.transactionalEm`, when set, is an already-open (possibly ambient — e.g.
// `checkout`'s own) transaction this command MUST reuse rather than opening its own
// (§Promotion Usage Lifecycle's row-lock correction depends on this for `codes/use`:
// locking inside the SAME transaction as the caller is what makes the lock effective
// whether the call is top-level or nested). Otherwise fork the request `em`, same
// precedent as every other command in this module.
function resolveCommandEm(ctx: CommandRuntimeContext): EntityManager {
  return ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
}

function resolveCodeService(ctx: CommandRuntimeContext): PromotionCodeService {
  return ctx.container.resolve('promotionCodeService') as PromotionCodeService
}

const reserveCodeCommand: CommandHandler<unknown, CodeReservationResult> = {
  id: 'promotions.code.reserve',
  async execute(rawInput, ctx) {
    const parsed = codeReserveInputSchema.parse(rawInput)
    const scope = resolveActorScope(ctx)
    const em = resolveCommandEm(ctx)
    return resolveCodeService(ctx).reserveCode(em, parsed, scope)
  },
}

const releaseCodeCommand: CommandHandler<unknown, { ok: true }> = {
  id: 'promotions.code.release',
  async execute(rawInput, ctx) {
    const parsed = codeReservationReleaseSchema.parse(rawInput)
    const scope = resolveActorScope(ctx)
    const em = resolveCommandEm(ctx)
    await resolveCodeService(ctx).releaseCode(em, parsed.codeId, parsed.cartId, scope)
    return { ok: true }
  },
}

const useCodeCommand: CommandHandler<unknown, CodeUseResult> = {
  id: 'promotions.code.use',
  async execute(rawInput, ctx) {
    const parsed = codeUseInputSchema.parse(rawInput)
    const scope = resolveActorScope(ctx)
    const em = resolveCommandEm(ctx)
    return resolveCodeService(ctx).useCode(em, parsed, scope)
  },
}

// Release 5 C5/SPEC-055 amendment: a sixth command, additive to §A.2a's own five — the
// reversal counterpart of `useCode` above, "financially or budget consequential" for
// the same reason (reactivates a code, decrements a usage counter). Wraps
// `PromotionCodeService.revertCodeUse` the same thin way every command in this file
// wraps its service method.
const revertCodeUseCommand: CommandHandler<unknown, RevertCodeUseResult> = {
  id: 'promotions.code.use.revert',
  async execute(rawInput, ctx) {
    const parsed = revertCodeUseInputSchema.parse(rawInput)
    const scope = resolveActorScope(ctx)
    const em = resolveCommandEm(ctx)
    return resolveCodeService(ctx).revertCodeUse(em, parsed, scope)
  },
}

// ---------------------------------------------------------------------------
// Code CRUD (§Implementation Plan Phase 3 Step 3 "commands/codes.ts — code CRUD with
// undo, events" — not built by Step 6.2, which only covered the reserve/release/use
// commands above; Release 4 PLAN.md Step 6.4 closes that gap since `api/codes/route.ts`
// needs it). Mirrors `commands/promotions.ts`'s create/update/delete shape exactly —
// command-driven writes, `runCrudCommandWrite`/`withAtomicFlush` for atomicity,
// `emitCrudSideEffects`/`emitCrudUndoSideEffects` wired to the already-declared
// `promotions.code.created/updated/deleted` events (`events.ts`) — so `api/codes/route.ts`
// can follow `api/route.ts`'s own `makeCrudRoute` template literally.
// ---------------------------------------------------------------------------

const CODE_ENTITY_ID = E.promotions.code

const codeCrudIndexer: CrudIndexerConfig<Code> = {
  entityType: CODE_ENTITY_ID,
}

const codeCrudEvents: CrudEventsConfig<Code> = {
  module: 'promotions',
  entity: 'code',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const codeCommandOutputSchema = z.object({ codeId: z.string().uuid() })

type CodeSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  type: PromotionCodeType
  code: string | null
  prefix: string | null
  suffix: string | null
  length: number | null
  amount: number | null
  generated: number
  used: number
  usage: PromotionCodeUsageMode
  usageAmount: number | null
  usagePerCustomer: number | null
  active: boolean
  updatedAt: string
}

// Delete-only extension of `CodeSnapshot` (rev — the generic `prepare()` return type is
// `{ before?: unknown }`, so any extra data a specific command's undo needs must live
// INSIDE the snapshot object itself, not as a sibling key — see
// `@open-mercato/shared/lib/commands/types.ts`'s `CommandLogBuilderArgs.snapshots` shape).
type CodeDeleteSnapshot = CodeSnapshot & { activeGeneratedCodeIds: string[] }

type CodeUndoPayload = {
  before?: CodeSnapshot | CodeDeleteSnapshot | null
  after?: CodeSnapshot | null
}

function toCodeSnapshot(code: Code): CodeSnapshot {
  return {
    id: code.id,
    organizationId: code.organizationId,
    tenantId: code.tenantId,
    name: code.name,
    type: code.type,
    code: code.code ?? null,
    prefix: code.prefix ?? null,
    suffix: code.suffix ?? null,
    length: code.length ?? null,
    amount: code.amount ?? null,
    generated: code.generated,
    used: code.used,
    usage: code.usage,
    usageAmount: code.usageAmount ?? null,
    usagePerCustomer: code.usagePerCustomer ?? null,
    active: code.active,
    updatedAt: code.updatedAt.toISOString(),
  }
}

function getCodeIdentifiers(code: Code) {
  return { id: code.id, organizationId: code.organizationId, tenantId: code.tenantId }
}

async function loadCode(em: EntityManager, id: string): Promise<Code | null> {
  return em.findOne(Code, { id, deletedAt: null })
}

// Mirrors `commands/promotions.ts`'s `resolveActorScope` — a new code's scope is always
// the caller's own actor scope, never a client-supplied value.
function resolveCodeActorScope(ctx: CommandRuntimeContext): PromotionsCodeScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, {
      error: '[internal] Tenant and organization scope are required to create a promotion code',
    })
  }
  return { tenantId, organizationId }
}

const createCodeCommand: CommandHandler<PromotionCodeCreateInput, { codeId: string }> = {
  id: 'promotions.code.create',
  outputSchema: codeCommandOutputSchema,
  async execute(rawInput, ctx) {
    const parsed = promotionCodeCreateSchema.parse(rawInput)
    const scope = resolveCodeActorScope(ctx)
    ensureTenantScope(ctx, scope.tenantId)
    ensureOrganizationScope(ctx, scope.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const code = em.create(Code, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      name: parsed.name,
      type: parsed.type,
      code: parsed.code ?? null,
      prefix: parsed.prefix ?? null,
      suffix: parsed.suffix ?? null,
      length: parsed.length ?? null,
      amount: parsed.amount ?? null,
      usage: parsed.usage,
      usageAmount: parsed.usageAmount ?? null,
      usagePerCustomer: parsed.usagePerCustomer ?? null,
      active: parsed.active,
    })
    em.persist(code)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: code,
      identifiers: getCodeIdentifiers(code),
      events: codeCrudEvents,
      indexer: codeCrudIndexer,
    })

    // §API Contracts `POST /api/promotions/codes`: "for dynamic type, triggers
    // generation worker." Fired after the row has committed and its CRUD side effects
    // ran — a transient enqueue failure must not fail the create itself; the admin can
    // retry generation via `POST /codes/[id]/generate`.
    if (code.type === 'dynamic') {
      try {
        const generationService = ctx.container.resolve('promotionCodeGenerationService') as PromotionCodeGenerationService
        await generationService.triggerGeneration(code.id, scope)
      } catch (err) {
        codesLogger.warn('[internal] promotions.code.create failed to trigger code generation', { codeId: code.id, err })
      }
    }

    return { codeId: code.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const code = await loadCode(em, result.codeId)
    return code ? toCodeSnapshot(code) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const after = snapshots.after as CodeSnapshot | undefined
    return {
      actionLabel: translate('promotions.audit.code.create', 'Create promotional code'),
      resourceKind: 'promotions.code',
      resourceId: result.codeId,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: { after: after ?? null } satisfies CodeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CodeUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const code = await em.findOne(Code, { id: after.id })
    if (!code) return

    // `promotion_generated_codes.code_id` carries `ON DELETE CASCADE` (§Data Models), so
    // removing the Code row also removes every generated code minted for it.
    em.remove(code)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: code,
      identifiers: getCodeIdentifiers(code),
      events: codeCrudEvents,
      indexer: codeCrudIndexer,
    })
  },
}

const updateCodeCommand: CommandHandler<PromotionCodeUpdateInput, { codeId: string }> = {
  id: 'promotions.code.update',
  outputSchema: codeCommandOutputSchema,
  async prepare(rawInput, ctx) {
    const parsed = promotionCodeUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const code = await loadCode(em, parsed.id)
    return code ? { before: toCodeSnapshot(code) } : null
  },
  async execute(rawInput, ctx) {
    const parsed = promotionCodeUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const code = await loadCode(em, parsed.id)
    if (!code) throw notFound('Promotion code not found')
    assertPromotionScopeOrNotFound(ctx, code)

    await runCrudCommandWrite({
      ctx,
      em,
      entityId: CODE_ENTITY_ID,
      action: 'updated',
      scope: { tenantId: code.tenantId, organizationId: code.organizationId },
      events: codeCrudEvents,
      indexer: codeCrudIndexer,
      sideEffect: () => ({
        entity: code,
        identifiers: getCodeIdentifiers(code),
      }),
      phases: [
        () => {
          if (parsed.name !== undefined) code.name = parsed.name
          if (parsed.type !== undefined) code.type = parsed.type
          if (parsed.code !== undefined) code.code = parsed.code ?? null
          if (parsed.prefix !== undefined) code.prefix = parsed.prefix ?? null
          if (parsed.suffix !== undefined) code.suffix = parsed.suffix ?? null
          if (parsed.length !== undefined) code.length = parsed.length ?? null
          if (parsed.amount !== undefined) code.amount = parsed.amount ?? null
          if (parsed.usage !== undefined) code.usage = parsed.usage
          if (parsed.usageAmount !== undefined) code.usageAmount = parsed.usageAmount ?? null
          if (parsed.usagePerCustomer !== undefined) code.usagePerCustomer = parsed.usagePerCustomer ?? null
          if (parsed.active !== undefined) code.active = parsed.active
        },
      ],
    })

    return { codeId: code.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const code = await loadCode(em, result.codeId)
    return code ? toCodeSnapshot(code) : null
  },
  buildLog: async ({ result, snapshots, ctx }) => {
    const before = snapshots.before as CodeSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const code = await loadCode(em, result.codeId)
    const after = code ? toCodeSnapshot(code) : null
    return {
      actionLabel: translate('promotions.audit.code.update', 'Update promotional code'),
      resourceKind: 'promotions.code',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies CodeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CodeUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const code = await em.findOne(Code, { id: before.id })
    if (!code) return

    await withAtomicFlush(
      em,
      [
        () => {
          code.name = before.name
          code.type = before.type
          code.code = before.code
          code.prefix = before.prefix
          code.suffix = before.suffix
          code.length = before.length
          code.amount = before.amount
          code.usage = before.usage
          code.usageAmount = before.usageAmount
          code.usagePerCustomer = before.usagePerCustomer
          code.active = before.active
        },
      ],
      { transaction: true, label: 'promotions.code.update.undo' },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: code,
      identifiers: getCodeIdentifiers(code),
      events: codeCrudEvents,
      indexer: codeCrudIndexer,
    })
  },
}

const deleteCodeCommand: CommandHandler<PromotionCodeDeleteInput, { codeId: string }> = {
  id: 'promotions.code.delete',
  outputSchema: codeCommandOutputSchema,
  async prepare(rawInput, ctx) {
    const parsed = promotionCodeDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const code = await loadCode(em, parsed.id)
    if (!code) return null
    // §API Contracts `DELETE /api/promotions/codes`: "deactivates generated codes."
    // Captured here, before the mutation, so undo restores EXACTLY the rows THIS delete
    // deactivated — not every generated row for the code, some of which may already be
    // inactive for an unrelated reason (e.g. `codes/use` spending them).
    const activeGeneratedCodeIds = (
      await em.find(GeneratedCode, {
        codeId: code.id,
        tenantId: code.tenantId,
        organizationId: code.organizationId,
        active: true,
      })
    ).map((row) => row.id)
    return { before: { ...toCodeSnapshot(code), activeGeneratedCodeIds } satisfies CodeDeleteSnapshot }
  },
  async execute(rawInput, ctx) {
    const parsed = promotionCodeDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const code = await loadCode(em, parsed.id)
    if (!code) throw notFound('Promotion code not found')
    assertPromotionScopeOrNotFound(ctx, code)

    // §Data Models / §API Contracts: soft-delete the `Code` row AND explicitly
    // deactivate its already-generated codes. Decision (documented, not left implicit):
    // `resolveCodeByString`'s parent-code lookup already filters `deletedAt: null`, so a
    // soft-deleted code's generated rows are unreachable through the normal resolution
    // path regardless of this flag — but the explicit flip keeps the admin UI's own
    // generated-codes panel accurate and matches `codes/use`'s identical `active`
    // semantics, rather than relying on that implicit effect alone.
    await withAtomicFlush(
      em,
      [
        () => {
          code.deletedAt = new Date()
        },
        async () => {
          await em.nativeUpdate(
            GeneratedCode,
            { codeId: code.id, tenantId: code.tenantId, organizationId: code.organizationId },
            { active: false },
          )
        },
      ],
      { transaction: true, label: 'promotions.code.delete' },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: code,
      identifiers: getCodeIdentifiers(code),
      events: codeCrudEvents,
      indexer: codeCrudIndexer,
    })

    return { codeId: code.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as CodeDeleteSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('promotions.audit.code.delete', 'Delete promotional code'),
      resourceKind: 'promotions.code',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies CodeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CodeUndoPayload>(logEntry)
    const before = payload?.before as CodeDeleteSnapshot | undefined
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const code = await em.findOne(Code, { id: before.id })
    if (!code) return

    await withAtomicFlush(
      em,
      [
        () => {
          code.deletedAt = null
        },
        async () => {
          if (before.activeGeneratedCodeIds.length) {
            await em.nativeUpdate(GeneratedCode, { id: { $in: before.activeGeneratedCodeIds } }, { active: true })
          }
        },
      ],
      { transaction: true, label: 'promotions.code.delete.undo' },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      // Restoring a soft-deleted row re-adds it to the index/cache — same semantics as
      // `created` on the forward path (mirrors `commands/promotions.ts`'s delete undo).
      action: 'created',
      entity: code,
      identifiers: getCodeIdentifiers(code),
      events: codeCrudEvents,
      indexer: codeCrudIndexer,
    })
  },
}

registerCommand(reserveCodeCommand)
registerCommand(releaseCodeCommand)
registerCommand(useCodeCommand)
registerCommand(revertCodeUseCommand)
registerCommand(createCodeCommand)
registerCommand(updateCodeCommand)
registerCommand(deleteCodeCommand)

export {
  reserveCodeCommand,
  releaseCodeCommand,
  useCodeCommand,
  revertCodeUseCommand,
  createCodeCommand,
  updateCodeCommand,
  deleteCodeCommand,
}
