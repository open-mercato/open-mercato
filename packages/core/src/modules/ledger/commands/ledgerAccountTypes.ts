import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { parseWithCustomFields } from '@open-mercato/shared/lib/commands/helpers'
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { badRequest, conflict, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import { E } from '#generated/entities.ids.generated'
import { JournalEntryLine, LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../data/entities'
import { checkTypeNumber } from '../lib/accountNumbering'
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
 * Whether any `LedgerAccount` still names `accountTypeId` as its
 * `accountTypeId` — deleting the type out from under an unposted account
 * would leave that account pointing at a soft-deleted type, which nothing
 * else checks for. Distinct from
 * `accountTypeHasPostedEntries` above: that one only cares whether any of
 * those accounts have posted entries; this one blocks the delete whenever
 * *any* non-deleted account of this type still exists, posted or not.
 */
async function accountTypeStillInUse(em: EntityManager, accountTypeId: string, scope: Scope): Promise<boolean> {
  const count = await em.count(LedgerAccount, {
    accountTypeId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  return count > 0
}

/**
 * Rejects an `accountGroupId` that doesn't exist, is soft-deleted, or
 * belongs to a different organization/tenant, and returns the group so the
 * caller can apply its numbering rule.
 */
async function requireExistingAccountGroup(
  em: EntityManager,
  accountGroupId: string,
  scope: Scope,
  translate: TranslateWithFallbackFn,
): Promise<LedgerAccountGroup> {
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
  return group
}

/**
 * Rejects a type number that breaks the PL rule for its group (three
 * digits, first digit = the group's `code`). No-op for a type without a
 * group or in a non-PL group. See `lib/accountNumbering.ts`.
 */
function requireTypeNumberMatchesGroup(
  number: string,
  group: LedgerAccountGroup | null,
  translate: TranslateWithFallbackFn,
): void {
  const violation = checkTypeNumber(number, group)
  if (violation === 'format') {
    throw badRequest(
      translate('ledger.errors.accountTypeNumberFormat', 'A type number in a Polish group must be exactly three digits.'),
    )
  }
  if (violation === 'groupDigit') {
    throw badRequest(
      translate(
        'ledger.errors.accountTypeNumberGroupDigit',
        'The first digit of the type number must be the group code ({{code}}).',
        { code: group?.code ?? '' },
      ),
    )
  }
}

/**
 * Whether some live account of `accountTypeId` has a number that does not
 * start with `typeNumber` — renumbering the type would then leave that
 * account outside the prefix rule.
 */
async function accountsBreakPrefix(
  em: EntityManager,
  accountTypeId: string,
  typeNumber: string,
  scope: Scope,
): Promise<boolean> {
  const accounts = await em.find(
    LedgerAccount,
    { accountTypeId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
    { fields: ['number'] },
  )
  return accounts.some((account) => !account.number.startsWith(typeNumber))
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
      number: parsed.number,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (existing) {
      throw conflict(translate('ledger.errors.accountTypeNumberTaken', 'An account type with this number already exists for this organization.'))
    }

    const group = parsed.accountGroupId
      ? await requireExistingAccountGroup(em, parsed.accountGroupId, scope, translate)
      : null
    requireTypeNumberMatchesGroup(parsed.number, group, translate)

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
            number: parsed.number,
            name: parsed.name,
            normalBalance: parsed.normalBalance,
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

    if (parsed.number !== undefined && parsed.number !== record.number) {
      const existing = await em.findOne(LedgerAccountType, {
        number: parsed.number,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        id: { $ne: record.id },
      })
      if (existing) throw conflict(translate('ledger.errors.accountTypeNumberTaken', 'An account type with this number already exists for this organization.'))
    }

    const changesNumber = parsed.number !== undefined && parsed.number !== record.number
    const changesNormalBalance = parsed.normalBalance !== undefined && parsed.normalBalance !== record.normalBalance
    const changesAccountGroup =
      parsed.accountGroupId !== undefined && (parsed.accountGroupId ?? null) !== (record.accountGroupId ?? null)

    // Posted history and JPK output are keyed by the number, so it is frozen
    // together with `normalBalance` and `accountGroupId`. The name stays
    // editable.
    if (changesNumber && (await accountTypeHasPostedEntries(em, record.id, scope))) {
      throw conflict(
        translate(
          'ledger.errors.accountTypeNumberImmutableAfterPosting',
          'The type number cannot be changed once an account of this type has posted entries.',
        ),
      )
    }

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

    // The rule is checked against the resulting (number, group) pair whenever
    // either side changes, so moving a type to another group cannot leave a
    // number with the wrong first digit.
    if (changesNumber || changesAccountGroup) {
      const nextNumber = parsed.number ?? record.number
      const nextGroupId = parsed.accountGroupId !== undefined ? parsed.accountGroupId : (record.accountGroupId ?? null)
      const nextGroup = nextGroupId ? await requireExistingAccountGroup(em, nextGroupId, scope, translate) : null
      requireTypeNumberMatchesGroup(nextNumber, nextGroup, translate)
      if (changesNumber && nextGroup && checkTypeNumber(nextNumber, nextGroup) === null) {
        if (await accountsBreakPrefix(em, record.id, nextNumber, scope)) {
          throw conflict(
            translate(
              'ledger.errors.accountTypeNumberAccountsPrefix',
              'The type number cannot change while accounts of this type have numbers that do not start with it.',
            ),
          )
        }
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
          if (parsed.number !== undefined) record.number = parsed.number
          if (parsed.name !== undefined) record.name = parsed.name
          if (parsed.normalBalance !== undefined) record.normalBalance = parsed.normalBalance
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
 * account of this type has posted entries or an account still uses it.
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
    if (await accountTypeStillInUse(em, record.id, scope)) {
      throw conflict(
        translate(
          'ledger.errors.accountTypeStillInUseCannotDelete',
          'This account type cannot be deleted because an account still uses it.',
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
