import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { createExternalIdMappingService } from '@open-mercato/core/modules/data_sync/lib/id-mapping'
import { withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { XERO_COMPANY_MAPPING_TYPE, XERO_INTEGRATION_ID } from '../constants'
import { formatContactExternalId } from '../external-ids'
import type { XeroScope } from '../owner'

export const XERO_CLAIM_LOCK_NAMESPACE = 'sync_xero_claim'
export const XERO_CLAIM_MAX_HOLDERS = 4

export type ClaimCompanyMappingInput = {
  em: EntityManager
  scope: XeroScope
  xeroOrganisationId: string
  contactId: string
  candidateEntityId: string
  allowDeletedTarget?: boolean
}

/**
 * `lost` with a winner: the Contact is already mapped to another Company, which the caller uses
 * (`winnerDeleted` when that Company was deleted in OM). `lost` without one: the candidate is
 * mapped to another Contact, so the caller drops it and matches again.
 */
export type ClaimCompanyMappingOutcome =
  | { outcome: 'won' }
  | { outcome: 'lost'; winnerEntityId: string; winnerDeleted: boolean }
  | { outcome: 'lost'; winnerEntityId: null }

export function xeroClaimLockKey(scope: XeroScope): string {
  return `${XERO_CLAIM_LOCK_NAMESPACE}:${scope.organizationId}`
}

async function companyExists(txEm: EntityManager, scope: XeroScope, entityId: string): Promise<boolean> {
  const company = await findOneWithDecryption(
    txEm,
    CustomerEntity,
    { id: entityId, organizationId: scope.organizationId, tenantId: scope.tenantId, kind: 'company', deletedAt: null },
    { fields: ['id'] },
    scope,
  )
  return company !== null
}

/**
 * App Spec § 6.1 "Company claim": under one advisory lock per OM organization, re-reads the
 * Contact's mapping and the candidate's mapping on the lock transaction and stores the mapping only
 * when both are free. A mapping that already names the candidate counts as won; one naming a
 * Company deleted in OM counts as free only with `allowDeletedTarget` (the invoices self-heal).
 * The callback does milliseconds of DB work and no Xero call or command; an
 * `AdvisoryLockUnavailableError` propagates and fails the run with `xero.claim_lock_unavailable`.
 */
export async function claimCompanyMapping(input: ClaimCompanyMappingInput): Promise<ClaimCompanyMappingOutcome> {
  const { scope, candidateEntityId } = input
  const externalId = formatContactExternalId(input.xeroOrganisationId, input.contactId)
  return withAdvisoryXactLock(
    input.em,
    xeroClaimLockKey(scope),
    async (txEm): Promise<ClaimCompanyMappingOutcome> => {
      const mappings = createExternalIdMappingService(txEm)
      const mappedEntityId = await mappings.lookupLocalId(XERO_INTEGRATION_ID, XERO_COMPANY_MAPPING_TYPE, externalId, scope)
      if (mappedEntityId === candidateEntityId) return { outcome: 'won' }
      if (mappedEntityId) {
        const live = await companyExists(txEm, scope, mappedEntityId)
        if (live || !input.allowDeletedTarget) return { outcome: 'lost', winnerEntityId: mappedEntityId, winnerDeleted: !live }
      }
      const candidateExternalId = await mappings.lookupExternalId(XERO_INTEGRATION_ID, XERO_COMPANY_MAPPING_TYPE, candidateEntityId, scope)
      if (candidateExternalId && candidateExternalId !== externalId) return { outcome: 'lost', winnerEntityId: null }
      await mappings.storeExternalIdMapping(XERO_INTEGRATION_ID, XERO_COMPANY_MAPPING_TYPE, candidateEntityId, externalId, scope)
      return { outcome: 'won' }
    },
    { maxConcurrentHolders: XERO_CLAIM_MAX_HOLDERS },
  )
}
