import type { FloorPlanLayout, FloorPlanUnit } from './floorPlanModel'
import { readCrmAccess, visibleCrmName as visible, type CrmAccess } from '../crmAccess'

export { NO_CRM_ACCESS, readCrmAccess } from '../crmAccess'

function redactUnit(unit: FloorPlanUnit, access: CrmAccess): FloorPlanUnit {
  const lease = unit.lease
    ? {
        ...unit.lease,
        companyName: visible(access.companies, unit.lease.companyName),
        contactName: visible(access.people, unit.lease.contactName),
        contactEmail: visible(access.people, unit.lease.contactEmail),
      }
    : unit.lease
  const proposal = unit.proposal
    ? { ...unit.proposal, companyName: visible(access.companies, unit.proposal.companyName) }
    : unit.proposal
  const bookings = unit.bookings?.map((booking) => ({
    ...booking,
    personName: visible(access.people, booking.personName),
    companyName: visible(access.companies, booking.companyName),
  }))
  return { ...unit, lease, proposal, bookings }
}

export function applyCrmAccess(layout: FloorPlanLayout): FloorPlanLayout {
  const crmAccess = readCrmAccess(layout.crmAccess)
  return { ...layout, crmAccess, units: layout.units.map((unit) => redactUnit(unit, crmAccess)) }
}
