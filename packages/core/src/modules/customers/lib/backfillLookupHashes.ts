import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import { hashForLookup, isEncryptedPayloadShape, looksLikeEncryptedPayload } from '@open-mercato/shared/lib/encryption/aes'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { normalizeColumnName } from '@open-mercato/shared/lib/query/ciphertext-search-warning'
import { reportTelemetryError } from '@open-mercato/shared/lib/telemetry/runtime'

const BATCH_SIZE = 500
const targets = [
  { entityId: 'customers:customer_entity', table: 'customer_entities', field: 'primary_email', hashField: 'primary_email_hash' },
  { entityId: 'customers:customer_company_profile', table: 'customer_companies', field: 'domain', hashField: 'domain_hash' },
] as const

type LookupTarget = typeof targets[number]
type Scope = { tenantId: string; organizationId: string }
type BackfillOptions = Partial<Scope> & { dryRun: boolean }
type OrganizationRow = { id: string; tenant_id: string }
type BackfillDatabase = { organizations: OrganizationRow }
type Encryption = Pick<TenantDataEncryptionService, 'getEncryptedFieldNames' | 'getLookupHashRules' | 'decryptEntityPayload'>

export type LookupHashBackfillReport = Scope & { field: LookupTarget['field'] } & (
  | { status: 'unprotected-field' | 'unreconciled-map' | 'no-pepper' }
  | { status: 'processed'; changed: number; undecryptable: number; concurrentChanges: number }
)

function isCiphertext(value: string): boolean {
  return looksLikeEncryptedPayload(value) || isEncryptedPayloadShape(value)
}

async function backfillTarget(
  em: EntityManager,
  db: Kysely<BackfillDatabase>,
  encryption: Encryption,
  scope: Scope,
  target: LookupTarget,
  dryRun: boolean,
  hasPepper: boolean,
): Promise<LookupHashBackfillReport> {
  const report = { ...scope, field: target.field }
  const encryptedFields = await encryption.getEncryptedFieldNames(
    target.entityId, scope.tenantId, scope.organizationId, { ignoreRuntimeHealth: true, em },
  )
  if (!encryptedFields.some((field) => normalizeColumnName(field) === target.field)) {
    return { ...report, status: 'unprotected-field' }
  }

  const rules = await encryption.getLookupHashRules(target.entityId, scope.tenantId, scope.organizationId)
  if (!rules.some(({ field, hashField }) =>
    normalizeColumnName(field) === target.field && normalizeColumnName(hashField) === target.hashField,
  )) {
    return { ...report, status: 'unreconciled-map' }
  }
  if (!hasPepper) return { ...report, status: 'no-pepper' }

  const table = sql.table(target.table)
  const sourceColumn = sql.ref(target.field)
  const hashColumn = sql.ref(target.hashField)
  let afterId: string | undefined
  let changed = 0
  let undecryptable = 0
  let concurrentChanges = 0
  while (true) {
    const afterFilter = afterId ? sql`and id > ${afterId}` : sql``
    const { rows } = await sql<{ id: string; source: string }>`
      select id, ${sourceColumn} as source from ${table}
      where tenant_id = ${scope.tenantId} and organization_id = ${scope.organizationId}
        and ${sourceColumn} is not null and ${hashColumn} is null ${afterFilter}
      order by id limit ${BATCH_SIZE}`
      .execute(db)
    for (const row of rows) {
      let plaintext: unknown = row.source
      if (isCiphertext(row.source)) {
        const payload = await encryption.decryptEntityPayload(
          target.entityId, { [target.field]: row.source }, scope.tenantId, scope.organizationId, { em },
        )
        plaintext = payload[target.field]
      }
      if (typeof plaintext !== 'string' || isCiphertext(plaintext)) {
        undecryptable += 1
        continue
      }

      if (!dryRun) {
        const hash = hashForLookup(plaintext)
        const updated = await sql<{ id: string }>`
          update ${table} set ${hashColumn} = ${hash}
          where id = ${row.id} and tenant_id = ${scope.tenantId} and organization_id = ${scope.organizationId}
            and ${sourceColumn} = ${row.source} and ${hashColumn} is null
          returning id`
          .execute(db)
          .catch(() => {
            const error = new Error('[internal] CRM lookup hash update failed. Check the database connection and permissions before retrying.')
            reportTelemetryError(error, { module: 'customers', code: 'customers.lookup_hash_backfill_write_failed', attributes: report })
            throw error
          })
        if (updated.rows.length === 0) {
          concurrentChanges += 1
          continue
        }
      }
      changed += 1
    }
    if (rows.length < BATCH_SIZE) break
    afterId = rows.at(-1)?.id
  }
  return { ...report, status: 'processed', changed, undecryptable, concurrentChanges }
}

export async function backfillCustomerLookupHashes(
  em: EntityManager,
  encryption: Encryption,
  options: BackfillOptions,
  onReport: (report: LookupHashBackfillReport) => void,
): Promise<boolean> {
  const hasPepper = hashForLookup('customer-lookup-backfill-pepper-check').startsWith('v2:')
  const db = em.getKysely<BackfillDatabase>()
  let scopes = db.selectFrom('organizations').select(['id', 'tenant_id']).orderBy('id').limit(BATCH_SIZE)
  if (options.tenantId) scopes = scopes.where('tenant_id', '=', options.tenantId)
  if (options.organizationId) scopes = scopes.where('id', '=', options.organizationId)

  let complete = true
  let afterId: string | undefined
  while (true) {
    const organizations: OrganizationRow[] = await (afterId ? scopes.where('id', '>', afterId) : scopes).execute()
    for (const organization of organizations) {
      const scope = { tenantId: organization.tenant_id, organizationId: organization.id }
      for (const target of targets) {
        const report = await backfillTarget(em, db, encryption, scope, target, options.dryRun, hasPepper)
        onReport(report)
        if (report.status === 'unprotected-field') continue
        if (report.status !== 'processed' || report.undecryptable > 0 || report.concurrentChanges > 0) {
          complete = false
        }
      }
    }
    if (organizations.length < BATCH_SIZE) break
    afterId = organizations.at(-1)?.id
  }
  return complete
}
