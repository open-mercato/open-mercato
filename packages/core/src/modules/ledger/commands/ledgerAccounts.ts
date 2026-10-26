import { randomUUID } from 'crypto'
import { LockMode } from '@mikro-orm/core'
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
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { JournalEntryLine, LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../data/entities'
import { accountNumberFitsType } from '../lib/accountNumbering'
import { LEDGER_ACCOUNT_ENTITY_ID, ledgerAccountCrudEvents, ledgerAccountCrudIndexer } from '../lib/ledgerAccountCrud'
import {
  ledgerAccountCreateSchema,
  ledgerAccountUpdateSchema,
  ledgerAccountDeleteSchema,
  type LedgerAccountCreateInput,
  type LedgerAccountUpdateInput,
  type LedgerAccountDeleteInput,
} from '../data/validators'

type Scope = { organizationId: string; tenantId: string }

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
 * belongs to a different organization/tenant, and returns the type so the
 * caller can apply its numbering rule.
 */
async function requireExistingAccountType(
  em: EntityManager,
  accountTypeId: string,
  scope: Scope,
  translate: TranslateWithFallbackFn,
): Promise<LedgerAccountType> {
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
  return accountType
}

/**
 * Rejects an account `currencyId` that doesn't exist, is soft-deleted, or
 * belongs to a different organization/tenant (a plain FK-id, so nothing
 * else checks it).
 */
async function requireExistingCurrency(
  em: EntityManager,
  currencyId: string,
  scope: Scope,
  translate: TranslateWithFallbackFn,
): Promise<void> {
  const currency = await em.findOne(Currency, {
    id: currencyId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!currency) {
    throw conflict(translate('ledger.errors.currencyNotFound', 'The specified currency does not exist for this organization.'))
  }
}

/**
 * Rejects an account number that does not start with its type's number
 * (PL rule; no-op unless the type's group is a PL group — see
 * `lib/accountNumbering.ts`). The group is loaded here because the rule
 * depends on its jurisdiction.
 */
async function requireAccountNumberMatchesType(
  em: EntityManager,
  accountNumber: string,
  accountType: LedgerAccountType,
  scope: Scope,
  translate: TranslateWithFallbackFn,
): Promise<void> {
  const group = accountType.accountGroupId
    ? await em.findOne(LedgerAccountGroup, {
        id: accountType.accountGroupId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
    : null
  if (!accountNumberFitsType(accountNumber, accountType.number, group)) {
    throw badRequest(
      translate(
        'ledger.errors.accountNumberTypePrefix',
        'The account number must start with its type number ({{typeNumber}}).',
        { typeNumber: accountType.number },
      ),
    )
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
      number: parsed.number,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (existing) {
      throw conflict(translate('ledger.errors.accountNumberTaken', 'An account with this number already exists for this organization.'))
    }

    const accountType = await requireExistingAccountType(em, parsed.accountTypeId, scope, translate)
    await requireAccountNumberMatchesType(em, parsed.number, accountType, scope, translate)
    if (parsed.currencyId) {
      await requireExistingCurrency(em, parsed.currencyId, scope, translate)
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
            number: parsed.number,
            accountTypeId: parsed.accountTypeId,
            currencyId: parsed.currencyId ?? null,
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
    const rootEm = (ctx.container.resolve('em') as EntityManager).fork()
    const { translate } = await resolveTranslations()

    // Lock protocol shared with `postJournalEntry` (see its
    // `requireValidPostingReferences`): posting holds `for share` on every
    // account it touches until it commits, so taking `for update` on the
    // account row *before* the posted-entries checks makes this update wait
    // for an in-flight post and makes any later post wait for this update.
    // The checks then see committed lines only, and the write follows in the
    // same transaction. Lock order is account type -> account everywhere
    // (the type command takes the type first, then its accounts), so the two
    // never wait on each other in a cycle.
    const record = await rootEm.transactional(async (em) => {
      if (parsed.accountTypeId !== undefined) {
        await em.findOne(
          LedgerAccountType,
          { id: parsed.accountTypeId, deletedAt: null },
          { lockMode: LockMode.PESSIMISTIC_READ },
        )
      }
      const record = await em.findOne(
        LedgerAccount,
        { id: parsed.id, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      if (!record) throw notFound(translate('ledger.errors.ledgerAccountNotFound', 'Ledger account not found.'))
      ensureTenantScope(ctx, record.tenantId)
      ensureOrganizationScope(ctx, record.organizationId)
      const scope: Scope = { organizationId: record.organizationId, tenantId: record.tenantId }

      if (parsed.number !== undefined && parsed.number !== record.number) {
        const existing = await em.findOne(LedgerAccount, {
          number: parsed.number,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
          id: { $ne: record.id },
        })
        if (existing) throw conflict(translate('ledger.errors.accountNumberTaken', 'An account with this number already exists for this organization.'))
      }

      const changesNumber = parsed.number !== undefined && parsed.number !== record.number
      const changesType = parsed.accountTypeId !== undefined && parsed.accountTypeId !== record.accountTypeId

      // Posted history and JPK output are keyed by the number, so it is frozen
      // together with `accountTypeId`. The description stays editable.
      if (changesNumber && (await accountHasPostedEntries(em, record.id, scope))) {
        throw conflict(
          translate(
            'ledger.errors.accountNumberImmutableAfterPosting',
            'The account number cannot be changed once this account has posted entries.',
          ),
        )
      }

      if (changesType) {
        if (await accountHasPostedEntries(em, record.id, scope)) {
          throw conflict(
            translate('ledger.errors.accountTypeImmutableAfterPosting', 'accountTypeId cannot be changed once this account has posted entries.'),
          )
        }
      }

      if (parsed.currencyId !== undefined && (parsed.currencyId ?? null) !== (record.currencyId ?? null)) {
        if (await accountHasPostedEntries(em, record.id, scope)) {
          throw conflict(
            translate('ledger.errors.accountCurrencyImmutableAfterPosting', 'currencyId cannot be changed once this account has posted entries.'),
          )
        }
        if (parsed.currencyId) await requireExistingCurrency(em, parsed.currencyId, scope, translate)
      }

      // The rule is checked against the resulting (number, type) pair whenever
      // either side changes.
      if (changesNumber || changesType) {
        const accountType = await requireExistingAccountType(
          em,
          parsed.accountTypeId ?? record.accountTypeId,
          scope,
          translate,
        )
        await requireAccountNumberMatchesType(em, parsed.number ?? record.number, accountType, scope, translate)
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
            if (parsed.number !== undefined) record.number = parsed.number
            if (parsed.accountTypeId !== undefined) record.accountTypeId = parsed.accountTypeId
            if (parsed.currencyId !== undefined) record.currencyId = parsed.currencyId ?? null
            if (parsed.description !== undefined) record.description = parsed.description ?? null
            record.updatedAt = new Date()
            em.persist(record)
          },
        ],
      })

      return record
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
    const { translate } = await resolveTranslations()

    // The account row, the posted-entries check, and the
    // soft-delete write all now happen inside one transaction, holding a
    // `for update` lock on the account row for the whole span — the same
    // shape `fiscalPeriods.ts`'s
    // `toggleFiscalPeriodLock` uses for its own row. Before this, the
    // lookup and checks ran in autocommit (no lock held), so a concurrent
    // `postJournalEntry` (which takes `for share` on this same row, see
    // `requireValidPostingReferences`) could post new lines against this
    // account in the gap between this delete's check and its write.
    // `runCrudCommandWrite`'s own `withAtomicFlush` joins this ambient
    // transaction rather than opening a nested one (see its own
    // "Re-entrancy / composability" doc comment), so passing `trx` as its
    // `em` keeps the whole thing atomic.
    const record = await em.transactional(async (trx) => {
      const account = await trx.findOne(
        LedgerAccount,
        { id: parsed.id, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      if (!account) throw notFound(translate('ledger.errors.ledgerAccountNotFound', 'Ledger account not found.'))
      ensureTenantScope(ctx, account.tenantId)
      ensureOrganizationScope(ctx, account.organizationId)
      const scope: Scope = { organizationId: account.organizationId, tenantId: account.tenantId }

      if (await accountHasPostedEntries(trx, account.id, scope)) {
        throw conflict(
          translate('ledger.errors.accountHasPostedEntriesCannotDelete', 'This account cannot be deleted because it has posted journal entries.'),
        )
      }

      await runCrudCommandWrite({
        ctx,
        em: trx,
        entityId: LEDGER_ACCOUNT_ENTITY_ID,
        action: 'deleted',
        scope,
        events: ledgerAccountCrudEvents,
        indexer: ledgerAccountCrudIndexer,
        sideEffect: () => ({
          entity: account,
          identifiers: { id: account.id, organizationId: account.organizationId, tenantId: account.tenantId },
        }),
        phases: [
          () => {
            account.deletedAt = new Date()
            account.updatedAt = new Date()
            trx.persist(account)
          },
        ],
      })

      return account
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
