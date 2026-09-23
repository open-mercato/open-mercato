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
import { JournalEntryLine, LedgerAccount, LedgerAccountType } from '../data/entities'
import {
  ledgerAccountCreateSchema,
  ledgerAccountUpdateSchema,
  ledgerAccountDeleteSchema,
  type LedgerAccountCreateInput,
  type LedgerAccountUpdateInput,
  type LedgerAccountDeleteInput,
} from '../data/validators'

// Plain string, matching this module's own `encryption.ts` entityId
// convention (`'<module>:<table_name>'`) — not yet backed by a generated
// `E.ledger.ledger_account` entry until `yarn generate` runs (OM-15).
const LEDGER_ACCOUNT_ENTITY_ID = 'ledger:ledger_account'

type Scope = { organizationId: string; tenantId: string }

const ledgerAccountCrudEvents: CrudEventsConfig<LedgerAccount> = {
  module: 'ledger',
  entity: 'ledger_account',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const ledgerAccountCrudIndexer: CrudIndexerConfig<LedgerAccount> = {
  entityType: E.ledger.ledger_account,
}

/**
 * Whether `accountId` has any posted `JournalEntryLine` — the invariant
 * `updateLedgerAccount`'s `accountTypeId`-immutability guard checks (see
 * Testing Strategy).
 */
async function accountHasPostedEntries(em: EntityManager, accountId: string, scope: Scope): Promise<boolean> {
  const count = await em.count(JournalEntryLine, {
    accountId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return count > 0
}

/**
 * Rejects an `accountTypeId` that doesn't exist, is soft-deleted, or
 * belongs to a different organization/tenant. Neither `create` nor
 * `update` checked this before — `accountTypeId` was stored verbatim from
 * the input (PR #6340 review, M5).
 */
async function requireExistingAccountType(
  em: EntityManager,
  accountTypeId: string,
  scope: Scope,
  translate: TranslateWithFallbackFn,
): Promise<void> {
  const accountType = await em.findOne(LedgerAccountType, {
    id: accountTypeId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!accountType) {
    throw conflict(
      translate('ledger.errors.accountTypeNotFoundForOrg', 'The specified account type does not exist for this organization.'),
    )
  }
}

/**
 * Whether another `LedgerAccount` still names `accountId` as its
 * `parentAccountId` — deleting an account out from under a child would
 * leave that child pointing at a soft-deleted parent, which nothing else
 * checks for (PR #6340 review, m4).
 */
async function accountHasChildren(em: EntityManager, accountId: string, scope: Scope): Promise<boolean> {
  const count = await em.count(LedgerAccount, {
    parentAccountId: accountId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  return count > 0
}

/**
 * Rejects a `parentAccountId` that doesn't exist, is soft-deleted, belongs
 * to a different organization/tenant, names the account itself (only
 * possible on update — a brand-new account's server-generated id can't
 * appear in its own create payload), or would close a cycle through the
 * existing parent chain (also only reachable via update, since a newly
 * created leaf can't yet be any other account's ancestor). `selfId` is
 * `null` on create. PR #6340 review, M5.
 */
async function requireValidParentAccount(
  em: EntityManager,
  parentAccountId: string,
  selfId: string | null,
  scope: Scope,
  translate: TranslateWithFallbackFn,
): Promise<void> {
  if (selfId !== null && parentAccountId === selfId) {
    throw conflict(translate('ledger.errors.accountSelfParent', 'An account cannot be its own parent.'))
  }
  const parent = await em.findOne(LedgerAccount, {
    id: parentAccountId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!parent) {
    throw conflict(
      translate('ledger.errors.parentAccountNotFoundForOrg', 'The specified parent account does not exist for this organization.'),
    )
  }
  if (selfId === null) return

  // Walk the candidate parent's own ancestor chain looking for `selfId`.
  // Bounded rather than recursive-until-null: a cycle already present in
  // the data (which this same guard is here to prevent, but which could
  // in principle exist from before this guard shipped) would otherwise
  // loop forever instead of surfacing as a conflict.
  let cursor: string | null = parent.parentAccountId ?? null
  for (let hops = 0; cursor !== null && hops < 100; hops += 1) {
    if (cursor === selfId) {
      throw conflict(translate('ledger.errors.parentAccountCycle', 'This parent account would create a cycle.'))
    }
    const ancestor: LedgerAccount | null = await em.findOne(LedgerAccount, {
      id: cursor,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    cursor = ancestor?.parentAccountId ?? null
  }
}

const createLedgerAccountCommand: CommandHandler<LedgerAccountCreateInput, { ledgerAccountId: string }> = {
  id: 'ledger.createLedgerAccount',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(ledgerAccountCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope: Scope = { organizationId: parsed.organizationId, tenantId: parsed.tenantId }
    const { translate } = await resolveTranslations()

    const existing = await em.findOne(LedgerAccount, {
      slug: parsed.slug,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (existing) {
      throw conflict(translate('ledger.errors.accountSlugTaken', 'An account with this slug already exists for this organization.'))
    }

    await requireExistingAccountType(em, parsed.accountTypeId, scope, translate)
    if (parsed.parentAccountId) {
      await requireValidParentAccount(em, parsed.parentAccountId, null, scope, translate)
    }

    let record!: LedgerAccount
    await runCrudCommandWrite({
      ctx,
      em,
      entityId: LEDGER_ACCOUNT_ENTITY_ID,
      action: 'created',
      scope,
      customFields: custom,
      events: ledgerAccountCrudEvents,
      indexer: ledgerAccountCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      }),
      phases: [
        () => {
          const now = new Date()
          record = em.create(LedgerAccount, {
            id: randomUUID(),
            organizationId: parsed.organizationId,
            tenantId: parsed.tenantId,
            slug: parsed.slug,
            accountTypeId: parsed.accountTypeId,
            parentAccountId: parsed.parentAccountId ?? null,
            description: parsed.description ?? null,
            createdAt: now,
            updatedAt: now,
          })
          em.persist(record)
        },
      ],
    })

    return { ledgerAccountId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ledger.audit.createLedgerAccount', 'Create ledger account'),
      resourceKind: 'ledger.ledger_account',
      resourceId: result.ledgerAccountId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

const updateLedgerAccountCommand: CommandHandler<LedgerAccountUpdateInput, { ledgerAccountId: string }> = {
  id: 'ledger.updateLedgerAccount',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(ledgerAccountUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = await em.findOne(LedgerAccount, { id: parsed.id, deletedAt: null })
    const { translate } = await resolveTranslations()
    if (!record) throw notFound(translate('ledger.errors.ledgerAccountNotFound', 'Ledger account not found.'))
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const scope: Scope = { organizationId: record.organizationId, tenantId: record.tenantId }

    if (parsed.slug !== undefined && parsed.slug !== record.slug) {
      const existing = await em.findOne(LedgerAccount, {
        slug: parsed.slug,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        id: { $ne: record.id },
      })
      if (existing) throw conflict(translate('ledger.errors.accountSlugTaken', 'An account with this slug already exists for this organization.'))
    }

    if (parsed.accountTypeId !== undefined && parsed.accountTypeId !== record.accountTypeId) {
      if (await accountHasPostedEntries(em, record.id, scope)) {
        throw conflict(
          translate('ledger.errors.accountTypeImmutableAfterPosting', 'accountTypeId cannot be changed once this account has posted entries.'),
        )
      }
      await requireExistingAccountType(em, parsed.accountTypeId, scope, translate)
    }

    if (parsed.parentAccountId !== undefined && parsed.parentAccountId !== record.parentAccountId) {
      if (parsed.parentAccountId !== null) {
        await requireValidParentAccount(em, parsed.parentAccountId, record.id, scope, translate)
      }
    }

    await runCrudCommandWrite({
      ctx,
      em,
      entityId: LEDGER_ACCOUNT_ENTITY_ID,
      action: 'updated',
      scope,
      customFields: custom,
      events: ledgerAccountCrudEvents,
      indexer: ledgerAccountCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      }),
      phases: [
        () => {
          if (parsed.slug !== undefined) record.slug = parsed.slug
          if (parsed.accountTypeId !== undefined) record.accountTypeId = parsed.accountTypeId
          if (parsed.parentAccountId !== undefined) record.parentAccountId = parsed.parentAccountId ?? null
          if (parsed.description !== undefined) record.description = parsed.description ?? null
          record.updatedAt = new Date()
          em.persist(record)
        },
      ],
    })

    return { ledgerAccountId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ledger.audit.updateLedgerAccount', 'Update ledger account'),
      resourceKind: 'ledger.ledger_account',
      resourceId: result.ledgerAccountId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

/**
 * `deleteLedgerAccount` — soft delete (`deletedAt`). Blocked when the
 * account has any posted `JournalEntryLine`, matching the same
 * `accountHasPostedEntries` check `updateLedgerAccount` uses for its
 * `accountTypeId`-immutability guard (see spec's Queries/API section:
 * "delete blocked once posted entries exist").
 */
const deleteLedgerAccountCommand: CommandHandler<LedgerAccountDeleteInput, { ledgerAccountId: string }> = {
  id: 'ledger.deleteLedgerAccount',
  async execute(rawInput, ctx) {
    const parsed = ledgerAccountDeleteSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = await em.findOne(LedgerAccount, { id: parsed.id, deletedAt: null })
    const { translate } = await resolveTranslations()
    if (!record) throw notFound(translate('ledger.errors.ledgerAccountNotFound', 'Ledger account not found.'))
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const scope: Scope = { organizationId: record.organizationId, tenantId: record.tenantId }

    if (await accountHasPostedEntries(em, record.id, scope)) {
      throw conflict(
        translate('ledger.errors.accountHasPostedEntriesCannotDelete', 'This account cannot be deleted because it has posted journal entries.'),
      )
    }
    if (await accountHasChildren(em, record.id, scope)) {
      throw conflict(
        translate('ledger.errors.accountHasChildrenCannotDelete', 'This account cannot be deleted because another account still lists it as its parent.'),
      )
    }

    await runCrudCommandWrite({
      ctx,
      em,
      entityId: LEDGER_ACCOUNT_ENTITY_ID,
      action: 'deleted',
      scope,
      events: ledgerAccountCrudEvents,
      indexer: ledgerAccountCrudIndexer,
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

    return { ledgerAccountId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ledger.audit.deleteLedgerAccount', 'Delete ledger account'),
      resourceKind: 'ledger.ledger_account',
      resourceId: result.ledgerAccountId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(createLedgerAccountCommand)
registerCommand(updateLedgerAccountCommand)
registerCommand(deleteLedgerAccountCommand)
