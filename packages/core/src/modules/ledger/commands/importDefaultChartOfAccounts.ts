import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { conflict, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { JournalEntryLine, LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../data/entities'
import { ledgerAccountCreateSchema, ledgerAccountTypeCreateSchema } from '../data/validators'
import { DEFAULT_CHART_OF_ACCOUNTS_PL } from '../lib/defaultChartOfAccounts'

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
  slug: string
  name: string
  normalBalance: 'DEBIT' | 'CREDIT'
  accountGroupId: string
}

type PreparedAccount = {
  id: string
  slug: string
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
 * Whether `accountId` has any posted `JournalEntryLine` — the same guard
 * `deleteLedgerAccount` enforces (`commands/ledgerAccounts.ts`). Reimplemented
 * here (that helper isn't exported) but kept behaviorally identical on
 * purpose, so `undo` refuses on exactly the same condition ordinary
 * deletion does (PR #6137 review, M1).
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
 * Whether a non-deleted `LedgerAccount` outside this import's own
 * `createdAccountIds` still references `accountTypeId` — deliberately
 * narrower than `deleteLedgerAccountType`'s own `accountTypeStillInUse`
 * (`commands/ledgerAccountTypes.ts`), which would otherwise always be true
 * here: the import's own accounts of this type are still present (not yet
 * soft-deleted) while this check runs, so excluding them is what makes
 * "is this type used by something *other than what this import created*"
 * the actual question (PR #6137 review, M1).
 */
async function accountTypeUsedOutsideImport(
  em: EntityManager,
  accountTypeId: string,
  excludeAccountIds: string[],
  scope: Scope,
): Promise<boolean> {
  const count = await em.count(LedgerAccount, {
    accountTypeId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
    id: { $nin: excludeAccountIds },
  })
  return count > 0
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

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope: Scope = { organizationId: parsed.organizationId, tenantId: parsed.tenantId }
    const { translate } = await resolveTranslations()

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

    // Every `LedgerAccountType` links to the `LedgerAccountGroup` GL core
    // engine's `seedPolishAccountGroups` already seeded for this org
    // (Architecture, "Entities" — read-only here, this command never
    // creates or modifies a `LedgerAccountGroup` row).
    const accountGroups = await em.find(LedgerAccountGroup, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      jurisdiction: 'PL',
    })
    const accountGroupIdByCode = new Map(accountGroups.map((group) => [group.code, group.id]))

    const now = new Date()
    const preparedTypes: PreparedAccountType[] = []
    const preparedAccounts: PreparedAccount[] = []

    for (const typeSeed of DEFAULT_CHART_OF_ACCOUNTS_PL) {
      const accountGroupId = accountGroupIdByCode.get(typeSeed.accountGroupCode)
      if (!accountGroupId) {
        // Defensive: `setup.ts`'s `seedDefaults` always seeds zespoły 0-8
        // before a tenant can reach this command, so this should be
        // unreachable in practice — but failing loudly here is strictly
        // better than silently importing a type with a dangling
        // `accountGroupId`.
        throw conflict(
          translate(
            'ledger.errors.chartOfAccountsGroupsNotSeeded',
            'The Polish account groups (zespoły) this template requires are not seeded for this organization yet.',
          ),
        )
      }

      const typeId = randomUUID()
      // Validated once through the same schema `createLedgerAccountType`
      // already uses — no new validation rules, just a sanity check on
      // this template's own hardcoded data.
      ledgerAccountTypeCreateSchema.parse({
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        slug: typeSeed.slug,
        name: typeSeed.name,
        normalBalance: typeSeed.normalBalance,
        parentAccountTypeId: null,
        accountGroupId,
      })
      preparedTypes.push({ id: typeId, slug: typeSeed.slug, name: typeSeed.name, normalBalance: typeSeed.normalBalance, accountGroupId })

      for (const accountSeed of typeSeed.accounts) {
        ledgerAccountCreateSchema.parse({
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          slug: accountSeed.slug,
          accountTypeId: typeId,
          parentAccountId: null,
          description: accountSeed.description,
        })
        preparedAccounts.push({
          id: randomUUID(),
          slug: accountSeed.slug,
          accountTypeId: typeId,
          description: accountSeed.description,
        })
      }
    }

    // Account types before accounts (accounts reference `accountTypeId`),
    // inside one atomic transaction (Design Decisions, "One command, one
    // transaction, one undo").
    try {
      await withAtomicFlush(
        em,
        [
          () => {
            for (const type of preparedTypes) {
              const record = em.create(LedgerAccountType, {
                id: type.id,
                organizationId: scope.organizationId,
                tenantId: scope.tenantId,
                slug: type.slug,
                name: type.name,
                normalBalance: type.normalBalance,
                parentAccountTypeId: null,
                accountGroupId: type.accountGroupId,
                createdAt: now,
                updatedAt: now,
              })
              em.persist(record)
            }
          },
          () => {
            for (const account of preparedAccounts) {
              const record = em.create(LedgerAccount, {
                id: account.id,
                organizationId: scope.organizationId,
                tenantId: scope.tenantId,
                slug: account.slug,
                accountTypeId: account.accountTypeId,
                parentAccountId: null,
                description: account.description,
                createdAt: now,
                updatedAt: now,
              })
              em.persist(record)
            }
          },
        ],
        { transaction: true, label: 'ledger.importDefaultChartOfAccounts' },
      )
    } catch (err) {
      // Two concurrent imports against the same empty chart of accounts can
      // both pass the precondition check above before either writes — the
      // loser's flush fails on one of the two partial unique indexes
      // (`ledger_account_types_scope_slug_unique` /
      // `ledger_accounts_scope_slug_unique`, `(organization_id, tenant_id,
      // slug) where deleted_at is null`, #6340) instead of corrupting data.
      // Map that race to the same 409 refusal the precondition check itself
      // throws, rather than letting it surface as a raw 500 (PR #6137
      // review, m1; see spec's Risks & Impact Review, "Concurrent import
      // attempts").
      if (
        isUniqueViolation(err, 'ledger_account_types_scope_slug_unique') ||
        isUniqueViolation(err, 'ledger_accounts_scope_slug_unique')
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
  // guards ordinary deletion already enforces (PR #6137 review, M1: the
  // spec's own undo contract required this, but the first implementation
  // didn't check it).
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ImportDefaultChartOfAccountsUndoPayload>(logEntry)
    if (!payload) return
    const organizationId = logEntry.organizationId
    const tenantId = logEntry.tenantId
    if (!organizationId || !tenantId) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope: Scope = { organizationId, tenantId }
    const { translate } = await resolveTranslations()

    // Guard first, write nothing until every created row clears both
    // checks below — never a partial undo.
    for (const accountId of payload.createdAccountIds) {
      if (await accountHasPostedEntries(em, accountId, scope)) {
        throw conflict(
          translate(
            'ledger.errors.accountHasPostedEntriesCannotDelete',
            'This account cannot be deleted because it has posted journal entries.',
          ),
        )
      }
    }
    for (const accountTypeId of payload.createdAccountTypeIds) {
      if (await accountTypeUsedOutsideImport(em, accountTypeId, payload.createdAccountIds, scope)) {
        throw conflict(
          translate(
            'ledger.errors.accountTypeStillInUseCannotDelete',
            'This account type cannot be deleted because an account still uses it.',
          ),
        )
      }
    }

    const now = new Date()
    await withAtomicFlush(
      em,
      [
        async () => {
          if (!payload.createdAccountIds.length) return
          const accounts = await em.find(LedgerAccount, {
            id: { $in: payload.createdAccountIds },
            organizationId,
            tenantId,
            deletedAt: null,
          })
          for (const account of accounts) {
            account.deletedAt = now
            account.updatedAt = now
          }
        },
        async () => {
          if (!payload.createdAccountTypeIds.length) return
          const types = await em.find(LedgerAccountType, {
            id: { $in: payload.createdAccountTypeIds },
            organizationId,
            tenantId,
            deletedAt: null,
          })
          for (const type of types) {
            type.deletedAt = now
            type.updatedAt = now
          }
        },
      ],
      { transaction: true, label: 'ledger.importDefaultChartOfAccounts.undo' },
    )
  },
}

registerCommand(importDefaultChartOfAccountsCommand)
