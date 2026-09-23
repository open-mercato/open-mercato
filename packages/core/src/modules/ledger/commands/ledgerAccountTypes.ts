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
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import { E } from '#generated/entities.ids.generated'
import { JournalEntryLine, LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../data/entities'
import {
  ledgerAccountTypeCreateSchema,
  ledgerAccountTypeUpdateSchema,
  ledgerAccountTypeDeleteSchema,
  type LedgerAccountTypeCreateInput,
  type LedgerAccountTypeUpdateInput,
  type LedgerAccountTypeDeleteInput,
} from '../data/validators'

const LEDGER_ACCOUNT_TYPE_ENTITY_ID = 'ledger:ledger_account_type'

type Scope = { organizationId: string; tenantId: string }

const ledgerAccountTypeCrudEvents: CrudEventsConfig<LedgerAccountType> = {
  module: 'ledger',
  entity: 'ledger_account_type',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const ledgerAccountTypeCrudIndexer: CrudIndexerConfig<LedgerAccountType> = {
  entityType: E.ledger.ledger_account_type,
}

/**
 * Whether any `LedgerAccount` of `accountTypeId` has a posted
 * `JournalEntryLine` — the invariant `updateLedgerAccountType`'s
 * `normalBalance`/`accountGroupId`-immutability guard checks (see Testing
 * Strategy). No ORM relation exists between the two entities (plain FK-id
 * columns, see Design decisions), so this is a two-step lookup rather than
 * a join: the account ids of this type, then whether any line references
 * one of them.
 */
async function accountTypeHasPostedEntries(
  em: EntityManager,
  accountTypeId: string,
  scope: Scope,
): Promise<boolean> {
  const accounts = await em.find(
    LedgerAccount,
    { accountTypeId, organizationId: scope.organizationId, tenantId: scope.tenantId },
    { fields: ['id'] },
  )
  if (!accounts.length) return false
  const accountIds = accounts.map((account) => account.id)
  const count = await em.count(JournalEntryLine, {
    accountId: { $in: accountIds },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return count > 0
}

/**
 * Whether another `LedgerAccountType` still names `accountTypeId` as its
 * `parentAccountTypeId` — the second half of `deleteLedgerAccountType`'s
 * blocking condition (see spec: "delete blocked once posted entries OR
 * named as another type's parentAccountTypeId").
 */
async function accountTypeReferencedAsParent(
  em: EntityManager,
  accountTypeId: string,
  scope: Scope,
): Promise<boolean> {
  const count = await em.count(LedgerAccountType, {
    parentAccountTypeId: accountTypeId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  return count > 0
}

/**
 * Rejects an `accountGroupId` that doesn't exist, is soft-deleted, or
 * belongs to a different organization/tenant. Not checked before (PR
 * #6340 review, M5).
 */
async function requireExistingAccountGroup(
  em: EntityManager,
  accountGroupId: string,
  scope: Scope,
  translate: TranslateWithFallbackFn,
): Promise<void> {
  const group = await em.findOne(LedgerAccountGroup, {
    id: accountGroupId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (!group) {
    throw conflict(
      translate('ledger.errors.accountGroupNotFoundForOrg', 'The specified account group does not exist for this organization.'),
    )
  }
}

/**
 * Rejects a `parentAccountTypeId` that doesn't exist, is soft-deleted,
 * belongs to a different organization/tenant, names the type itself (only
 * reachable on update — see the equivalent note on `LedgerAccount`'s
 * `requireValidParentAccount`), or would close a cycle through the
 * existing parent chain. `selfId` is `null` on create. PR #6340 review,
 * M5.
 */
async function requireValidParentAccountType(
  em: EntityManager,
  parentAccountTypeId: string,
  selfId: string | null,
  scope: Scope,
  translate: TranslateWithFallbackFn,
): Promise<void> {
  if (selfId !== null && parentAccountTypeId === selfId) {
    throw conflict(translate('ledger.errors.accountTypeSelfParent', 'An account type cannot be its own parent.'))
  }
  const parent = await em.findOne(LedgerAccountType, {
    id: parentAccountTypeId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!parent) {
    throw conflict(
      translate('ledger.errors.parentAccountTypeNotFoundForOrg', 'The specified parent account type does not exist for this organization.'),
    )
  }
  if (selfId === null) return

  let cursor: string | null = parent.parentAccountTypeId ?? null
  for (let hops = 0; cursor !== null && hops < 100; hops += 1) {
    if (cursor === selfId) {
      throw conflict(translate('ledger.errors.parentAccountTypeCycle', 'This parent account type would create a cycle.'))
    }
    const ancestor: LedgerAccountType | null = await em.findOne(LedgerAccountType, {
      id: cursor,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    cursor = ancestor?.parentAccountTypeId ?? null
  }
}

const createLedgerAccountTypeCommand: CommandHandler<LedgerAccountTypeCreateInput, { ledgerAccountTypeId: string }> = {
  id: 'ledger.createLedgerAccountType',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(ledgerAccountTypeCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope: Scope = { organizationId: parsed.organizationId, tenantId: parsed.tenantId }
    const { translate } = await resolveTranslations()

    const existing = await em.findOne(LedgerAccountType, {
      slug: parsed.slug,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (existing) {
      throw conflict(translate('ledger.errors.accountTypeSlugTaken', 'An account type with this slug already exists for this organization.'))
    }

    if (parsed.parentAccountTypeId) {
      await requireValidParentAccountType(em, parsed.parentAccountTypeId, null, scope, translate)
    }
    if (parsed.accountGroupId) {
      await requireExistingAccountGroup(em, parsed.accountGroupId, scope, translate)
    }

    let record!: LedgerAccountType
    await runCrudCommandWrite({
      ctx,
      em,
      entityId: LEDGER_ACCOUNT_TYPE_ENTITY_ID,
      action: 'created',
      scope,
      customFields: custom,
      events: ledgerAccountTypeCrudEvents,
      indexer: ledgerAccountTypeCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      }),
      phases: [
        () => {
          const now = new Date()
          record = em.create(LedgerAccountType, {
            id: randomUUID(),
            organizationId: parsed.organizationId,
            tenantId: parsed.tenantId,
            slug: parsed.slug,
            name: parsed.name,
            normalBalance: parsed.normalBalance,
            parentAccountTypeId: parsed.parentAccountTypeId ?? null,
            accountGroupId: parsed.accountGroupId ?? null,
            createdAt: now,
            updatedAt: now,
          })
          em.persist(record)
        },
      ],
    })

    return { ledgerAccountTypeId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ledger.audit.createLedgerAccountType', 'Create ledger account type'),
      resourceKind: 'ledger.ledger_account_type',
      resourceId: result.ledgerAccountTypeId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

const updateLedgerAccountTypeCommand: CommandHandler<LedgerAccountTypeUpdateInput, { ledgerAccountTypeId: string }> = {
  id: 'ledger.updateLedgerAccountType',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(ledgerAccountTypeUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = await em.findOne(LedgerAccountType, { id: parsed.id, deletedAt: null })
    const { translate } = await resolveTranslations()
    if (!record) throw notFound(translate('ledger.errors.accountTypeNotFound', 'Ledger account type not found.'))
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const scope: Scope = { organizationId: record.organizationId, tenantId: record.tenantId }

    if (parsed.slug !== undefined && parsed.slug !== record.slug) {
      const existing = await em.findOne(LedgerAccountType, {
        slug: parsed.slug,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        id: { $ne: record.id },
      })
      if (existing) throw conflict(translate('ledger.errors.accountTypeSlugTaken', 'An account type with this slug already exists for this organization.'))
    }

    const changesNormalBalance = parsed.normalBalance !== undefined && parsed.normalBalance !== record.normalBalance
    const changesAccountGroup =
      parsed.accountGroupId !== undefined && (parsed.accountGroupId ?? null) !== (record.accountGroupId ?? null)

    if (changesNormalBalance || changesAccountGroup) {
      if (await accountTypeHasPostedEntries(em, record.id, scope)) {
        throw conflict(
          translate(
            'ledger.errors.accountTypeAttributesImmutableAfterPosting',
            'normalBalance and accountGroupId cannot be changed once an account of this type has posted entries.',
          ),
        )
      }
    }

    if (changesAccountGroup && parsed.accountGroupId) {
      await requireExistingAccountGroup(em, parsed.accountGroupId, scope, translate)
    }

    if (parsed.parentAccountTypeId !== undefined && parsed.parentAccountTypeId !== record.parentAccountTypeId) {
      if (parsed.parentAccountTypeId !== null) {
        await requireValidParentAccountType(em, parsed.parentAccountTypeId, record.id, scope, translate)
      }
    }

    await runCrudCommandWrite({
      ctx,
      em,
      entityId: LEDGER_ACCOUNT_TYPE_ENTITY_ID,
      action: 'updated',
      scope,
      customFields: custom,
      events: ledgerAccountTypeCrudEvents,
      indexer: ledgerAccountTypeCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      }),
      phases: [
        () => {
          if (parsed.slug !== undefined) record.slug = parsed.slug
          if (parsed.name !== undefined) record.name = parsed.name
          if (parsed.normalBalance !== undefined) record.normalBalance = parsed.normalBalance
          if (parsed.parentAccountTypeId !== undefined) record.parentAccountTypeId = parsed.parentAccountTypeId ?? null
          if (parsed.accountGroupId !== undefined) record.accountGroupId = parsed.accountGroupId ?? null
          record.updatedAt = new Date()
          em.persist(record)
        },
      ],
    })

    return { ledgerAccountTypeId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ledger.audit.updateLedgerAccountType', 'Update ledger account type'),
      resourceKind: 'ledger.ledger_account_type',
      resourceId: result.ledgerAccountTypeId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

/**
 * `deleteLedgerAccountType` — soft delete (`deletedAt`). Blocked when any
 * account of this type has posted entries, or when another account type
 * still names this one as its `parentAccountTypeId` (see
 * accountTypeReferencedAsParent).
 */
const deleteLedgerAccountTypeCommand: CommandHandler<LedgerAccountTypeDeleteInput, { ledgerAccountTypeId: string }> = {
  id: 'ledger.deleteLedgerAccountType',
  async execute(rawInput, ctx) {
    const parsed = ledgerAccountTypeDeleteSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = await em.findOne(LedgerAccountType, { id: parsed.id, deletedAt: null })
    const { translate } = await resolveTranslations()
    if (!record) throw notFound(translate('ledger.errors.accountTypeNotFound', 'Ledger account type not found.'))
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const scope: Scope = { organizationId: record.organizationId, tenantId: record.tenantId }

    if (await accountTypeHasPostedEntries(em, record.id, scope)) {
      throw conflict(
        translate(
          'ledger.errors.accountTypeHasPostedEntriesCannotDelete',
          'This account type cannot be deleted because an account of this type has posted entries.',
        ),
      )
    }
    if (await accountTypeReferencedAsParent(em, record.id, scope)) {
      throw conflict(
        translate(
          'ledger.errors.accountTypeReferencedAsParentCannotDelete',
          'This account type cannot be deleted because another account type still lists it as its parent.',
        ),
      )
    }

    await runCrudCommandWrite({
      ctx,
      em,
      entityId: LEDGER_ACCOUNT_TYPE_ENTITY_ID,
      action: 'deleted',
      scope,
      events: ledgerAccountTypeCrudEvents,
      indexer: ledgerAccountTypeCrudIndexer,
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

    return { ledgerAccountTypeId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ledger.audit.deleteLedgerAccountType', 'Delete ledger account type'),
      resourceKind: 'ledger.ledger_account_type',
      resourceId: result.ledgerAccountTypeId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(createLedgerAccountTypeCommand)
registerCommand(updateLedgerAccountTypeCommand)
registerCommand(deleteLedgerAccountTypeCommand)
