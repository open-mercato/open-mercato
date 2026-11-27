import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { decryptCustomFieldValue } from '@open-mercato/shared/lib/encryption/customFieldValues'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import {
  CustomerCompanyProfile,
  CustomerEntity,
  CustomerInteraction,
  CustomerPersonProfile,
} from '../../data/entities'
import type { CustomFieldDefIndex } from './encryption'
import { ENCRYPTION_ENTITY_BY_TABLE, buildEntityBundle } from './generator'
import { countScopedRows, countTagsBySlug, selectCustomFieldRows, selectRowsByIds, type PerfSeedDb } from './insert'
import { MANIFEST_COUNT_KEYS, type EntityBundle, type GeneratorContext, type ManifestCounts, type SqlRow } from './types'

export type VerifyResult = {
  ok: boolean
  failures: string[]
  checked: { counts: number; rows: number }
}

export const VERIFY_SAMPLE_SIZE = 100

export function sampleEntityIndices(entityCount: number, size: number = VERIFY_SAMPLE_SIZE): number[] {
  const indices = new Set<number>()
  const total = Math.min(size, entityCount)
  for (let position = 0; position < total; position += 1) {
    indices.add(Math.floor((position * entityCount) / total))
  }
  return Array.from(indices)
}

export type CountComparison = { table: string; expected: number; actual: number }

export function compareCounts(
  expected: ManifestCounts,
  baseline: ManifestCounts,
  current: ManifestCounts,
  tagCount: number,
): CountComparison[] {
  return MANIFEST_COUNT_KEYS.map((key) => ({
    table: key,
    expected: expected[key],
    actual: key === 'customer_tags' ? tagCount : current[key] - baseline[key],
  }))
}

export async function captureTableCounts(db: PerfSeedDb, ctx: Pick<GeneratorContext, 'scope'>): Promise<ManifestCounts> {
  const counts = {} as ManifestCounts
  for (const key of MANIFEST_COUNT_KEYS) {
    counts[key] = await countScopedRows(db, key, ctx.scope)
  }
  return counts
}

function sameValue(expected: unknown, actual: unknown): boolean {
  if (expected === null || expected === undefined) return actual === null || actual === undefined
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime()
  return String(expected) === String(actual)
}

function compareFields(
  label: string,
  expectedRow: SqlRow,
  actual: Record<string, unknown> | undefined,
  mapping: Record<string, string>,
  failures: string[],
): void {
  if (!actual) {
    failures.push(`${label}: row missing`)
    return
  }
  for (const [column, property] of Object.entries(mapping)) {
    if (!sameValue(expectedRow[column], actual[property])) {
      failures.push(`${label}: ${column} decrypted value does not match generated plaintext`)
    }
  }
}

async function assertCiphertextAtRest(
  db: PerfSeedDb,
  service: TenantDataEncryptionService | null,
  ctx: GeneratorContext,
  table: 'customer_entities' | 'customer_people' | 'customer_interactions',
  expectedRows: SqlRow[],
  failures: string[],
): Promise<void> {
  if (!service || !service.isEnabled() || !expectedRows.length) return
  const fields = await service.getEncryptedFieldNames(ENCRYPTION_ENTITY_BY_TABLE[table], ctx.scope.tenantId, ctx.scope.organizationId)
  if (!fields.length) return
  const rawRows = await selectRowsByIds(db, table, expectedRows.map((row) => String(row.id)))
  const rawById = new Map(rawRows.map((row) => [String(row.id), row]))
  for (const expected of expectedRows) {
    const raw = rawById.get(String(expected.id))
    if (!raw) continue
    for (const field of fields) {
      const column = field.replace(/([A-Z])/g, '_$1').toLowerCase()
      const plaintext = expected[column]
      if (typeof plaintext !== 'string' || !plaintext.length) continue
      if (raw[column] === plaintext) failures.push(`${table}.${column}: stored as plaintext for ${String(expected.id)} while encryption is enabled`)
    }
  }
}

async function verifyCustomFields(
  db: PerfSeedDb,
  service: TenantDataEncryptionService | null,
  ctx: GeneratorContext,
  defs: CustomFieldDefIndex,
  bundles: EntityBundle[],
  failures: string[],
): Promise<number> {
  const drafts = bundles.flatMap((bundle) => bundle.customFields).filter((draft) => draft.entityId !== ENCRYPTION_ENTITY_BY_TABLE.customer_interactions)
  if (!drafts.length) return 0
  const rows = await selectCustomFieldRows(db, ctx.scope, Array.from(new Set(drafts.map((draft) => draft.recordId))))
  const byKey = new Map(rows.map((row) => [`${String(row.entity_id)}|${String(row.record_id)}|${String(row.field_key)}`, row]))
  const cache = new Map<string | null, string | null>()
  for (const draft of drafts) {
    const row = byKey.get(`${draft.entityId}|${draft.recordId}|${draft.fieldKey}`)
    if (!row) {
      failures.push(`custom_field_values: missing ${draft.entityId}.${draft.fieldKey} for ${draft.recordId}`)
      continue
    }
    const definition = defs.get(draft.entityId)?.get(draft.fieldKey) ?? null
    const stored = row.value_text ?? row.value_multiline ?? row.value_int ?? row.value_float ?? row.value_bool ?? null
    const decoded = definition?.encrypted
      ? await decryptCustomFieldValue(stored, ctx.scope.tenantId, service, cache, { kind: definition.kind })
      : stored
    if (String(decoded) !== String(draft.value)) {
      failures.push(`custom_field_values: ${draft.entityId}.${draft.fieldKey} for ${draft.recordId} does not round-trip`)
    }
  }
  return drafts.length
}

export async function verifySeed(input: {
  ctx: GeneratorContext
  db: PerfSeedDb
  em: EntityManager
  service: TenantDataEncryptionService | null
  customFieldDefs: CustomFieldDefIndex
  expected: ManifestCounts
  baseline: ManifestCounts
  tagSlugs: string[]
}): Promise<VerifyResult> {
  const { ctx, db, em, service } = input
  const failures: string[] = []
  const current = await captureTableCounts(db, ctx)
  const tagCount = await countTagsBySlug(db, ctx.scope, input.tagSlugs)
  const comparisons = compareCounts(input.expected, input.baseline, current, tagCount)
  for (const comparison of comparisons) {
    if (comparison.actual !== comparison.expected) {
      failures.push(`count ${comparison.table}: expected ${comparison.expected}, found ${comparison.actual}`)
    }
  }

  const bundles = sampleEntityIndices(ctx.entityCount).map((index) => buildEntityBundle(ctx, index))
  const scope = { tenantId: ctx.scope.tenantId, organizationId: ctx.scope.organizationId, encryptionService: service }
  const entityRows = bundles.flatMap((bundle) => bundle.rows.customer_entities)
  const personRows = bundles.flatMap((bundle) => bundle.rows.customer_people)
  const companyRows = bundles.flatMap((bundle) => bundle.rows.customer_companies)
  const interactionRows = bundles.flatMap((bundle) => bundle.rows.customer_interactions.slice(0, 1))
  const baseWhere = { tenantId: ctx.scope.tenantId, organizationId: ctx.scope.organizationId }

  const entities = await findWithDecryption(em, CustomerEntity, { ...baseWhere, id: { $in: entityRows.map((row) => String(row.id)) } }, {}, scope)
  const entityById = new Map(entities.map((entity) => [entity.id, entity as unknown as Record<string, unknown>]))
  for (const row of entityRows) {
    compareFields(`customer_entities ${String(row.id)}`, row, entityById.get(String(row.id)), {
      display_name: 'displayName',
      primary_email: 'primaryEmail',
      primary_phone: 'primaryPhone',
      description: 'description',
      next_interaction_name: 'nextInteractionName',
      next_interaction_ref_id: 'nextInteractionRefId',
    }, failures)
  }

  const people = personRows.length
    ? await findWithDecryption(em, CustomerPersonProfile, { ...baseWhere, id: { $in: personRows.map((row) => String(row.id)) } }, {}, scope)
    : []
  const personById = new Map(people.map((person) => [person.id, person as unknown as Record<string, unknown>]))
  for (const row of personRows) {
    compareFields(`customer_people ${String(row.id)}`, row, personById.get(String(row.id)), {
      first_name: 'firstName',
      last_name: 'lastName',
      job_title: 'jobTitle',
      linked_in_url: 'linkedInUrl',
    }, failures)
  }

  const companies = companyRows.length
    ? await findWithDecryption(em, CustomerCompanyProfile, { ...baseWhere, id: { $in: companyRows.map((row) => String(row.id)) } }, {}, scope)
    : []
  const companyById = new Map(companies.map((company) => [company.id, company as unknown as Record<string, unknown>]))
  for (const row of companyRows) {
    compareFields(`customer_companies ${String(row.id)}`, row, companyById.get(String(row.id)), {
      legal_name: 'legalName',
      brand_name: 'brandName',
      domain: 'domain',
      tax_id: 'taxId',
    }, failures)
  }

  const interactions = interactionRows.length
    ? await findWithDecryption(em, CustomerInteraction, { ...baseWhere, id: { $in: interactionRows.map((row) => String(row.id)) } }, {}, scope)
    : []
  const interactionById = new Map(interactions.map((interaction) => [interaction.id, interaction as unknown as Record<string, unknown>]))
  for (const row of interactionRows) {
    compareFields(`customer_interactions ${String(row.id)}`, row, interactionById.get(String(row.id)), {
      title: 'title',
      body: 'body',
      status: 'status',
    }, failures)
  }

  await assertCiphertextAtRest(db, service, ctx, 'customer_entities', entityRows, failures)
  await assertCiphertextAtRest(db, service, ctx, 'customer_people', personRows, failures)
  await assertCiphertextAtRest(db, service, ctx, 'customer_interactions', interactionRows, failures)
  const customFieldChecks = await verifyCustomFields(db, service, ctx, input.customFieldDefs, bundles, failures)

  return {
    ok: failures.length === 0,
    failures,
    checked: {
      counts: comparisons.length,
      rows: entityRows.length + personRows.length + companyRows.length + interactionRows.length + customFieldChecks,
    },
  }
}
