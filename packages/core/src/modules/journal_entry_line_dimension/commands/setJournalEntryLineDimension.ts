import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { JournalEntryLineDimension } from '../data/entities'
import { JournalEntryLine } from '../../ledger/data/entities'
import { setJournalEntryLineDimensionSchema, type SetJournalEntryLineDimensionInput } from '../data/validators'

type Scope = {
  tenantId: string
  organizationId: string
}

type SetDimensionResult = {
  journalEntryLineId: string
  dimensionType: string
  dimensionIds: string[]
}

type SetDimensionUndoPayload = {
  journalEntryLineId: string
  dimensionType: string
  tenantId: string
  organizationId: string
  before: string[]
  after: string[]
}

/**
 * Resolves the acting scope from the runtime context rather than the input —
 * `setJournalEntryLineDimensionSchema` (per the spec's own quoted schema)
 * carries no `tenantId`/`organizationId` fields, since this command is only
 * ever called in-process by a trusted hard-dependency consumer
 * (`posting_rules`, later `fixed_assets`), never through an HTTP route. The
 * consumer's own `commandBus.execute(...)` call already carries its caller's
 * real auth/tenant context, so there is no separate "target org" a caller
 * could smuggle in through the input — deriving scope from `ctx` is exactly
 * as safe as validating an input-supplied id against `ctx` would be, with one
 * fewer place for the two to silently disagree.
 *
 * Honors the SELECTED organization (`ctx.selectedOrganizationId`), not just
 * `ctx.auth.orgId` — see `financial-command-implementation-checklist` item 3.
 */
function resolveScope(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw notFound('journal_entry_line_dimension: tenant/organization scope required')
  }
  return { tenantId, organizationId }
}

async function loadDimensionIds(
  em: EntityManager,
  journalEntryLineId: string,
  dimensionType: string,
  scope: Scope,
): Promise<string[]> {
  const rows = await em.find(JournalEntryLineDimension, {
    journalEntryLineId,
    dimensionType,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  return rows.map((row) => row.dimensionId)
}

/**
 * `journalEntryLineId` names another row by id (financial-command-
 * implementation-checklist item 2) — confirms it exists and belongs to the
 * caller's own tenant/organization before this command tags it. This is a
 * direct cross-module entity read of `ledger.JournalEntryLine`, the same
 * real, shipped shape the spec's own Design Decisions bless for the reverse
 * direction (`posting_rules`/`fixed_assets` reading this module's own
 * entity), matching `sales`'s real precedent of reading `catalog`'s
 * `CatalogProduct` directly. `ledger.JournalEntryLine` rows are append-only
 * (never soft-deleted, see GL core engine's Design Decisions), so there is
 * no `deletedAt` to check here.
 */
async function requireJournalEntryLine(em: EntityManager, journalEntryLineId: string, scope: Scope): Promise<void> {
  const line = await em.findOne(JournalEntryLine, {
    id: journalEntryLineId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!line) throw notFound('Journal entry line not found')
}

/**
 * Hard-deletes the current rows for one `(journalEntryLineId, dimensionType)`
 * pair (scoped by tenant/org) and inserts `dimensionIds` in their place. Raw
 * SQL insert (not `em.create`/`em.persist`) so a duplicate `dimensionId` —
 * from two overlapping calls racing past the delete — is a no-op via
 * `on conflict do nothing` against the `journal_entry_line_dimensions_unique`
 * constraint, instead of a second identical row or a thrown unique-violation.
 * Uses `em.execute(...)`, never `em.getConnection().execute(...)` — see
 * financial-command-implementation-checklist item 1 — so the insert joins
 * the caller's own transaction rather than committing on the raw pool client
 * independently of it.
 */
async function replaceDimensionRows(
  em: EntityManager,
  journalEntryLineId: string,
  dimensionType: string,
  dimensionIds: string[],
  scope: Scope,
): Promise<void> {
  await em.nativeDelete(JournalEntryLineDimension, {
    journalEntryLineId,
    dimensionType,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  for (const dimensionId of dimensionIds) {
    await em.execute(
      `
        insert into journal_entry_line_dimensions
          (id, journal_entry_line_id, dimension_type, dimension_id, tenant_id, organization_id, created_at)
        values
          (gen_random_uuid(), ?, ?, ?, ?, ?, now())
        on conflict (journal_entry_line_id, dimension_type, dimension_id, tenant_id, organization_id)
        do nothing
      `,
      [journalEntryLineId, dimensionType, dimensionId, scope.tenantId, scope.organizationId],
    )
  }
}

const setJournalEntryLineDimensionCommand: CommandHandler<SetJournalEntryLineDimensionInput, SetDimensionResult> = {
  id: 'journal_entry_line_dimension.setJournalEntryLineDimension',

  async prepare(rawInput, ctx) {
    const parsed = setJournalEntryLineDimensionSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadDimensionIds(em, parsed.journalEntryLineId, parsed.dimensionType, scope)
    return { before }
  },

  async execute(rawInput, ctx) {
    const parsed = setJournalEntryLineDimensionSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    ensureTenantScope(ctx, scope.tenantId)
    ensureOrganizationScope(ctx, scope.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await requireJournalEntryLine(em, parsed.journalEntryLineId, scope)

    await withAtomicFlush(
      em,
      [
        async () => {
          await replaceDimensionRows(em, parsed.journalEntryLineId, parsed.dimensionType, parsed.dimensionIds, scope)
        },
      ],
      { transaction: true },
    )

    return {
      journalEntryLineId: parsed.journalEntryLineId,
      dimensionType: parsed.dimensionType,
      dimensionIds: parsed.dimensionIds,
    }
  },

  buildLog: async ({ result, snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const scope = resolveScope(ctx)
    const before = (snapshots.before as string[] | undefined) ?? []
    return {
      actionLabel: translate('journal_entry_line_dimension.audit.set', 'Set journal entry line dimension'),
      resourceKind: 'journal_entry_line_dimension.dimension',
      resourceId: `${result.journalEntryLineId}:${result.dimensionType}`,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      payload: {
        undo: {
          journalEntryLineId: result.journalEntryLineId,
          dimensionType: result.dimensionType,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          before,
          after: result.dimensionIds,
        } satisfies SetDimensionUndoPayload,
      },
    }
  },

  undo: async ({ ctx, logEntry }) => {
    const payload = extractUndoPayload<SetDimensionUndoPayload>(logEntry)
    if (!payload) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope: Scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }

    await withAtomicFlush(
      em,
      [
        async () => {
          await replaceDimensionRows(em, payload.journalEntryLineId, payload.dimensionType, payload.before, scope)
        },
      ],
      { transaction: true },
    )
  },
}

registerCommand(setJournalEntryLineDimensionCommand)

export { setJournalEntryLineDimensionCommand }
