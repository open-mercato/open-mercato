import { z } from 'zod'

/**
 * The closed set of dimension types a caller may set on a journal entry
 * line. Phase 1 carries `CostCenter` only — the one type with real,
 * named writers (see `DIMENSION_WRITERS`). An open string in the DB, not a
 * DB enum: the `dimension_type` column stays `text`, so adding a type here
 * is a one-line constant change plus a Zod-boundary deploy, not a migration
 * (see the spec's Design Decisions).
 */
export const DIMENSION_TYPES = ['CostCenter'] as const

export type DimensionType = (typeof DIMENSION_TYPES)[number]

/**
 * The modules allowed to own a `(line, dimensionType)` pair. A write by a
 * writer other than the one that owns the existing rows is rejected by the
 * command (see the spec's Design Decisions, "Writers and line ownership").
 * A new consumer adds its module id here.
 */
export const DIMENSION_WRITERS = ['posting_rules', 'fixed_assets'] as const

export type DimensionWriter = (typeof DIMENSION_WRITERS)[number]

/**
 * Input schema for the `journal_entry_line_dimensions.dimensions.set`
 * command. Replaces only the rows for one `(journalEntryLineId,
 * dimensionType)` pair on behalf of one `writer` — every other dimension
 * type already set on the same line is left untouched.
 *
 * `dimensionIds` entries are non-empty strings, not uuids: `dimension_id`
 * is an opaque reference (`text` column), so a later dimension type with a
 * non-uuid identifier needs no migration. Phase 1's `CostCenter` ids are
 * uuids.
 *
 * Validation messages: this schema has no HTTP route or form behind it (the
 * spec's API Contracts: "None") — it is parsed only inside the command,
 * called in-process by trusted writer modules (`DIMENSION_WRITERS`) with ids
 * they generated or loaded themselves. The shape checks below
 * (uuid/non-empty/enum) therefore never reach an end user and carry the
 * `[internal]` prefix (root AGENTS.md). The one rule a writer's own user
 * input can trip — duplicate `dimensionIds` — keeps its `i18nKey` so a
 * consumer surfacing it can translate it through `translateZodIssues`.
 */
export const setJournalEntryLineDimensionSchema = z
  .object({
    journalEntryLineId: z.uuid('[internal] journalEntryLineId must be a UUID'),
    dimensionType: z.enum(DIMENSION_TYPES, '[internal] dimensionType is not one of DIMENSION_TYPES'),
    writer: z.enum(DIMENSION_WRITERS, '[internal] writer is not one of DIMENSION_WRITERS'),
    dimensionIds: z
      .array(z.string().min(1, '[internal] a dimensionId must be a non-empty string'))
      .min(1, '[internal] dimensionIds must list at least one dimension'),
    // Optional scope for trusted, in-process systemActor callers
    // (`ctx.auth: null`, e.g. `posting_rules`' `reclassify.ts` engine, which
    // "posts on nobody's behalf"). The command's `resolveScope` consults
    // these only when `ctx.auth` carries no tenant, the same trusted-caller
    // shape `warranty_claims`' `VendorRecoveryInput.tenantId` already relies
    // on for its own systemActor subscriber call. A real end-user request
    // always carries `ctx.auth`, so these fields are never read for one.
    tenantId: z.uuid('[internal] tenantId must be a UUID').optional(),
    organizationId: z.uuid('[internal] organizationId must be a UUID').optional(),
  })
  .refine((v) => new Set(v.dimensionIds).size === v.dimensionIds.length, {
    message: 'The same dimension cannot be listed more than once.',
    path: ['dimensionIds'],
    params: {
      i18nKey: 'journal_entry_line_dimensions.errors.duplicateDimensionIds',
      i18nFallback: 'The same dimension cannot be listed more than once.',
    },
  })

export type SetJournalEntryLineDimensionInput = z.infer<typeof setJournalEntryLineDimensionSchema>
