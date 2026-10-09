import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { parseWithCustomFields } from '@open-mercato/shared/lib/commands/helpers'
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { conflict, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { CostCenter } from '../data/entities'
import {
  costCenterCreateSchema,
  costCenterUpdateSchema,
  costCenterDeleteSchema,
  type CostCenterCreateInput,
  type CostCenterUpdateInput,
  type CostCenterDeleteInput,
} from '../data/validators'

const COST_CENTER_ENTITY_ID = 'posting_rules:cost_center'

type Scope = { organizationId: string; tenantId: string }

const costCenterCrudEvents: CrudEventsConfig<CostCenter> = {
  module: 'posting_rules',
  entity: 'cost_center',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const costCenterCrudIndexer: CrudIndexerConfig<CostCenter> = {
  entityType: E.posting_rules.cost_center,
}

/**
 * Whether a `DefaultAccountPostingRule.defaultCostCenterId` still names
 * `costCenterId` — checked lazily via a dynamic import to avoid a circular
 * top-level import between `costCenters.ts` and
 * `defaultAccountPostingRules.ts` (neither imports the other's module at
 * load time, only this function's own call site resolves the entity it
 * needs directly).
 */
async function costCenterReferencedByRule(em: EntityManager, costCenterId: string, scope: Scope): Promise<boolean> {
  const { DefaultAccountPostingRule } = await import('../data/entities')
  const count = await em.count(DefaultAccountPostingRule, {
    defaultCostCenterId: costCenterId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return count > 0
}

const createCostCenterCommand: CommandHandler<CostCenterCreateInput, { costCenterId: string }> = {
  id: 'posting_rules.createCostCenter',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(costCenterCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope: Scope = { organizationId: parsed.organizationId, tenantId: parsed.tenantId }
    const { translate } = await resolveTranslations()

    const existing = await em.findOne(CostCenter, {
      code: parsed.code,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (existing) {
      throw conflict(translate('posting_rules.errors.costCenterCodeTaken', 'A cost centre with this code already exists for this organization.'))
    }

    let record!: CostCenter
    await runCrudCommandWrite({
      ctx,
      em,
      entityId: COST_CENTER_ENTITY_ID,
      action: 'created',
      scope,
      customFields: custom,
      events: costCenterCrudEvents,
      indexer: costCenterCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      }),
      phases: [
        () => {
          const now = new Date()
          record = em.create(CostCenter, {
            id: randomUUID(),
            organizationId: parsed.organizationId,
            tenantId: parsed.tenantId,
            code: parsed.code,
            name: parsed.name,
            isActive: parsed.isActive ?? true,
            createdAt: now,
            updatedAt: now,
          })
          em.persist(record)
        },
      ],
    })

    return { costCenterId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('posting_rules.audit.createCostCenter', 'Create cost centre'),
      resourceKind: 'posting_rules.cost_center',
      resourceId: result.costCenterId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

const updateCostCenterCommand: CommandHandler<CostCenterUpdateInput, { costCenterId: string }> = {
  id: 'posting_rules.updateCostCenter',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(costCenterUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = await em.findOne(CostCenter, { id: parsed.id, deletedAt: null })
    const { translate } = await resolveTranslations()
    if (!record) throw notFound(translate('posting_rules.errors.costCenterNotFound', 'Cost centre not found.'))
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const scope: Scope = { organizationId: record.organizationId, tenantId: record.tenantId }

    // The sentinel is protected by the commands, not by a flag (spec, Design
    // Decisions, "The sentinel `CostCenter` is protected by the commands"):
    // hybrid step (3) always needs the `UNALLOCATED` row to exist, be active
    // and keep its well-known code.
    const { UNALLOCATED_COST_CENTER_CODE } = await import('../lib/seedDefaults')
    if (record.code === UNALLOCATED_COST_CENTER_CODE) {
      if (parsed.code !== undefined && parsed.code !== record.code) {
        throw conflict(
          translate('posting_rules.errors.sentinelCostCenterCodeLocked', 'The code of the sentinel "UNALLOCATED" cost centre cannot be changed.'),
        )
      }
      if (parsed.isActive === false) {
        throw conflict(
          translate('posting_rules.errors.sentinelCostCenterCannotBeDeactivated', 'The sentinel "UNALLOCATED" cost centre cannot be deactivated.'),
        )
      }
    }

    if (parsed.code !== undefined && parsed.code !== record.code) {
      const existing = await em.findOne(CostCenter, {
        code: parsed.code,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        id: { $ne: record.id },
      })
      if (existing) throw conflict(translate('posting_rules.errors.costCenterCodeTaken', 'A cost centre with this code already exists for this organization.'))
    }

    await runCrudCommandWrite({
      ctx,
      em,
      entityId: COST_CENTER_ENTITY_ID,
      action: 'updated',
      scope,
      customFields: custom,
      events: costCenterCrudEvents,
      indexer: costCenterCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      }),
      phases: [
        () => {
          if (parsed.code !== undefined) record.code = parsed.code
          if (parsed.name !== undefined) record.name = parsed.name
          if (parsed.isActive !== undefined) record.isActive = parsed.isActive
          record.updatedAt = new Date()
          em.persist(record)
        },
      ],
    })

    return { costCenterId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('posting_rules.audit.updateCostCenter', 'Update cost centre'),
      resourceKind: 'posting_rules.cost_center',
      resourceId: result.costCenterId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

/**
 * `deleteCostCenter` — soft delete (`deletedAt`). Blocked when any
 * `DefaultAccountPostingRule.defaultCostCenterId` still names it, or when
 * it is the seeded, non-deletable sentinel (`code: 'UNALLOCATED'` — the
 * MPK priority hybrid's third path always needs a real row to fall back
 * to; see `lib/seedDefaults.ts`).
 */
const deleteCostCenterCommand: CommandHandler<CostCenterDeleteInput, { costCenterId: string }> = {
  id: 'posting_rules.deleteCostCenter',
  async execute(rawInput, ctx) {
    const parsed = costCenterDeleteSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = await em.findOne(CostCenter, { id: parsed.id, deletedAt: null })
    const { translate } = await resolveTranslations()
    if (!record) throw notFound(translate('posting_rules.errors.costCenterNotFound', 'Cost centre not found.'))
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const scope: Scope = { organizationId: record.organizationId, tenantId: record.tenantId }

    const { UNALLOCATED_COST_CENTER_CODE } = await import('../lib/seedDefaults')
    if (record.code === UNALLOCATED_COST_CENTER_CODE) {
      throw conflict(
        translate('posting_rules.errors.sentinelCostCenterCannotBeDeleted', 'The sentinel "UNALLOCATED" cost centre cannot be deleted.'),
      )
    }

    if (await costCenterReferencedByRule(em, record.id, scope)) {
      throw conflict(
        translate(
          'posting_rules.errors.costCenterStillInUseCannotDelete',
          'This cost centre cannot be deleted because a default account posting rule still uses it.',
        ),
      )
    }

    await runCrudCommandWrite({
      ctx,
      em,
      entityId: COST_CENTER_ENTITY_ID,
      action: 'deleted',
      scope,
      events: costCenterCrudEvents,
      indexer: costCenterCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      }),
      phases: [
        () => {
          record.deletedAt = new Date()
          record.updatedAt = new Date()
          em.persist(record)
        },
      ],
    })

    return { costCenterId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('posting_rules.audit.deleteCostCenter', 'Delete cost centre'),
      resourceKind: 'posting_rules.cost_center',
      resourceId: result.costCenterId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(createCostCenterCommand)
registerCommand(updateCostCenterCommand)
registerCommand(deleteCostCenterCommand)
