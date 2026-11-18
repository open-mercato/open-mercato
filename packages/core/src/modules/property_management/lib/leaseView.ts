import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Building, Floor, Lease, LeaseProposal, LeaseVersion, Unit } from '../data/entities'
import { OPEN_PROPOSAL_STATUSES } from './leaseOccupancy'
import { daysUntil, localToday } from './leaseTerm'
import { resolveUnitsAvailability } from './availabilityResolver'
import { leaseUnavailability } from './leaseAvailability'
import { loadSalesDocuments } from './salesLookups'
import type { Scope } from './productUse'
import { crmName, loadCrmRecords, type CrmAccess } from './crmAccess'

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
  companyName?: string | null
  primaryContactPersonId: string | null
  contactName?: string | null
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
  unitUnavailableFrom: string | null
  unitUnavailableUntil: string | null
  updatedAt: string
  createdAt: string
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)))
}

export type LeaseSummaryOptions = { crmAccess: CrmAccess; salesOrderNumbers?: boolean }

export async function summarizeLeases(
  em: EntityManager,
  scope: Scope,
  leases: readonly Lease[],
  options: LeaseSummaryOptions,
): Promise<LeaseSummary[]> {
  if (!leases.length) return []
  const leaseIds = leases.map((lease) => lease.id)
  const unitIds = uniqueIds(leases.map((lease) => lease.unitId))
  const buildingIds = uniqueIds(leases.map((lease) => lease.buildingId))
  const [units, buildings, customers, versions, proposals] = await Promise.all([
    findWithDecryption(em, Unit, { ...scope, id: { $in: unitIds } }, undefined, scope),
    findWithDecryption(em, Building, { ...scope, id: { $in: buildingIds } }, undefined, scope),
    loadCrmRecords(em, scope, options.crmAccess, {
      people: leases.map((lease) => lease.primaryContactPersonId),
      companies: leases.map((lease) => lease.customerCompanyId),
    }),
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
  const includeOrderNumbers = options.salesOrderNumbers !== false
  const orders = await loadSalesDocuments(em, scope, 'order', includeOrderNumbers ? uniqueIds(leases.map((lease) => lease.salesOrderId)) : [])
  const today = localToday()
  const availability = await resolveUnitsAvailability(em, scope, units, { start: `${today}T00:00`, end: null })
  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  const floorById = new Map(floors.map((floor) => [floor.id, floor]))
  const buildingById = new Map(buildings.map((building) => [building.id, building]))
  const proposalByLease = new Map(proposals.map((proposal) => [proposal.leaseId, proposal]))
  return leases.map((lease) => {
    const unit = unitById.get(lease.unitId)
    const leaseVersions = versions.filter((version) => version.leaseId === lease.id)
    const version = leaseVersions.find((entry) => entry.id === lease.currentVersionId) ?? leaseVersions[leaseVersions.length - 1] ?? null
    const proposal = proposalByLease.get(lease.id)
    const order = lease.salesOrderId ? orders.get(lease.salesOrderId) : null
    const unavailable = leaseUnavailability(lease, availability.get(lease.unitId) ?? [], today)
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
      ...(options.crmAccess.companies ? { companyName: crmName(customers, lease.customerCompanyId) } : {}),
      primaryContactPersonId: lease.primaryContactPersonId ?? null,
      ...(options.crmAccess.people ? { contactName: crmName(customers, lease.primaryContactPersonId) } : {}),
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
      unitUnavailable: unavailable !== null,
      unitUnavailableFrom: unavailable?.from ?? null,
      unitUnavailableUntil: unavailable?.until ?? null,
      updatedAt: lease.updatedAt.toISOString(),
      createdAt: lease.createdAt.toISOString(),
    }
  })
}
