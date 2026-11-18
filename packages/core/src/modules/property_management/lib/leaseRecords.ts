import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import {
  CustomerEntity,
  CustomerPersonCompanyLink,
  CustomerPersonProfile,
} from '@open-mercato/core/modules/customers/data/entities'
import { Lease, LeaseProposal, LeaseVersion, Unit, UnitProductPeriod, type SalesOperation } from '../data/entities'
import { isBuildingPermitted, type PermittedBuildings } from './buildingAccess'
import { conflictError, notFoundError, unprocessableError } from './errors'
import { OPEN_PROPOSAL_STATUSES } from './leaseOccupancy'
import { formatAmount } from './money'
import { recordOperation } from './salesOperations'
import { periodPriceOf, type PriceContext, type PriceSnapshot, type Scope } from './productUse'

export type LeaseProduct = {
  catalogProductId: string
  productName: string
  currencyCode: string
}

export type LeaseParty = { companyId: string; companyName: string; contactPersonId: string | null }

export async function loadPermittedLease(
  em: EntityManager,
  scope: Scope,
  permitted: PermittedBuildings,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<Lease> {
  const where: Record<string, unknown> = { id, ...scope }
  if (!options.includeDeleted) where.deletedAt = null
  const lease = await findOneWithDecryption(em, Lease, where, undefined, scope)
  if (!lease || !isBuildingPermitted(permitted, lease.buildingId)) {
    throw await notFoundError('property_management.errors.leaseNotFound', 'Lease not found.')
  }
  return lease
}

export async function loadPermittedUnit(em: EntityManager, scope: Scope, permitted: PermittedBuildings, unitId: string): Promise<Unit> {
  const unit = await findOneWithDecryption(em, Unit, { id: unitId, ...scope, deletedAt: null }, undefined, scope)
  if (!unit || !isBuildingPermitted(permitted, unit.buildingId)) {
    throw await unprocessableError('property_management.errors.unitNotFound', 'Unit not found.', {
      fieldErrors: { unitId: 'property_management.errors.unitNotFound' },
    })
  }
  return unit
}

export async function lockUnitRow(
  em: EntityManager,
  scope: Scope,
  unitId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<Unit> {
  const where: Record<string, unknown> = { id: unitId, ...scope }
  if (!options.includeDeleted) where.deletedAt = null
  const unit = await findOneWithDecryption(em, Unit, where, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope)
  if (!unit) throw await unprocessableError('property_management.errors.unitNotFound', 'Unit not found.')
  return unit
}

export async function lockLeaseRow(em: EntityManager, scope: Scope, leaseId: string): Promise<Lease> {
  const lease = await findOneWithDecryption(em, Lease, { id: leaseId, ...scope }, { refresh: true }, scope)
  if (!lease) throw await notFoundError('property_management.errors.leaseNotFound', 'Lease not found.')
  await lockUnitRow(em, scope, lease.unitId, { includeDeleted: true })
  const locked = await findOneWithDecryption(em, Lease, { id: leaseId, ...scope }, { refresh: true }, scope)
  if (!locked || locked.deletedAt) throw await notFoundError('property_management.errors.leaseNotFound', 'Lease not found.')
  return locked
}

async function personBelongsToCompany(em: EntityManager, scope: Scope, personId: string, companyId: string): Promise<boolean> {
  const profile = await findOneWithDecryption(em, CustomerPersonProfile, { entity: personId, company: companyId, ...scope }, undefined, scope)
  if (profile) return true
  const link = await findOneWithDecryption(
    em,
    CustomerPersonCompanyLink,
    { person: personId, company: companyId, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  return Boolean(link)
}

export async function resolveLeaseParty(
  em: EntityManager,
  scope: Scope,
  companyId: string,
  contactPersonId: string | null | undefined,
): Promise<LeaseParty> {
  const company = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: companyId, ...scope, kind: 'company', deletedAt: null },
    undefined,
    scope,
  )
  if (!company) {
    throw await unprocessableError('property_management.errors.companyNotFound', 'The tenant company is not a company of this organization.', {
      fieldErrors: { customerCompanyId: 'property_management.errors.companyNotFound' },
    })
  }
  if (!contactPersonId) return { companyId: company.id, companyName: company.displayName, contactPersonId: null }
  const person = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: contactPersonId, ...scope, kind: 'person', deletedAt: null },
    undefined,
    scope,
  )
  if (!person || !(await personBelongsToCompany(em, scope, person.id, company.id))) {
    throw await unprocessableError('property_management.errors.contactNotInCompany', 'The contact person does not belong to the tenant company.', {
      fieldErrors: { primaryContactPersonId: 'property_management.errors.contactNotInCompany' },
    })
  }
  return { companyId: company.id, companyName: company.displayName, contactPersonId: person.id }
}

export type ResolvedLeaseProduct = { product: LeaseProduct; periodPrice: PriceSnapshot; periodId: string }

export async function resolveLeaseProduct(
  em: EntityManager,
  container: AwilixContainer,
  scope: Scope,
  unit: Unit,
  priceContext: PriceContext = {},
): Promise<ResolvedLeaseProduct> {
  const period = await findOneWithDecryption(em, UnitProductPeriod, { ...scope, unitId: unit.id, validTo: null }, undefined, scope)
  if (!period || period.use !== 'leasable') {
    throw await unprocessableError('property_management.errors.unitNotLeasable', 'This unit is not leasable.', {
      code: 'unit_not_leasable',
      fieldErrors: { unitId: 'property_management.errors.unitNotLeasable' },
    })
  }
  const product = await findOneWithDecryption(
    em,
    CatalogProduct,
    { id: period.catalogProductId, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  if (!product) {
    throw await unprocessableError('property_management.errors.unitProductMissing', 'The unit has no product. Set a product before leasing it.', {
      code: 'unit_product_missing',
    })
  }
  const price = await periodPriceOf(em, container, scope, period, priceContext)
  if (!price.currencyCode) {
    throw await unprocessableError('property_management.errors.leaseCurrencyMissing', 'The unit product has no price, so the lease currency is unknown.', {
      code: 'lease_currency_missing',
    })
  }
  return {
    product: { catalogProductId: period.catalogProductId, productName: period.productName, currencyCode: price.currencyCode },
    periodPrice: price,
    periodId: period.id,
  }
}

export async function assertLeaseProductUnchanged(em: EntityManager, scope: Scope, unitId: string, periodId: string): Promise<void> {
  const period = await findOneWithDecryption(em, UnitProductPeriod, { ...scope, unitId, validTo: null }, { refresh: true }, scope)
  if (!period || period.id !== periodId || period.use !== 'leasable') {
    throw await conflictError('property_management.errors.leaseProductChanged', 'The unit product changed meanwhile. Reload and try again.', {
      code: 'lease_product_changed',
    })
  }
}

export function leaseProductOf(version: LeaseVersion): LeaseProduct {
  return {
    catalogProductId: version.catalogProductId,
    productName: version.productName,
    currencyCode: version.currencyCode ?? '',
  }
}

export type LeaseDocumentInput = {
  lease: Lease
  product: LeaseProduct
  channelId: string
  startsOn: string
  months: number
  monthlyRate: number | string
  anchorDay?: number | null
  versionId: string
}

function recurrenceOf(input: LeaseDocumentInput) {
  return {
    frequency: 'monthly',
    startsOn: input.startsOn,
    periodCount: input.months,
    ...(input.anchorDay ? { anchorDay: input.anchorDay } : {}),
  }
}

function documentBase(input: LeaseDocumentInput): Record<string, unknown> {
  const rate = formatAmount(input.monthlyRate)
  return {
    channelId: input.channelId,
    customerEntityId: input.lease.customerCompanyId,
    ...(input.lease.primaryContactPersonId ? { customerContactId: input.lease.primaryContactPersonId } : {}),
    currencyCode: input.product.currencyCode,
    recurrence: recurrenceOf(input),
    metadata: {
      propertyManagementLeaseId: input.lease.id,
      propertyManagementLeaseReference: input.lease.reference,
      propertyManagementVersionId: input.versionId,
    },
    lines: [
      {
        kind: 'product',
        productId: input.product.catalogProductId,
        name: input.product.productName,
        quantity: '1',
        unitPriceNet: rate,
        currencyCode: input.product.currencyCode,
      },
    ],
  }
}

export function buildLeaseOrderPayload(input: LeaseDocumentInput): Record<string, unknown> {
  return { ...documentBase(input), externalReference: input.lease.reference }
}

export function buildLeaseQuotePayload(
  input: LeaseDocumentInput & { respondBy: string; sentStatusEntryId: string | null },
): Record<string, unknown> {
  return {
    ...documentBase(input),
    validUntil: input.respondBy,
    ...(input.sentStatusEntryId ? { statusEntryId: input.sentStatusEntryId } : {}),
  }
}

export async function nextVersionNo(em: EntityManager, scope: Scope, leaseId: string): Promise<number> {
  const versions = await findWithDecryption(em, LeaseVersion, { ...scope, leaseId }, { orderBy: { versionNo: 'desc' }, limit: 1 }, scope)
  return (versions[0]?.versionNo ?? 0) + 1
}

export async function findOpenProposals(em: EntityManager, scope: Scope, leaseId: string): Promise<LeaseProposal[]> {
  return findWithDecryption(
    em,
    LeaseProposal,
    { ...scope, leaseId, status: { $in: [...OPEN_PROPOSAL_STATUSES] } },
    { refresh: true },
    scope,
  )
}

export async function closeProposal(
  em: EntityManager,
  scope: Scope,
  lease: Lease,
  proposal: LeaseProposal,
  status: 'withdrawn' | 'expired',
): Promise<SalesOperation | null> {
  const recorded: { operation: SalesOperation | null } = { operation: null }
  await withAtomicFlush(
    em,
    [
      async () => {
        const version = proposal.versionId
          ? await findOneWithDecryption(em, LeaseVersion, { id: proposal.versionId, ...scope }, undefined, scope)
          : null
        proposal.status = status
        proposal.holdToken = null
        proposal.updatedAt = new Date()
        if (version && version.state === 'pending') version.state = 'reverted'
        if (proposal.kind === 'new' && lease.status === 'proposed') {
          lease.status = status
          lease.updatedAt = new Date()
        }
      },
      async () => {
        if (!proposal.salesQuoteId) return
        recorded.operation = await recordOperation(em, scope, {
          kind: 'quote_status',
          subjectKey: `quote_status:${proposal.id}:canceled`,
          payload: { quoteId: proposal.salesQuoteId, status: 'canceled' },
          targetType: 'lease_proposal',
          targetId: proposal.id,
          leaseId: lease.id,
        })
      },
    ],
    { label: 'property_management.lease_proposal.close' },
  )
  return recorded.operation
}
