import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  Booking,
  Lease,
  LeaseProposal,
  type BookingStatus,
  type LeaseStatus,
  type ProductUseKind,
  type UnavailabilitySubjectType,
} from '../data/entities'
import {
  firstSpanFrom,
  loadUnavailabilities,
  unavailableDuring,
  windowsForUnit,
  type AvailabilitySource,
  type UnavailabilityWindow,
  type UnitPlacement,
} from './availabilityResolver'
import { OPEN_PROPOSAL_STATUSES, RESERVING_LEASE_STATUSES } from './leaseOccupancy'
import { compareIsoDates, daysUntil, reservedInterval } from './leaseTerm'
import { loadSettings } from './settings'
import { loadReasonLabels } from './unavailabilityReasons'
import { endOfDay, normalizeWallClock, startOfDay, toStoredWallClock } from './wallClock'
import type { Scope } from './productUse'
import { loadCrmRecords, type CrmAccess } from './crmAccess'

export type FloorUnitStatus = 'occupied' | 'available' | 'unavailable' | 'booked' | 'free'

export const IN_FORCE_LEASE_STATUSES: readonly LeaseStatus[] = ['pending_order', 'active', 'ended']
export const DAY_BOOKING_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed', 'completed']

export type StatusLease = Pick<
  Lease,
  'id' | 'reference' | 'status' | 'unitId' | 'startsOn' | 'endsOn' | 'customerCompanyId' | 'primaryContactPersonId' | 'pendingChange'
>
export type StatusProposal = Pick<LeaseProposal, 'id' | 'leaseId' | 'kind' | 'status' | 'respondBy' | 'startsOn' | 'endsOn'>
export type StatusBooking = Pick<
  Booking,
  'id' | 'unitId' | 'status' | 'startsAt' | 'endsAt' | 'billingUnit' | 'productName' | 'bookedByPersonId' | 'customerCompanyId'
>
export type ContactInfo = { name: string | null; email: string | null }

export { CRM_COMPANIES_VIEW_FEATURE, CRM_PEOPLE_VIEW_FEATURE, NO_CRM_ACCESS, resolveCrmAccess, type CrmAccess } from './crmAccess'

export type FloorPlanLease = {
  id: string
  reference: string
  status: LeaseStatus
  startsOn: string
  endsOn: string
  daysLeft: number
  customerCompanyId: string
  companyName?: string | null
  contactPersonId: string | null
  contactName?: string | null
  contactEmail?: string | null
  extensionRespondBy: string | null
  extensionStatus: StatusProposal['status'] | null
}

export type FloorPlanProposal = {
  id: string | null
  leaseId: string
  reference: string
  status: StatusProposal['status'] | null
  respondBy: string | null
  startsOn: string
  endsOn: string
  customerCompanyId: string
  companyName?: string | null
}

export type FloorPlanBooking = {
  id: string
  status: BookingStatus
  startsAt: string
  endsAt: string
  billingUnit: string
  productName: string
  personId: string
  personName?: string | null
  companyId: string | null
  companyName?: string | null
}

export type FloorPlanUnavailability = {
  source: AvailabilitySource
  reasonLabel: string | null
  reasonText: string | null
  from: string | null
  until: string | null
}

export type ReasonLabels = ReadonlyMap<string, string>

const NO_REASON_LABELS: ReasonLabels = new Map()

export type FloorPlanReservation = { leaseId: string; reference: string; until: string }

export type UnitStatusProjection = {
  status: FloorUnitStatus
  lease: FloorPlanLease | null
  leaseEnding: boolean
  proposed: boolean
  proposal: FloorPlanProposal | null
  bookings: FloorPlanBooking[]
  unavailable: FloorPlanUnavailability | null
  reservation: FloorPlanReservation | null
}

export type UnavailableArea = {
  subjectType: Exclude<UnavailabilitySubjectType, 'unit'>
  subjectId: string
  reasonLabel: string | null
  reasonText: string | null
  from: string | null
  until: string | null
}

export type UnitStatusInput = {
  use: ProductUseKind | null
  date: string
  thresholdDays: number
  leases: readonly StatusLease[]
  proposals: readonly StatusProposal[]
  bookings: readonly StatusBooking[]
  windows: readonly UnavailabilityWindow[]
  contacts: ReadonlyMap<string, ContactInfo>
  crmAccess: CrmAccess
  reasonLabels?: ReasonLabels
}

export type FloorStatusUnit = UnitPlacement & { catalogProductId: string }

export type FloorStatus = {
  date: string
  leaseEndingThresholdDays: number
  units: Map<string, UnitStatusProjection>
  unavailableAreas: UnavailableArea[]
}

function dayRange(date: string) {
  return { start: startOfDay(date), end: endOfDay(date) }
}

function covers(term: { startsOn: string; endsOn: string }, date: string): boolean {
  return compareIsoDates(term.startsOn, date) <= 0 && compareIsoDates(term.endsOn, date) >= 0
}

function isOpenProposal(proposal: StatusProposal): boolean {
  return (OPEN_PROPOSAL_STATUSES as readonly string[]).includes(proposal.status)
}

export function leaseInForceOn(leases: readonly StatusLease[], date: string): StatusLease | null {
  const candidates = leases.filter((lease) => IN_FORCE_LEASE_STATUSES.includes(lease.status) && covers(lease, date))
  candidates.sort((left, right) => compareIsoDates(right.startsOn, left.startsOn))
  return candidates[0] ?? null
}

export function proposedLeaseFrom(leases: readonly StatusLease[], date: string): StatusLease | null {
  const candidates = leases.filter((lease) => lease.status === 'proposed' && compareIsoDates(lease.endsOn, date) >= 0)
  candidates.sort((left, right) => compareIsoDates(left.startsOn, right.startsOn))
  return candidates[0] ?? null
}

export function pendingReservationOn(leases: readonly StatusLease[], date: string): FloorPlanReservation | null {
  for (const lease of leases) {
    if (!lease.pendingChange || !IN_FORCE_LEASE_STATUSES.includes(lease.status) || covers(lease, date)) continue
    const reserved = reservedInterval(lease)
    if (covers(reserved, date)) return { leaseId: lease.id, reference: lease.reference, until: reserved.endsOn }
  }
  return null
}

export function isLeaseEnding(daysLeft: number, thresholdDays: number): boolean {
  return daysLeft >= 0 && daysLeft <= thresholdDays
}

export function unavailabilityOn(
  windows: readonly UnavailabilityWindow[],
  date: string,
  reasonLabels: ReasonLabels = NO_REASON_LABELS,
): FloorPlanUnavailability | null {
  const range = dayRange(date)
  const onDay = unavailableDuring(windows, range)
  if (!onDay.length) return null
  const first = onDay.slice().sort((left, right) => (left.start ?? '').localeCompare(right.start ?? ''))[0]
  const span = firstSpanFrom(windows, range.start)
  return {
    source: first.source,
    reasonLabel: first.reasonEntryId ? reasonLabels.get(first.reasonEntryId) ?? null : null,
    reasonText: first.reasonText,
    from: span?.start ?? first.start,
    until: span?.end ?? first.end,
  }
}

function contactOf(contacts: ReadonlyMap<string, ContactInfo>, id: string | null | undefined): ContactInfo {
  return (id ? contacts.get(id) : undefined) ?? { name: null, email: null }
}

function companyFields(access: CrmAccess, contacts: ReadonlyMap<string, ContactInfo>, id: string | null | undefined): { companyName?: string | null } {
  if (!access.companies) return {}
  return { companyName: id ? contactOf(contacts, id).name : null }
}

export function resolveUnitStatus(input: { use: ProductUseKind | null; unavailable: boolean; leaseInForce: boolean; bookingCount: number }): FloorUnitStatus {
  if (input.unavailable) return 'unavailable'
  if (input.use === 'bookable') return input.bookingCount > 0 ? 'booked' : 'free'
  if (input.leaseInForce) return 'occupied'
  if (input.use === null && input.bookingCount > 0) return 'booked'
  return 'available'
}

export function projectUnitStatus(input: UnitStatusInput): UnitStatusProjection {
  const { date, contacts, crmAccess } = input
  const inForce = leaseInForceOn(input.leases, date)
  const proposedLease = proposedLeaseFrom(input.leases, date)
  const openProposals = input.proposals.filter(isOpenProposal)
  const extension = inForce ? openProposals.find((proposal) => proposal.leaseId === inForce.id && proposal.kind === 'extension') ?? null : null
  const newProposal = proposedLease ? openProposals.find((proposal) => proposal.leaseId === proposedLease.id && proposal.kind === 'new') ?? null : null
  const range = dayRange(date)
  const bookings = input.bookings
    .filter((booking) => DAY_BOOKING_STATUSES.includes(booking.status))
    .map((booking) => ({ ...booking, startsAt: normalizeWallClock(booking.startsAt), endsAt: normalizeWallClock(booking.endsAt) }))
    .filter((booking) => booking.startsAt < range.end && booking.endsAt > range.start)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
  const unavailable = unavailabilityOn(input.windows, date, input.reasonLabels)
  const daysLeft = inForce ? daysUntil(inForce.endsOn, date) : null
  const lease: FloorPlanLease | null = inForce
    ? {
        id: inForce.id,
        reference: inForce.reference,
        status: inForce.status,
        startsOn: inForce.startsOn,
        endsOn: inForce.endsOn,
        daysLeft: daysLeft ?? 0,
        customerCompanyId: inForce.customerCompanyId,
        ...companyFields(crmAccess, contacts, inForce.customerCompanyId),
        contactPersonId: inForce.primaryContactPersonId ?? null,
        ...(crmAccess.people
          ? {
              contactName: contactOf(contacts, inForce.primaryContactPersonId).name,
              contactEmail: contactOf(contacts, inForce.primaryContactPersonId).email,
            }
          : {}),
        extensionRespondBy: extension?.respondBy ?? null,
        extensionStatus: extension?.status ?? null,
      }
    : null
  const proposal: FloorPlanProposal | null = proposedLease
    ? {
        id: newProposal?.id ?? null,
        leaseId: proposedLease.id,
        reference: proposedLease.reference,
        status: newProposal?.status ?? null,
        respondBy: newProposal?.respondBy ?? null,
        startsOn: proposedLease.startsOn,
        endsOn: proposedLease.endsOn,
        customerCompanyId: proposedLease.customerCompanyId,
        ...companyFields(crmAccess, contacts, proposedLease.customerCompanyId),
      }
    : null
  return {
    status: resolveUnitStatus({ use: input.use, unavailable: unavailable !== null, leaseInForce: inForce !== null, bookingCount: bookings.length }),
    lease,
    leaseEnding: daysLeft !== null && isLeaseEnding(daysLeft, input.thresholdDays),
    proposed: proposal !== null,
    proposal,
    bookings: bookings.map((booking) => ({
      id: booking.id,
      status: booking.status,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      billingUnit: booking.billingUnit,
      productName: booking.productName,
      personId: booking.bookedByPersonId,
      ...(crmAccess.people ? { personName: contactOf(contacts, booking.bookedByPersonId).name } : {}),
      companyId: booking.customerCompanyId ?? null,
      ...companyFields(crmAccess, contacts, booking.customerCompanyId),
    })),
    unavailable,
    reservation: inForce ? null : pendingReservationOn(input.leases, date),
  }
}

export function unavailableAreasOn(
  windows: readonly UnavailabilityWindow[],
  building: { id: string; archived: boolean },
  date: string,
  reasonLabels: ReasonLabels = NO_REASON_LABELS,
): UnavailableArea[] {
  const areas: UnavailableArea[] = []
  if (building.archived) areas.push({ subjectType: 'building', subjectId: building.id, reasonLabel: null, reasonText: null, from: null, until: null })
  const subjects = new Map<string, Exclude<UnavailabilitySubjectType, 'unit'>>()
  for (const window of windows) {
    if (window.source === 'building' || window.source === 'floor' || window.source === 'space') subjects.set(window.subjectId, window.source)
  }
  for (const [subjectId, subjectType] of subjects) {
    const own = windows.filter((window) => window.source === subjectType && window.subjectId === subjectId)
    const found = unavailabilityOn(own, date, reasonLabels)
    if (found) areas.push({ subjectType, subjectId, reasonLabel: found.reasonLabel, reasonText: found.reasonText, from: found.from, until: found.until })
  }
  return areas
}

export async function loadFloorLeases(em: EntityManager, scope: Scope, unitIds: readonly string[], date: string | null): Promise<Lease[]> {
  if (!unitIds.length) return []
  const where: Record<string, unknown> = { ...scope, unitId: { $in: [...unitIds] }, deletedAt: null }
  if (date) where.$or = [{ status: { $in: [...RESERVING_LEASE_STATUSES] } }, { status: 'ended', endsOn: { $gte: date } }]
  else where.status = { $in: [...RESERVING_LEASE_STATUSES] }
  return findWithDecryption(em, Lease, where, undefined, scope)
}

export async function loadFloorStatus(
  em: EntityManager,
  scope: Scope,
  input: {
    building: { id: string; archived: boolean }
    floorId: string
    spaceIds: readonly string[]
    units: readonly FloorStatusUnit[]
    uses: ReadonlyMap<string, ProductUseKind>
    leases: readonly Lease[]
    crmAccess: CrmAccess
  },
  date: string,
): Promise<FloorStatus> {
  const unitIds = input.units.map((unit) => unit.id)
  const range = dayRange(date)
  const leaseIds = input.leases.map((lease) => lease.id)
  const [settings, windows, bookings, proposals] = await Promise.all([
    loadSettings(em, scope),
    loadUnavailabilities(em, scope, [input.building.id, input.floorId, ...input.spaceIds, ...unitIds], { start: range.start, end: null }, { buildingIds: [input.building.id] }),
    unitIds.length
      ? findWithDecryption(
          em,
          Booking,
          {
            ...scope,
            unitId: { $in: unitIds },
            status: { $in: [...DAY_BOOKING_STATUSES] },
            startsAt: { $lt: toStoredWallClock(range.end) },
            endsAt: { $gt: toStoredWallClock(range.start) },
            deletedAt: null,
          },
          { orderBy: { startsAt: 'asc' } },
          scope,
        )
      : Promise.resolve([] as Booking[]),
    leaseIds.length
      ? findWithDecryption(em, LeaseProposal, { ...scope, leaseId: { $in: leaseIds }, status: { $in: [...OPEN_PROPOSAL_STATUSES] } }, undefined, scope)
      : Promise.resolve([] as LeaseProposal[]),
  ])
  const { crmAccess } = input
  const [customers, reasonLabels] = await Promise.all([
    loadCrmRecords(em, scope, crmAccess, {
      people: [...input.leases.map((lease) => lease.primaryContactPersonId), ...bookings.map((booking) => booking.bookedByPersonId)],
      companies: [...input.leases.map((lease) => lease.customerCompanyId), ...bookings.map((booking) => booking.customerCompanyId)],
    }),
    loadReasonLabels(em, scope, windows.map((window) => window.reasonEntryId ?? '')),
  ])
  const contacts = new Map<string, ContactInfo>(
    Array.from(customers.values()).map((customer) => [customer.id, { name: customer.displayName ?? null, email: customer.primaryEmail ?? null }]),
  )
  const archived = input.building.archived ? new Set([input.building.id]) : new Set<string>()
  const units = new Map<string, UnitStatusProjection>()
  for (const unit of input.units) {
    const unitLeases = input.leases.filter((lease) => lease.unitId === unit.id)
    const unitLeaseIds = new Set(unitLeases.map((lease) => lease.id))
    units.set(
      unit.id,
      projectUnitStatus({
        use: input.uses.get(unit.catalogProductId) ?? null,
        date,
        thresholdDays: settings.leaseEndingThresholdDays,
        leases: unitLeases,
        proposals: proposals.filter((proposal) => unitLeaseIds.has(proposal.leaseId)),
        bookings: bookings.filter((booking) => booking.unitId === unit.id),
        windows: windowsForUnit(unit, windows, archived),
        contacts,
        crmAccess,
        reasonLabels,
      }),
    )
  }
  return {
    date,
    leaseEndingThresholdDays: settings.leaseEndingThresholdDays,
    units,
    unavailableAreas: unavailableAreasOn(windows, input.building, date, reasonLabels),
  }
}
