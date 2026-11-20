import { randomUUID } from 'crypto'
import { z } from 'zod'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { conflict, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { JournalEntryLine, LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../data/entities'
import { ledgerAccountCreateSchema, ledgerAccountTypeCreateSchema } from '../data/validators'
import {
  ledgerAccountCrudEvents,
  ledgerAccountCrudIndexer,
  ledgerAccountTypeCrudEvents,
  ledgerAccountTypeCrudIndexer,
} from '../lib/ledgerAccountCrud'
import { DEFAULT_CHART_OF_ACCOUNTS_PL } from '../lib/defaultChartOfAccounts'
import { seedPolishAccountGroups } from '../lib/seeds'

type Scope = { organizationId: string; tenantId: string }

// Phase 1 takes no caller-supplied fields beyond the tenant/organization
// scope every command threads through `ctx` — the template is fixed (see
// spec, API Contracts). A future Phase 2 with multiple selectable
// templates would add a `templateId`-shaped input then.
const importDefaultChartOfAccountsSchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

export type ImportDefaultChartOfAccountsInput = z.infer<typeof importDefaultChartOfAccountsSchema>

export type ImportDefaultChartOfAccountsResult = {
  createdAccountTypeIds: string[]
  createdAccountIds: string[]
}

type ImportDefaultChartOfAccountsUndoPayload = {
  createdAccountTypeIds: string[]
  createdAccountIds: string[]
}

type PreparedAccountType = {
  id: string
  number: string
  name: string
  normalBalance: 'DEBIT' | 'CREDIT'
  accountGroupId: string
}

type PreparedAccount = {
  id: string
  number: string
  accountTypeId: string
  description: string
}

/**
 * `ledger.importDefaultChartOfAccounts` — bulk-creates the hardcoded
 * Phase 1 Polish "wzorcowy plan kont" template (see
 * `lib/defaultChartOfAccounts.ts`) as ordinary `LedgerAccountType`/
 * `LedgerAccount` rows, in one transaction, undoable as a single
 * operation. See `2026-09-15-default-chart-of-accounts.md` (PR #6137).
 *
 * Not a loop of `commandBus.execute` calls to the existing
 * `createLedgerAccountType`/`createLedgerAccount` commands (see the
 * spec's Design Decisions, "One command, one transaction, one undo") —
 * this validates the template once through the same
 * `data/validators.ts` schemas those commands already use, then writes
 * every row itself inside one `withAtomicFlush` transaction, and records
 * every created id in its own `buildLog` payload so `undo` reverses
 * exactly those rows in one call, instead of one undo-log entry per row.
 */
/**
 * Provisions the PL `LedgerAccountGroup` rows (zespoły 0-8) the template links
 * to, creating only the missing codes (OQ-R1). `seedDefaults` seeds them at
 * setup, but an organization created in Directory afterwards has none.
 *
 * Runs in a nested transaction (a savepoint) on the import's own transaction:
 * a concurrent seed of the same organization (another import, or setup) makes
 * this insert fail on `ledger_account_groups_scope_code_unique`, and a failed
 * statement aborts the enclosing Postgres transaction unless it is scoped to a
 * savepoint. That violation means the other writer committed the groups
 * first, so it is treated as "already exists"; the caller re-reads the groups
 * afterwards and sees the committed rows.
 */
async function ensurePolishAccountGroups(em: EntityManager, scope: Scope): Promise<void> {
  try {
    await em.transactional(async (savepointEm) => {
      await seedPolishAccountGroups(savepointEm, scope)
    })
  } catch (err) {
    if (!isUniqueViolation(err, 'ledger_account_groups_scope_code_unique')) throw err
  }
}

const importDefaultChartOfAccountsCommand: CommandHandler<
  ImportDefaultChartOfAccountsInput,
  ImportDefaultChartOfAccountsResult
> = {
  id: 'ledger.importDefaultChartOfAccounts',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = importDefaultChartOfAccountsSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const rootEm = (ctx.container.resolve('em') as EntityManager).fork()
    const scope: Scope = { organizationId: parsed.organizationId, tenantId: parsed.tenantId }
    const { translate } = await resolveTranslations()

    const now = new Date()
    const preparedTypes: PreparedAccountType[] = []
    const preparedAccounts: PreparedAccount[] = []
    const createdTypeRecords: LedgerAccountType[] = []
    const createdAccountRecords: LedgerAccount[] = []
    try {
      // One transaction for the group provisioning, the precondition check
      // and every insert (Design Decisions, "One command, one transaction,
      // one undo"; OQ-R1).
      await rootEm.transactional(async (em) => {
        // An organization created in Directory after initial setup never ran
        // `setup.ts`'s `seedDefaults`, so it has no PL account groups yet.
        // Provision the missing ones first (OQ-R1).
        await ensurePolishAccountGroups(em, scope)

        // Precondition: refuses to run against a non-empty chart of accounts
        // (Design Decisions, "Refuses to run against a non-empty chart of
        // accounts") — a starting point for an empty ledger, not a merge
        // tool. Soft-deleted rows don't block the import.
        const [existingTypeCount, existingAccountCount] = await Promise.all([
          em.count(LedgerAccountType, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            deletedAt: null,
          }),
          em.count(LedgerAccount, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            deletedAt: null,
          }),
        ])
        if (existingTypeCount > 0 || existingAccountCount > 0) {
          throw conflict(
            translate(
              'ledger.errors.chartOfAccountsNotEmpty',
              'The chart of accounts already has {{typeCount}} account type(s) and {{accountCount}} account(s); import refuses to run against a non-empty chart of accounts.',
              { typeCount: existingTypeCount, accountCount: existingAccountCount },
            ),
          )
        }

        const accountGroups = await em.find(LedgerAccountGroup, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          jurisdiction: 'PL',
        })
        const accountGroupIdByCode = new Map(accountGroups.map((group) => [group.code, group.id]))

        for (const typeSeed of DEFAULT_CHART_OF_ACCOUNTS_PL) {
          const accountGroupId = accountGroupIdByCode.get(typeSeed.accountGroupCode)
          if (!accountGroupId) {
            // `ensurePolishAccountGroups` above provisions every zespół the
            // template uses, so this is a template defect (a code outside
            // 0-8), not a state a tenant can reach.
            throw new Error(
              `[internal] default chart of accounts: type ${typeSeed.number} references unknown PL account group ${typeSeed.accountGroupCode}`,
            )
          }

          const typeId = randomUUID()
          // Validated once through the same schema `createLedgerAccountType`
          // already uses — no new validation rules, just a sanity check on
          // this template's own hardcoded data.
          ledgerAccountTypeCreateSchema.parse({
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            number: typeSeed.number,
            name: typeSeed.name,
            normalBalance: typeSeed.normalBalance,
            accountGroupId,
          })
          preparedTypes.push({ id: typeId, number: typeSeed.number, name: typeSeed.name, normalBalance: typeSeed.normalBalance, accountGroupId })

          for (const accountSeed of typeSeed.accounts) {
            ledgerAccountCreateSchema.parse({
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              number: accountSeed.number,
              accountTypeId: typeId,
              description: accountSeed.description,
            })
            preparedAccounts.push({
              id: randomUUID(),
              number: accountSeed.number,
              accountTypeId: typeId,
              description: accountSeed.description,
            })
          }
        }

        // Account types before accounts (accounts reference `accountTypeId`).
        // `withAtomicFlush` joins the ambient transaction opened above.
        await withAtomicFlush(
          em,
          [
            () => {
              for (const type of preparedTypes) {
                const record = em.create(LedgerAccountType, {
                  id: type.id,
                  organizationId: scope.organizationId,
                  tenantId: scope.tenantId,
                  number: type.number,
                  name: type.name,
                  normalBalance: type.normalBalance,
                  accountGroupId: type.accountGroupId,
                  createdAt: now,
                  updatedAt: now,
                })
                em.persist(record)
                createdTypeRecords.push(record)
              }
            },
            () => {
              for (const account of preparedAccounts) {
                const record = em.create(LedgerAccount, {
                  id: account.id,
                  organizationId: scope.organizationId,
                  tenantId: scope.tenantId,
                  number: account.number,
                  accountTypeId: account.accountTypeId,
                  description: account.description,
                  createdAt: now,
                  updatedAt: now,
                })
                em.persist(record)
                createdAccountRecords.push(record)
              }
            },
          ],
          { transaction: true, label: 'ledger.importDefaultChartOfAccounts' },
        )
      })
    } catch (err) {
      // Two concurrent imports against the same empty chart of accounts can
      // both pass the precondition check above before either writes — the
      // loser's flush fails on one of the two partial unique indexes
      // (`ledger_account_types_scope_number_unique` /
      // `ledger_accounts_scope_number_unique`, `(organization_id, tenant_id,
      // number) where deleted_at is null`, #6340) instead of corrupting data.
      // Map that race to the same 409 refusal the precondition check itself
      // throws, rather than letting it surface as a raw 500 (PR #6137
      // review, m1; see spec's Risks & Impact Review, "Concurrent import
      // attempts").
      if (
        isUniqueViolation(err, 'ledger_account_types_scope_number_unique') ||
        isUniqueViolation(err, 'ledger_accounts_scope_number_unique')
      ) {
        // Deliberately a distinct key from the precondition check's own
        // `chartOfAccountsNotEmpty` — that message's `{{typeCount}}`/
        // `{{accountCount}}` placeholders would read "0 account type(s)
        // and 0 account(s)" here (the counts this call itself observed
        // before losing the race), which is wrong, not just stale.
        throw conflict(
          translate(
            'ledger.errors.chartOfAccountsImportConflict',
            'Another import completed for this organization at the same time; refresh and check the chart of accounts before retrying.',
          ),
        )
      }
      throw err
    }

    // The import writes through the ORM directly instead of one
    // `createLedgerAccountType`/`createLedgerAccount` call per row, so it has
    // to raise the same `created` events and indexer updates those commands
    // raise — otherwise search and subscribers never see the imported rows
    // (PR #6439 review, point 2). Queued here, flushed by the command bus
    // after the command returns, like every other CRUD command.
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    for (const record of createdTypeRecords) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'created',
        entity: record,
        identifiers: { id: record.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
        events: ledgerAccountTypeCrudEvents,
        indexer: ledgerAccountTypeCrudIndexer,
      })
    }
    for (const record of createdAccountRecords) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'created',
        entity: record,
        identifiers: { id: record.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
        events: ledgerAccountCrudEvents,
        indexer: ledgerAccountCrudIndexer,
      })
    }

    return {
      createdAccountTypeIds: preparedTypes.map((type) => type.id),
      createdAccountIds: preparedAccounts.map((account) => account.id),
    }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ledger.audit.importDefaultChartOfAccounts', 'Import default chart of accounts'),
      resourceKind: 'ledger.chart_of_accounts_import',
      resourceId: null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      payload: {
        undo: {
          createdAccountTypeIds: result.createdAccountTypeIds,
          createdAccountIds: result.createdAccountIds,
        } satisfies ImportDefaultChartOfAccountsUndoPayload,
      },
    }
  },
  // Soft-deletes exactly the rows this call created (matching every other
  // delete in this module — see `deleteLedgerAccountType`/
  // `deleteLedgerAccount`), scoped to this call's own tenant/organization
  // so a stale or replayed undo can never reach another organization's
  // rows even if the log entry were somehow tampered with. Refuses the
  // whole call — writing nothing — if any created row fails the same two
  // guards ordinary deletion already enforces (PR #6137 review, M1), checked
  // under row locks in the same transaction as the write (OQ-R2).
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ImportDefaultChartOfAccountsUndoPayload>(logEntry)
    if (!payload) return
    const organizationId = logEntry.organizationId
    const tenantId = logEntry.tenantId
    if (!organizationId || !tenantId) return

    const rootEm = (ctx.container.resolve('em') as EntityManager).fork()
    const { translate } = await resolveTranslations()

    const now = new Date()
    const deletedAccounts: LedgerAccount[] = []
    const deletedTypes: LedgerAccountType[] = []
    // One transaction for the locks, both guards and the soft-delete
    // (decision OQ-R2). Lock protocol shared with `postJournalEntry` and the
    // account/account-type commands: account types first, then accounts, each
    // in id order, all `for update`.
    // - Posting holds `for share` on the accounts it touches (id order) until
    //   it commits, so the account locks below wait for an in-flight posting,
    //   and the posted-lines guard then sees its committed lines (409). A
    //   posting that arrives later waits for this transaction and then finds
    //   the accounts deleted.
    // - `createLedgerAccount` and an `updateLedgerAccount` that sets
    //   `accountTypeId` hold `for share` on the target type, so the type locks
    //   below make "an account outside this import uses the type" stable until
    //   commit.
    // Type -> account is the order every ledger command locks in, and posting
    // locks accounts only, so no lock cycle is possible.
    await rootEm.transactional(async (em) => {
      const types = payload.createdAccountTypeIds.length
        ? await em.find(
            LedgerAccountType,
            { id: { $in: payload.createdAccountTypeIds }, organizationId, tenantId, deletedAt: null },
            { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } },
          )
        : []
      const accounts = payload.createdAccountIds.length
        ? await em.find(
            LedgerAccount,
            { id: { $in: payload.createdAccountIds }, organizationId, tenantId, deletedAt: null },
            { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } },
          )
        : []

      // Guards on the same transaction, after the locks, and before any
      // write — never a partial undo. The same conditions ordinary deletion
      // enforces (`deleteLedgerAccount`'s posted-entries check;
      // `deleteLedgerAccountType`'s "still in use", narrowed to accounts this
      // import did not create, because those are being deleted with it).
      if (payload.createdAccountIds.length) {
        const postedLineCount = await em.count(JournalEntryLine, {
          accountId: { $in: payload.createdAccountIds },
          organizationId,
          tenantId,
        })
        if (postedLineCount > 0) {
          throw conflict(
            translate(
              'ledger.errors.accountHasPostedEntriesCannotDelete',
              'This account cannot be deleted because it has posted journal entries.',
            ),
          )
        }
      }
      if (payload.createdAccountTypeIds.length) {
        const accountsOutsideImport = await em.count(LedgerAccount, {
          accountTypeId: { $in: payload.createdAccountTypeIds },
          organizationId,
          tenantId,
          deletedAt: null,
          id: { $nin: payload.createdAccountIds },
        })
        if (accountsOutsideImport > 0) {
          throw conflict(
            translate(
              'ledger.errors.accountTypeStillInUseCannotDelete',
              'This account type cannot be deleted because an account still uses it.',
            ),
          )
        }
      }

      // `withAtomicFlush` joins the transaction opened above.
      await withAtomicFlush(
        em,
        [
          () => {
            for (const account of accounts) {
              account.deletedAt = now
              account.updatedAt = now
              deletedAccounts.push(account)
            }
          },
          () => {
            for (const type of types) {
              type.deletedAt = now
              type.updatedAt = now
              deletedTypes.push(type)
            }
          },
        ],
        { transaction: true, label: 'ledger.importDefaultChartOfAccounts.undo' },
      )
    })

    // Undo removes the rows `execute` announced, so it announces their
    // removal the same way — after the transaction committed.
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    for (const account of deletedAccounts) {
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'deleted',
        entity: account,
        identifiers: { id: account.id, organizationId, tenantId },
        events: ledgerAccountCrudEvents,
        indexer: ledgerAccountCrudIndexer,
      })
    }
    for (const type of deletedTypes) {
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'deleted',
        entity: type,
        identifiers: { id: type.id, organizationId, tenantId },
        events: ledgerAccountTypeCrudEvents,
        indexer: ledgerAccountTypeCrudIndexer,
      })
    }
  },
}

registerCommand(importDefaultChartOfAccountsCommand)
