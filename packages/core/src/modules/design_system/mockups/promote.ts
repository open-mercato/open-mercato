import {
  collectLeaves,
  type MockupDocument,
  type MockupLeafNode,
} from './schema'
import {
  formFieldComposeSchema,
  tableComposeSchema,
  type ScaffoldFieldType,
} from './composeContracts'

/**
 * Promote bridge — spec `.ai/specs/2026-07-05-ds-live-mockup-composer.md`,
 * Phase 3. Derives the `mercato module scaffold --with-ui --fields` input
 * from a REVIEWED mockup: table blocks contribute their columns, form-field
 * blocks contribute their fields, both read back through the same schemas the
 * integrity gate already validated. The DERIVATION (this file, pure) is the
 * tested contract; executing the scaffold command is the CLI script's job and
 * happens only behind `--execute` plus a runtime availability check, because
 * the `module scaffold` subcommand ships on a separate branch (PR #4303).
 *
 * `--fields` DSL grammar targeted: `name:type[:required]` with types
 * text | textarea | number | select(a|b) | checkbox | date, camelCase names,
 * reserved names filtered with a report.
 */

/** Names the scaffold generator reserves — filtered from the DSL with a report. */
export const RESERVED_FIELD_NAMES = [
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'organizationId',
  'tenantId',
  'page',
  'pageSize',
  'search',
  'ids',
  'format',
  'full',
  'all',
  'exportScope',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
] as const

const RESERVED = new Set<string>(RESERVED_FIELD_NAMES)

/**
 * Chrome entries the `--with-ui` scaffold provides on its own (page header,
 * filter bar, form scaffolding, list states) — present in the mockup, covered
 * by the generated module, and therefore neither field sources nor "implement
 * manually" leftovers.
 */
export const SCAFFOLD_CHROME_ENTRY_IDS = [
  'section-header',
  'filter-bar',
  'form-header',
  'form-footer',
  'pagination',
  'empty-state',
] as const

export type PromoteField = {
  name: string
  type: ScaffoldFieldType
  required: boolean
  options?: string[]
  /** Block that first contributed the field. */
  blockId: string
}

export type PromoteSkippedField = { name: string; blockId: string; reason: string }

export type PromoteUnmappedBlock = { id: string; label: string; reason: string }

export type PromoteDerivation = {
  slug: string
  entity: string
  module: string
  fields: PromoteField[]
  fieldsDsl: string
  command: string
  /** Reserved or otherwise unusable field names, with the block and reason. */
  skippedFields: PromoteSkippedField[]
  /** Later duplicates folded into the first occurrence (required OR-merged). */
  mergedDuplicates: Array<{ name: string; blockId: string }>
  /** Blocks that don't map to scaffold input — "not scaffolded, implement manually". */
  unmapped: PromoteUnmappedBlock[]
}

export type PromoteResult =
  | { ok: true; derivation: PromoteDerivation }
  | { ok: false; error: string }

function fieldToDsl(field: PromoteField): string {
  const type =
    field.type === 'select' ? `select(${(field.options ?? []).join('|')})` : field.type
  return `${field.name}:${type}${field.required ? ':required' : ''}`
}

/** '/backend/<module>/…' → '<module>' — the route-hint module fallback. */
export function moduleFromRouteHint(routeHint: string | undefined): string | null {
  if (!routeHint) return null
  const match = /^\/backend\/([a-z0-9_-]+)(?:\/|$)/.exec(routeHint)
  return match ? match[1] : null
}

type CandidateField = {
  name: string
  type: ScaffoldFieldType
  required: boolean
  options?: string[]
  blockId: string
}

function collectCandidates(
  leaf: MockupLeafNode,
  unmapped: PromoteUnmappedBlock[],
): CandidateField[] {
  if (leaf.type === 'placeholder') {
    unmapped.push({
      id: leaf.id,
      label: leaf.label,
      reason: 'placeholder, no registry entry yet',
    })
    return []
  }
  if (leaf.entry === 'table') {
    if (leaf.props === undefined) {
      unmapped.push({
        id: leaf.id,
        label: 'table',
        reason: 'table block carries no columns props',
      })
      return []
    }
    const parsed = tableComposeSchema.safeParse(leaf.props)
    if (!parsed.success) {
      unmapped.push({ id: leaf.id, label: 'table', reason: 'table props fail the compose contract' })
      return []
    }
    return parsed.data.columns.map((column) => ({
      name: column.id,
      type: column.type ?? 'text',
      required: false,
      ...(column.options ? { options: column.options } : {}),
      blockId: leaf.id,
    }))
  }
  if (leaf.entry === 'form-field') {
    const parsed = formFieldComposeSchema.safeParse(leaf.props ?? {})
    if (!parsed.success) {
      unmapped.push({
        id: leaf.id,
        label: 'form-field',
        reason: 'form-field props fail the compose contract',
      })
      return []
    }
    return [
      {
        name: parsed.data.name,
        type: parsed.data.kind,
        required: parsed.data.required === true,
        ...(parsed.data.options ? { options: parsed.data.options } : {}),
        blockId: leaf.id,
      },
    ]
  }
  if (!(SCAFFOLD_CHROME_ENTRY_IDS as readonly string[]).includes(leaf.entry)) {
    unmapped.push({
      id: leaf.id,
      label: leaf.entry,
      reason: 'no scaffold mapping for this entry',
    })
  }
  return []
}

/**
 * The pure derivation: reviewed (non-draft) document in, exact scaffold
 * command out. Field order is tree order; duplicates fold into the first
 * occurrence with `required` OR-merged; reserved names are filtered with a
 * report, never silently dropped.
 */
export function derivePromotion(
  document: MockupDocument,
  opts: { entity?: string; module?: string } = {},
): PromoteResult {
  if (document.draft === true) {
    return {
      ok: false,
      error: `Mockup "${document.slug}" carries draft: true — review the draft and clear the flag (explicit finalize) before promoting; drafts are never auto-final.`,
    }
  }
  const entity = opts.entity ?? document.entity
  if (!entity) {
    return {
      ok: false,
      error: `Mockup "${document.slug}" names no target entity — set the document's "entity" hint or pass --entity.`,
    }
  }
  const moduleId =
    opts.module ?? document.module ?? moduleFromRouteHint(document.routeHint) ?? entity

  const unmapped: PromoteUnmappedBlock[] = []
  const fields: PromoteField[] = []
  const byName = new Map<string, PromoteField>()
  const skippedFields: PromoteSkippedField[] = []
  const mergedDuplicates: Array<{ name: string; blockId: string }> = []

  for (const leaf of collectLeaves(document.root)) {
    for (const candidate of collectCandidates(leaf, unmapped)) {
      if (RESERVED.has(candidate.name)) {
        skippedFields.push({
          name: candidate.name,
          blockId: candidate.blockId,
          reason: 'reserved name, the scaffold generator owns this field',
        })
        continue
      }
      if (candidate.type === 'select' && (!candidate.options || candidate.options.length === 0)) {
        skippedFields.push({
          name: candidate.name,
          blockId: candidate.blockId,
          reason: 'select field without options',
        })
        continue
      }
      const existing = byName.get(candidate.name)
      if (existing) {
        // First occurrence wins the type/options; required is OR-merged so a
        // required form field hardens the matching table column.
        existing.required = existing.required || candidate.required
        mergedDuplicates.push({ name: candidate.name, blockId: candidate.blockId })
        continue
      }
      const field: PromoteField = { ...candidate }
      byName.set(field.name, field)
      fields.push(field)
    }
  }

  if (fields.length === 0) {
    return {
      ok: false,
      error: `Mockup "${document.slug}" has no mappable table/form blocks — nothing to derive a --fields DSL from.`,
    }
  }

  const fieldsDsl = fields.map(fieldToDsl).join(',')
  const command = `yarn mercato module scaffold ${moduleId} --entity ${entity} --with-ui --fields "${fieldsDsl}"`

  return {
    ok: true,
    derivation: {
      slug: document.slug,
      entity,
      module: moduleId,
      fields,
      fieldsDsl,
      command,
      skippedFields,
      mergedDuplicates,
      unmapped,
    },
  }
}

/**
 * Runtime availability of `mercato module scaffold` from the CLI's own
 * `module` help text. On this branch the subcommand does not exist (it ships
 * with the module-scaffold PR #4303) and the help reads
 * "Usage: yarn mercato module <add|enable|eject> ..." — availability is the
 * word "scaffold" appearing in that usage output. Pure so it is testable; the
 * CLI script feeds it the captured output of `yarn mercato module help`.
 */
export function scaffoldAvailableFromHelp(helpOutput: string): boolean {
  return /\bscaffold\b/.test(helpOutput)
}
