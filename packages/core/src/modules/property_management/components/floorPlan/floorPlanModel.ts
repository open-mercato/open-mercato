import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { StatusBadgeVariant, StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { formatDate } from '../leases/leaseModel'
import { translatePlural } from '../plural'
import { lastDayOf, reasonOf } from '../availability/availabilityModel'
import { formatMetres, type FloorLayoutData, type LayoutUnit } from '../floor/types'
import type { CrmAccess } from '../crmAccess'

export const FLOOR_PLAN_HREF = '/backend/property_management/floor-plan'

export type FloorUnitStatus = 'occupied' | 'available' | 'unavailable' | 'booked' | 'free'

export type FloorPlanLease = {
  id: string
  reference: string
  status: string
  startsOn: string
  endsOn: string
  daysLeft: number
  customerCompanyId: string
  companyName?: string | null
  contactPersonId: string | null
  contactName?: string | null
  contactEmail?: string | null
  extensionRespondBy: string | null
  extensionStatus?: string | null
}

export type FloorPlanProposal = {
  id: string | null
  leaseId: string
  reference: string
  status?: string | null
  respondBy: string | null
  startsOn: string
  endsOn: string
  customerCompanyId: string
  companyName?: string | null
}

export type FloorPlanBooking = {
  id: string
  status: string
  startsAt: string
  endsAt: string
  billingUnit: string
  productName: string
  personId: string
  personName?: string | null
  companyId: string | null
  companyName?: string | null
}

export type FloorPlanUnavailability = { source: string; reasonLabel?: string | null; reasonText: string | null; from: string | null; until: string | null }

export type FloorPlanReservation = { leaseId: string; reference: string; until: string }

export type FloorPlanUnit = LayoutUnit & {
  status?: FloorUnitStatus
  lease?: FloorPlanLease | null
  leaseEnding?: boolean
  proposed?: boolean
  proposal?: FloorPlanProposal | null
  bookings?: FloorPlanBooking[]
  unavailable?: FloorPlanUnavailability | null
  reservation?: FloorPlanReservation | null
}

export type UnavailableArea = {
  subjectType: 'building' | 'floor' | 'space'
  subjectId: string
  reasonLabel?: string | null
  reasonText: string | null
  from: string | null
  until: string | null
}

export function closureReason(t: TranslateFn, closure: { reasonLabel?: string | null; reasonText: string | null }): string {
  const reason = reasonOf({ reasonLabel: closure.reasonLabel ?? null, reasonText: closure.reasonText ?? '' })
  return reason || t('property_management.floorPlan.unavailable.noReason', 'no reason given')
}

export type { CrmAccess }

export type FloorPlanLayout = Omit<FloorLayoutData, 'units'> & {
  units: FloorPlanUnit[]
  crmAccess?: CrmAccess
  date?: string
  leaseEndingThresholdDays?: number
  unavailableAreas?: UnavailableArea[]
}

export type FloorOption = { id: string; number: number; name: string; sizeX: number; sizeY: number }

export type BuildingOption = { id: string; name: string; status: string; floors: FloorOption[] }

export const UNIT_STATUS_VARIANTS: StatusMap<FloorUnitStatus> = {
  occupied: 'neutral',
  booked: 'neutral',
  available: 'success',
  free: 'success',
  unavailable: 'warning',
}

export const UNIT_STATUS_TILE_CLASSES: Record<StatusBadgeVariant, string> = {
  neutral: 'border-status-neutral-border bg-status-neutral-bg',
  success: 'border-status-success-border bg-status-success-bg',
  warning: 'border-status-warning-border bg-status-warning-bg',
  info: 'border-status-info-border bg-status-info-bg',
  error: 'border-status-error-border bg-status-error-bg',
}

export { HATCH_STYLE } from '../floor/scale'

type TileRect = { x: number; y: number; width: number; depth: number; name?: string }

const EDGE_EPSILON = 0.01

function overlapLength(startA: number, lengthA: number, startB: number, lengthB: number): number {
  return Math.min(startA + lengthA, startB + lengthB) - Math.max(startA, startB)
}

export function sameTileRow(left: TileRect, right: TileRect): boolean {
  const overlap = overlapLength(left.y, left.depth, right.y, right.depth)
  return overlap > EDGE_EPSILON && overlap >= Math.min(left.depth, right.depth) / 2
}

function rowOverlapRatio(left: TileRect, right: TileRect): number {
  return overlapLength(left.y, left.depth, right.y, right.depth) / Math.min(left.depth, right.depth)
}

export function tileRows<T extends TileRect>(units: readonly T[]): T[][] {
  const sorted = units.slice().sort((left, right) => left.y - right.y || left.x - right.x)
  const rows: T[][] = []
  for (const unit of sorted) {
    let bestRow: T[] | null = null
    let bestRatio = Number.NEGATIVE_INFINITY
    for (const row of rows) {
      if (!row.every((member) => sameTileRow(member, unit))) continue
      const ratio = Math.min(...row.map((member) => rowOverlapRatio(member, unit)))
      if (ratio > bestRatio) {
        bestRow = row
        bestRatio = ratio
      }
    }
    if (bestRow) bestRow.push(unit)
    else rows.push([unit])
  }
  return rows.map((row) => row.sort((left, right) => left.x - right.x || left.y - right.y || (left.name ?? '').localeCompare(right.name ?? '')))
}

export function readingOrder<T extends TileRect>(units: readonly T[]): T[] {
  return tileRows(units).flat()
}

export function verticalNeighbour<T extends TileRect>(units: readonly T[], current: T, direction: 1 | -1): T | null {
  const rows = tileRows(units)
  const index = rows.findIndex((row) => row.includes(current))
  const target = index < 0 ? undefined : rows[index + direction]
  if (!target) return null
  const centreX = current.x + current.width / 2
  let best: T | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const unit of target) {
    const distance = Math.abs(unit.x + unit.width / 2 - centreX)
    if (distance < bestDistance) {
      best = unit
      bestDistance = distance
    }
  }
  return best
}

export function unitStatusOf(unit: FloorPlanUnit): FloorUnitStatus {
  if (unit.status) return unit.status
  return unit.use === 'bookable' ? 'free' : 'available'
}

export function unitStatusLabel(t: TranslateFn, status: FloorUnitStatus): string {
  const fallbacks: Record<FloorUnitStatus, string> = {
    occupied: 'Occupied',
    available: 'Available',
    unavailable: 'Unavailable',
    booked: 'Booked',
    free: 'Free',
  }
  return t(`property_management.floorPlan.status.${status}`, fallbacks[status])
}

export function unitSubtitle(t: TranslateFn, unit: FloorPlanUnit, locale: string): string {
  if (unit.lease?.companyName) return unit.lease.companyName
  if (unit.proposed && unit.proposal?.companyName) {
    return t('property_management.floorPlan.tile.proposedTo', 'Proposed to {company}', { company: unit.proposal.companyName })
  }
  if (unit.use === 'bookable') {
    const count = unit.bookings?.length ?? 0
    return count
      ? translatePlural(t, locale, 'property_management.floorPlan.tile.bookingsToday', '{count} bookings on this day', count)
      : t('property_management.floorPlan.tile.noBookings', 'No bookings on this day')
  }
  return unit.categoryName ?? unit.productName ?? ''
}

export function formatSize(t: TranslateFn, unit: { width: number; depth: number }, locale: string): string {
  return t('property_management.floorPlan.size', '{width} × {depth} m, {area} m²', {
    width: formatMetres(unit.width, locale),
    depth: formatMetres(unit.depth, locale),
    area: formatMetres(unit.width * unit.depth, locale),
  })
}

export function formatTimeRange(booking: Pick<FloorPlanBooking, 'startsAt' | 'endsAt'>): string {
  return `${booking.startsAt.slice(11, 16)}–${booking.endsAt.slice(11, 16)}`
}

export function describeUnavailableUntil(t: TranslateFn, until: string | null, locale: string): string {
  if (!until) return t('property_management.floorPlan.unavailable.openEnded', 'Until further notice')
  return t('property_management.floorPlan.unavailable.until', 'Until {date}', { date: formatDate(lastDayOf(until), locale) })
}

export function defaultFloorOf(building: BuildingOption | null): FloorOption | null {
  if (!building || !building.floors.length) return null
  return building.floors.find((floor) => floor.number === 0) ?? building.floors[0]
}

export function floorLabel(t: TranslateFn, floor: Pick<FloorOption, 'number' | 'name'>): string {
  if (!floor.name.trim()) return String(floor.number)
  return t('property_management.floorPlan.floorOption', '{number} · {name}', { number: floor.number, name: floor.name })
}

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function isoToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
