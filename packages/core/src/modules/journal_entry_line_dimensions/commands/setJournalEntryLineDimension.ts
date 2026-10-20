import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError, conflict, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import { JournalEntryLineDimension } from '../data/entities'
import { FiscalPeriod, JournalEntry, JournalEntryLine } from '../../ledger/data/entities'
import { setJournalEntryLineDimensionSchema, type SetJournalEntryLineDimensionInput } from '../data/validators'

type Scope = {
  tenantId: string
  organizationId: string
}

type SetDimensionResult = {
  journalEntryLineId: string
  dimensionType: string
  writer: string
  dimensionIds: string[]
}

type SetDimensionUndoPayload = {
  journalEntryLineId: string
  dimensionType: string
  writer: string
  tenantId: string
  organizationId: string
  before: string[]
  after: string[]
}

/** The pair this command replaces rows for, plus the module claiming it. */
type PairWrite = {
  journalEntryLineId: string
  dimensionType: string
  writer: string
  dimensionIds: string[]
}

/**
 * Resolves the acting scope from the runtime context, falling back to the
 * input's explicit `tenantId`/`organizationId` only when `ctx.auth` carries
 * none. This command is only ever called in-process by a trusted
 * hard-dependency consumer (`posting_rules`, `fixed_assets`), never through an
 * HTTP route, so there is no end-user-facing "target org" a caller could
 * smuggle in through the input.
 *
 * The fallback is needed because a `systemActor` caller — `posting_rules`'
 * `reclassify.ts` engine "posts on nobody's behalf" — runs with
 * `ctx.auth: null`, so a ctx-only scope would 404 every real call. It follows
 * the precedent of `warranty_claims`' systemActor subscriber, which passes its
 * own already-resolved scope as an explicit input field.
 *
 * Honors the SELECTED organization (`ctx.selectedOrganizationId`), not just
 * `ctx.auth.orgId` — see `financial-command-implementation-checklist` item 3.
 */
function resolveScope(ctx: CommandRuntimeContext, input: { tenantId?: string; organizationId?: string }): Scope {
  const tenantId = ctx.auth?.tenantId ?? input.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? input.organizationId ?? null
  if (!tenantId || !organizationId) {
    throw notFound('journal_entry_line_dimensions: tenant/organization scope required')
  }
  return { tenantId, organizationId }
}

async function loadPairRows(
  em: EntityManager,
  journalEntryLineId: string,
  dimensionType: string,
  scope: Scope,
): Promise<JournalEntryLineDimension[]> {
  return em.find(JournalEntryLineDimension, {
    journalEntryLineId,
    dimensionType,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}

/**
 * Check (2): `journalEntryLineId` names another row by id
 * (financial-command-implementation-checklist item 2) — loads it under the
 * caller's own tenant/organization and rejects when it does not exist, so a
 * mistyped or cross-tenant id never creates a row. A direct cross-module
 * entity read of `ledger.JournalEntryLine`, the same shipped shape `sales`
 * uses to read `catalog`'s `CatalogProduct`. Lines are append-only (never
 * soft-deleted), so there is no `deletedAt` to check.
 */
async function requireJournalEntryLine(
  em: EntityManager,
  journalEntryLineId: string,
  scope: Scope,
  translate: TranslateWithFallbackFn,
): Promise<JournalEntryLine> {
  // `ledger:journal_entry_line` carries an encrypted column
  // (`contractor_snapshot`), so the read goes through `findOneWithDecryption`
  // as root `AGENTS.md` requires for any cross-module entity read.
  const line = await findOneWithDecryption(
    em,
    JournalEntryLine,
    {
      id: journalEntryLineId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    {},
    scope,
  )
  if (!line) {
    throw notFound(
      translate('journal_entry_line_dimensions.errors.lineNotFound', 'Journal entry line not found.'),
    )
  }
  return line
}

/**
 * Check (3): tags of a closed period are frozen. Finds the `FiscalPeriod`
 * covering the line's entry `operationDate` — the lookup and the
 * `PESSIMISTIC_READ` (`for share`) lock mode `postJournalEntry` uses
 * (`requireCoveringUnlockedFiscalPeriod`, #6340) — and rejects when no period
 * covers the date or that period `isLocked`. Must run inside the write's
 * transaction: a concurrent `lockFiscalPeriod` takes the conflicting
 * `for update` lock, so it serializes with this write instead of letting a
 * tag land in a period an operator already closed. A change to a closed
 * period's cost-centre allocation is a correcting entry with its own tags
 * (ustawa o rachunkowości art. 25 ust. 1 pkt 2, ust. 2 — see the spec's
 * Risks, "Tags changing on lines in a locked fiscal period").
 */
async function requireUnlockedPeriodForLine(
  em: EntityManager,
  line: JournalEntryLine,
  scope: Scope,
  translate: TranslateWithFallbackFn,
): Promise<void> {
  const entry = await em.findOne(JournalEntry, {
    id: line.journalEntryId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!entry) {
    throw notFound(
      translate('journal_entry_line_dimensions.errors.lineNotFound', 'Journal entry line not found.'),
    )
  }
  const period = await em.findOne(
    FiscalPeriod,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      startDate: { $lte: entry.operationDate },
      endDate: { $gte: entry.operationDate },
    },
    { lockMode: LockMode.PESSIMISTIC_READ },
  )
  if (!period) {
    throw new CrudHttpError(422, {
      error: translate(
        'journal_entry_line_dimensions.errors.noFiscalPeriodForOperationDate',
        'No fiscal period covers the operation date of this journal entry, so its dimensions cannot be changed.',
      ),
    })
  }
  if (period.isLocked) {
    throw new CrudHttpError(422, {
      error: translate(
        'journal_entry_line_dimensions.errors.fiscalPeriodLocked',
        'The fiscal period covering this journal entry is locked. Post a correcting entry with its own dimensions instead.',
      ),
    })
  }
}

/**
 * Serializes concurrent writes to one `(line, dimensionType)` pair. A
 * transaction-scoped advisory lock keyed on the pair, issued through
 * `em.execute(...)` — never `em.getConnection().execute(...)`, which runs on
 * the pool client rather than the transaction's own connection (checklist
 * item 1) — and released automatically at commit/rollback. Without it two
 * deletes could both run before either insert and leave the union of both
 * sets; the unique constraint alone only prevents an identical row twice.
 */
async function lockPair(
  em: EntityManager,
  journalEntryLineId: string,
  dimensionType: string,
  scope: Scope,
): Promise<void> {
  const key = `journal_entry_line_dimensions:${scope.tenantId}:${scope.organizationId}:${journalEntryLineId}:${dimensionType}`
  await em.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [key])
}

/**
 * The ownership claim: the pair's existing rows must carry the same `writer`
 * as this call (or the pair must be untagged). A different writer is rejected
 * with a translated 409, never a silent replace.
 */
function assertWriterOwnsPair(
  existing: JournalEntryLineDimension[],
  writer: string,
  translate: TranslateWithFallbackFn,
): void {
  const foreign = existing.find((row) => row.writer !== writer)
  if (foreign) {
    throw conflict(
      translate(
        'journal_entry_line_dimensions.errors.writtenByAnotherWriter',
        'This dimension on the journal entry line is already set by another module ({writer}).',
        { writer: foreign.writer },
      ),
    )
  }
}

/**
 * Hard-deletes the current rows for the pair (scoped by tenant/org) and
 * inserts `dimensionIds` in their place with the claiming `writer`. Raw SQL
 * insert (not `em.create`/`em.persist`) so a duplicate `dimensionId` is a
 * no-op via `on conflict do nothing` against the
 * `journal_entry_line_dimensions_unique` constraint, instead of a second
 * identical row or a thrown unique violation.
 */
async function replacePairRows(em: EntityManager, write: PairWrite, scope: Scope): Promise<void> {
  await em.nativeDelete(JournalEntryLineDimension, {
    journalEntryLineId: write.journalEntryLineId,
    dimensionType: write.dimensionType,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  for (const dimensionId of write.dimensionIds) {
    await em.execute(
      `
        insert into journal_entry_line_dimensions
          (id, journal_entry_line_id, dimension_type, dimension_id, writer, tenant_id, organization_id, created_at)
        values
          (gen_random_uuid(), ?, ?, ?, ?, ?, ?, now())
        on conflict (journal_entry_line_id, dimension_type, dimension_id, tenant_id, organization_id)
        do nothing
      `,
      [write.journalEntryLineId, write.dimensionType, dimensionId, write.writer, scope.tenantId, scope.organizationId],
    )
  }
}

/**
 * The shared write path of `execute` and `undo`: line exists (2), covering
 * period unlocked (3), then — in the same transaction — advisory lock,
 * ownership check and delete-then-insert (4). Both callers run it inside
 * `withAtomicFlush(..., { transaction: true })`, so a failed insert rolls the
 * delete back and a rejected check leaves the rows untouched.
 *
 * `afterPairLocked` runs right after the advisory lock, on the transaction's
 * own `em`. `execute` passes `ctx.beforeTransactionalWrite` there, which the
 * command bus uses (`prepareSnapshotInsideTransaction`) to run `prepare`, so
 * the undo `before` state is read under the lock and cannot be overtaken by a
 * concurrent write to the same pair.
 */
async function applyPairWrite(
  em: EntityManager,
  write: PairWrite,
  scope: Scope,
  translate: TranslateWithFallbackFn,
  afterPairLocked?: (em: EntityManager) => Promise<void>,
): Promise<void> {
  const line = await requireJournalEntryLine(em, write.journalEntryLineId, scope, translate)
  await requireUnlockedPeriodForLine(em, line, scope, translate)
  await lockPair(em, write.journalEntryLineId, write.dimensionType, scope)
  await afterPairLocked?.(em)
  const existing = await loadPairRows(em, write.journalEntryLineId, write.dimensionType, scope)
  assertWriterOwnsPair(existing, write.writer, translate)
  await replacePairRows(em, write, scope)
}

const setJournalEntryLineDimensionCommand: CommandHandler<SetJournalEntryLineDimensionInput, SetDimensionResult> = {
  id: 'journal_entry_line_dimensions.dimensions.set',
  prepareSnapshotInsideTransaction: true,

  async prepare(rawInput, ctx) {
    const parsed = setJournalEntryLineDimensionSchema.parse(rawInput)
    const scope = resolveScope(ctx, parsed)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager)
    const rows = await loadPairRows(em, parsed.journalEntryLineId, parsed.dimensionType, scope)
    return { before: rows.map((row) => row.dimensionId) }
  },

  async execute(rawInput, ctx) {
    const parsed = setJournalEntryLineDimensionSchema.parse(rawInput)
    const scope = resolveScope(ctx, parsed)
    ensureTenantScope(ctx, scope.tenantId)
    ensureOrganizationScope(ctx, scope.organizationId)
    const { translate } = await resolveTranslations()

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await withAtomicFlush(
      em,
      [
        async () => {
          await applyPairWrite(em, parsed, scope, translate, async (lockedEm) => {
            await ctx.beforeTransactionalWrite?.(lockedEm, rawInput)
          })
        },
      ],
      { transaction: true },
    )

    return {
      journalEntryLineId: parsed.journalEntryLineId,
      dimensionType: parsed.dimensionType,
      writer: parsed.writer,
      dimensionIds: parsed.dimensionIds,
    }
  },

  buildLog: async ({ input, result, snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const scope = resolveScope(ctx, input)
    const before = (snapshots.before as string[] | undefined) ?? []
    return {
      actionLabel: translate('journal_entry_line_dimensions.audit.set', 'Set journal entry line dimension'),
      resourceKind: 'journal_entry_line_dimensions.dimension',
      resourceId: `${result.journalEntryLineId}:${result.dimensionType}`,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      payload: {
        undo: {
          journalEntryLineId: result.journalEntryLineId,
          dimensionType: result.dimensionType,
          writer: result.writer,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          before,
          after: result.dimensionIds,
        } satisfies SetDimensionUndoPayload,
      },
    }
  },

  /**
   * Restores the `before` rows for the pair under the same `writer` that made
   * the change, re-running the same checks as `execute`: an undo for a line
   * in a locked (or missing) period, or over rows another writer has since
   * claimed, is rejected — the freeze applies to undo exactly as to a write.
   */
  undo: async ({ ctx, logEntry }) => {
    const payload = extractUndoPayload<SetDimensionUndoPayload>(logEntry)
    if (!payload) return
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope: Scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }

    await withAtomicFlush(
      em,
      [
        async () => {
          await applyPairWrite(
            em,
            {
              journalEntryLineId: payload.journalEntryLineId,
              dimensionType: payload.dimensionType,
              writer: payload.writer,
              dimensionIds: payload.before,
            },
            scope,
            translate,
          )
        },
      ],
      { transaction: true },
    )
  },
}

registerCommand(setJournalEntryLineDimensionCommand)

export { setJournalEntryLineDimensionCommand }
