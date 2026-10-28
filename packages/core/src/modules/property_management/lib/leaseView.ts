import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { Building, Floor, Lease, LeaseProposal, LeaseVersion, Unit } from '../data/entities'
import { OPEN_PROPOSAL_STATUSES } from './leaseOccupancy'
import { daysUntil, localToday } from './leaseTerm'
import { loadSalesDocuments } from './salesLookups'
import type { Scope } from './productUse'

export type LeaseSummary = {
  id: string
  reference: string
  status: string
  buildingId: string
  buildingName: string | null
  unitId: string
  unitName: string | null
  floorName: string | null
  customerCompanyId: string
  companyName: string | null
  primaryContactPersonId: string | null
  contactName: string | null
  startsOn: string
  termMonths: number
  endsOn: string
  daysLeft: number
  productName: string | null
  monthlyRate: string | null
  currencyCode: string | null
  salesOrderId: string | null
  salesOrderNumber: string | null
  openProposal: { id: string; kind: string; status: string; respondBy: string } | null
  pendingChange: { kind: string; changeId: string } | null
  billingPending: boolean
  billingAttention: boolean
  unitUnavailable: boolean
  updatedAt: string
  createdAt: string
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)))
}

export async function summarizeLeases(em: EntityManager, scope: Scope, leases: readonly Lease[]): Promise<LeaseSummary[]> {
  if (!leases.length) return []
  const leaseIds = leases.map((lease) => lease.id)
  const unitIds = uniqueIds(leases.map((lease) => lease.unitId))
  const buildingIds = uniqueIds(leases.map((lease) => lease.buildingId))
  const customerIds = uniqueIds(leases.flatMap((lease) => [lease.customerCompanyId, lease.primaryContactPersonId]))
  const [units, buildings, customers, versions, proposals] = await Promise.all([
    findWithDecryption(em, Unit, { ...scope, id: { $in: unitIds } }, undefined, scope),
    findWithDecryption(em, Building, { ...scope, id: { $in: buildingIds } }, undefined, scope),
    customerIds.length ? findWithDecryption(em, CustomerEntity, { ...scope, id: { $in: customerIds } }, undefined, scope) : [],
    findWithDecryption(em, LeaseVersion, { ...scope, leaseId: { $in: leaseIds } }, { orderBy: { versionNo: 'desc' } }, scope),
    findWithDecryption(
      em,
      LeaseProposal,
      { ...scope, leaseId: { $in: leaseIds }, status: { $in: [...OPEN_PROPOSAL_STATUSES] } },
      undefined,
      scope,
    ),
  ])
  const floors = await findWithDecryption(em, Floor, { ...scope, id: { $in: uniqueIds(units.map((unit) => unit.floorId)) } }, undefined, scope)
  const orders = await loadSalesDocuments(em, scope, 'order', uniqueIds(leases.map((lease) => lease.salesOrderId)))
  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  const floorById = new Map(floors.map((floor) => [floor.id, floor]))
  const buildingById = new Map(buildings.map((building) => [building.id, building]))
  const customerById = new Map(customers.map((customer) => [customer.id, customer]))
  const proposalByLease = new Map(proposals.map((proposal) => [proposal.leaseId, proposal]))
  const today = localToday()
  return leases.map((lease) => {
    const unit = unitById.get(lease.unitId)
    const leaseVersions = versions.filter((version) => version.leaseId === lease.id)
    const version = leaseVersions.find((entry) => entry.id === lease.currentVersionId) ?? leaseVersions[leaseVersions.length - 1] ?? null
    const proposal = proposalByLease.get(lease.id)
    const order = lease.salesOrderId ? orders.get(lease.salesOrderId) : null
    return {
      id: lease.id,
      reference: lease.reference,
      status: lease.status,
      buildingId: lease.buildingId,
      buildingName: buildingById.get(lease.buildingId)?.name ?? null,
      unitId: lease.unitId,
      unitName: unit?.name ?? null,
      floorName: unit ? floorById.get(unit.floorId)?.name ?? null : null,
      customerCompanyId: lease.customerCompanyId,
      companyName: customerById.get(lease.customerCompanyId)?.displayName ?? null,
      primaryContactPersonId: lease.primaryContactPersonId ?? null,
      contactName: lease.primaryContactPersonId ? customerById.get(lease.primaryContactPersonId)?.displayName ?? null : null,
      startsOn: lease.startsOn,
      termMonths: lease.termMonths,
      endsOn: lease.endsOn,
      daysLeft: daysUntil(lease.endsOn, today),
      productName: version?.productName ?? null,
      monthlyRate: version?.monthlyRate ?? null,
      currencyCode: version?.currencyCode ?? null,
      salesOrderId: lease.salesOrderId ?? null,
      salesOrderNumber: order?.number ?? null,
      openProposal: proposal ? { id: proposal.id, kind: proposal.kind, status: proposal.status, respondBy: proposal.respondBy } : null,
      pendingChange: lease.pendingChange ? { kind: lease.pendingChange.kind, changeId: lease.pendingChange.changeId } : null,
      billingPending: Boolean(lease.pendingChange) || lease.status === 'pending_order',
      billingAttention: lease.billingAttention,
      unitUnavailable: false,
      updatedAt: lease.updatedAt.toISOString(),
      createdAt: lease.createdAt.toISOString(),
    }
  })
}
