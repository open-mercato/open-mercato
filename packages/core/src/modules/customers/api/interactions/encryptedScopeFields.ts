import type { EntityId } from '@open-mercato/shared/modules/entities'
import { mapWithConcurrency } from '@open-mercato/shared/lib/query/bounded-decrypt'
import { resolveEncryptedSortFields, type QueryEncryptionService } from '@open-mercato/shared/lib/query/encrypted-sort'

const MAP_LOOKUP_CONCURRENCY = 8

/**
 * Encryption maps resolve per organization with first-match-wins: an organization's own
 * map replaces the tenant-wide one instead of merging with it. A list that spans several
 * organizations can therefore hold the same column as plaintext in one and as ciphertext
 * in another, and a decision taken from a single organization's map sends SQL `ILIKE` or
 * SQL ordering against the others' ciphertext.
 *
 * Returns the fields that are encrypted in at least one organization of the scope, so the
 * caller can take the decrypting path whenever any row in scope needs it.
 */
export async function resolveEncryptedFieldsAcrossOrganizations(params: {
  service: QueryEncryptionService | null | undefined
  entityId: EntityId
  fields: readonly string[]
  tenantId: string | null | undefined
  organizationIds: readonly (string | null)[]
}): Promise<Set<string>> {
  const distinctOrganizationIds = Array.from(new Set(params.organizationIds))
  const perOrganization = await mapWithConcurrency(
    distinctOrganizationIds,
    MAP_LOOKUP_CONCURRENCY,
    (organizationId) => resolveEncryptedSortFields(
      params.service,
      params.entityId,
      params.fields,
      params.tenantId,
      organizationId,
    ),
  )
  const encryptedInScope = new Set<string>()
  for (const organizationFields of perOrganization) {
    for (const field of organizationFields) encryptedInScope.add(field)
  }
  return encryptedInScope
}
