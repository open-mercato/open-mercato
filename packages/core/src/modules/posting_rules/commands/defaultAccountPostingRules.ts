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
import { LedgerAccount } from '../../ledger/data/entities'
import { CostCenter, DefaultAccountPostingRule } from '../data/entities'
import {
  defaultAccountPostingRuleCreateSchema,
  defaultAccountPostingRuleUpdateSchema,
  defaultAccountPostingRuleDeleteSchema,
  type DefaultAccountPostingRuleCreateInput,
  type DefaultAccountPostingRuleUpdateInput,
  type DefaultAccountPostingRuleDeleteInput,
} from '../data/validators'

const DEFAULT_ACCOUNT_POSTING_RULE_ENTITY_ID = 'posting_rules:default_account_posting_rule'

type Scope = { organizationId: string; tenantId: string }

const ruleCrudEvents: CrudEventsConfig<DefaultAccountPostingRule> = {
  module: 'posting_rules',
  entity: 'default_account_posting_rule',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const ruleCrudIndexer: CrudIndexerConfig<DefaultAccountPostingRule> = {
  entityType: E.posting_rules.default_account_posting_rule,
}

/**
 * `sourceAccountId`/`targetAccountId` name another row by id
 * (financial-command-implementation-checklist item 2) — confirms each
 * exists, is not soft-deleted, and belongs to the caller's own
 * tenant/organization. This is a direct cross-module entity read of
 * `ledger.LedgerAccount`, the same hard-dependency precedent the spec's
 * Cross-module integration documents.
 */
async function requireExistingLedgerAccount(
  em: EntityManager,
  accountId: string,
  scope: Scope,
  translate: (key: string, fallback: string) => string,
  errorKey: string,
  errorFallback: string,
): Promise<void> {
  const account = await em.findOne(LedgerAccount, {
    id: accountId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!account) {
    throw conflict(translate(errorKey, errorFallback))
  }
}

async function requireExistingCostCenter(
  em: EntityManager,
  costCenterId: string,
  scope: Scope,
  translate: (key: string, fallback: string) => string,
): Promise<void> {
  const costCenter = await em.findOne(CostCenter, {
    id: costCenterId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!costCenter) {
    throw conflict(translate('posting_rules.errors.defaultCostCenterNotFoundForOrg', 'The specified default cost centre does not exist for this organization.'))
  }
}

const createDefaultAccountPostingRuleCommand: CommandHandler<
  DefaultAccountPostingRuleCreateInput,
  { defaultAccountPostingRuleId: string }
> = {
  id: 'posting_rules.createDefaultAccountPostingRule',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(defaultAccountPostingRuleCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope: Scope = { organizationId: parsed.organizationId, tenantId: parsed.tenantId }
    const { translate } = await resolveTranslations()

    const existing = await em.findOne(DefaultAccountPostingRule, {
      sourceAccountId: parsed.sourceAccountId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    if (existing) {
      throw conflict(
        translate(
          'posting_rules.errors.defaultAccountPostingRuleSourceTaken',
          'A default account posting rule already exists for this source account.',
        ),
      )
    }

    await requireExistingLedgerAccount(
      em, parsed.sourceAccountId, scope, translate,
      'posting_rules.errors.sourceAccountNotFoundForOrg', 'The specified source account does not exist for this organization.',
    )
    await requireExistingLedgerAccount(
      em, parsed.targetAccountId, scope, translate,
      'posting_rules.errors.targetAccountNotFoundForOrg', 'The specified target account does not exist for this organization.',
    )
    if (parsed.defaultCostCenterId) {
      await requireExistingCostCenter(em, parsed.defaultCostCenterId, scope, translate)
    }

    let record!: DefaultAccountPostingRule
    await runCrudCommandWrite({
      ctx,
      em,
      entityId: DEFAULT_ACCOUNT_POSTING_RULE_ENTITY_ID,
      action: 'created',
      scope,
      customFields: custom,
      events: ruleCrudEvents,
      indexer: ruleCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      }),
      phases: [
        () => {
          const now = new Date()
          record = em.create(DefaultAccountPostingRule, {
            id: randomUUID(),
            organizationId: parsed.organizationId,
            tenantId: parsed.tenantId,
            sourceAccountId: parsed.sourceAccountId,
            targetAccountId: parsed.targetAccountId,
            defaultCostCenterId: parsed.defaultCostCenterId ?? null,
            createdAt: now,
            updatedAt: now,
          })
          em.persist(record)
        },
      ],
    })

    return { defaultAccountPostingRuleId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('posting_rules.audit.createDefaultAccountPostingRule', 'Create default account posting rule'),
      resourceKind: 'posting_rules.default_account_posting_rule',
      resourceId: result.defaultAccountPostingRuleId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

const updateDefaultAccountPostingRuleCommand: CommandHandler<
  DefaultAccountPostingRuleUpdateInput,
  { defaultAccountPostingRuleId: string }
> = {
  id: 'posting_rules.updateDefaultAccountPostingRule',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(defaultAccountPostingRuleUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = await em.findOne(DefaultAccountPostingRule, { id: parsed.id })
    const { translate } = await resolveTranslations()
    if (!record) throw notFound(translate('posting_rules.errors.defaultAccountPostingRuleNotFound', 'Default account posting rule not found.'))
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const scope: Scope = { organizationId: record.organizationId, tenantId: record.tenantId }

    if (parsed.targetAccountId !== undefined) {
      await requireExistingLedgerAccount(
        em, parsed.targetAccountId, scope, translate,
        'posting_rules.errors.targetAccountNotFoundForOrg', 'The specified target account does not exist for this organization.',
      )
    }
    if (parsed.defaultCostCenterId !== undefined && parsed.defaultCostCenterId !== null) {
      await requireExistingCostCenter(em, parsed.defaultCostCenterId, scope, translate)
    }

    await runCrudCommandWrite({
      ctx,
      em,
      entityId: DEFAULT_ACCOUNT_POSTING_RULE_ENTITY_ID,
      action: 'updated',
      scope,
      customFields: custom,
      events: ruleCrudEvents,
      indexer: ruleCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      }),
      phases: [
        () => {
          if (parsed.targetAccountId !== undefined) record.targetAccountId = parsed.targetAccountId
          if (parsed.defaultCostCenterId !== undefined) record.defaultCostCenterId = parsed.defaultCostCenterId ?? null
          record.updatedAt = new Date()
          em.persist(record)
        },
      ],
    })

    return { defaultAccountPostingRuleId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('posting_rules.audit.updateDefaultAccountPostingRule', 'Update default account posting rule'),
      resourceKind: 'posting_rules.default_account_posting_rule',
      resourceId: result.defaultAccountPostingRuleId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

/** Not explicitly named in the spec's own Commands list — disclosed scope
 * addition, matching this repo's convention of declaring a full CRUD
 * triple (see `data/validators.ts`'s own comment on
 * `defaultAccountPostingRuleDeleteSchema`). Hard delete is deliberately
 * NOT used — this row has no `deletedAt` in the spec's own Data Models,
 * so this soft-deletes by clearing it to a harmless no-op state is wrong;
 * instead this is a genuine hard delete, matching the entity's own lack
 * of a `deletedAt` column (a mapping an admin misconfigured and wants
 * gone, not a historical record — no ledger data is deleted, only the
 * mapping itself). */
const deleteDefaultAccountPostingRuleCommand: CommandHandler<
  DefaultAccountPostingRuleDeleteInput,
  { defaultAccountPostingRuleId: string }
> = {
  id: 'posting_rules.deleteDefaultAccountPostingRule',
  async execute(rawInput, ctx) {
    const parsed = defaultAccountPostingRuleDeleteSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = await em.findOne(DefaultAccountPostingRule, { id: parsed.id })
    const { translate } = await resolveTranslations()
    if (!record) throw notFound(translate('posting_rules.errors.defaultAccountPostingRuleNotFound', 'Default account posting rule not found.'))
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const scope: Scope = { organizationId: record.organizationId, tenantId: record.tenantId }

    await runCrudCommandWrite({
      ctx,
      em,
      entityId: DEFAULT_ACCOUNT_POSTING_RULE_ENTITY_ID,
      action: 'deleted',
      scope,
      events: ruleCrudEvents,
      indexer: ruleCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      }),
      phases: [
        () => {
          em.remove(record)
        },
      ],
    })

    return { defaultAccountPostingRuleId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('posting_rules.audit.deleteDefaultAccountPostingRule', 'Delete default account posting rule'),
      resourceKind: 'posting_rules.default_account_posting_rule',
      resourceId: result.defaultAccountPostingRuleId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(createDefaultAccountPostingRuleCommand)
registerCommand(updateDefaultAccountPostingRuleCommand)
registerCommand(deleteDefaultAccountPostingRuleCommand)
