import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { stampOf } from './helpers'
import { MANAGER_PASSWORD } from './staffFixtures'
import { bookingDay, cleanupBookingSetup, createBooking, createBookingSetup, type BookingSetup } from './bookingFixtures'
import { addIsoDays, cleanupLeaseSetup, createLease, createLeaseSetup, isoDayFromToday, type LeaseSetup } from './leaseFixtures'
import { postClosure } from './unavailabilityFixtures'

type CrmAccess = { people: boolean; companies: boolean }
type JsonRecord = Record<string, unknown>
type ListBody = { items?: JsonRecord[]; crmAccess?: CrmAccess }
type PreviewBody = { bookingsToCancel?: JsonRecord[]; crmAccess?: CrmAccess }
type LeaseDetailBody = { lease?: JsonRecord; crmAccess?: CrmAccess }
type StaffUser = { roleId: string; userId: string; token: string }

const NO_CRM: CrmAccess = { people: false, companies: false }
const FULL_CRM: CrmAccess = { people: true, companies: true }

async function createStaffUser(request: APIRequestContext, adminToken: string, name: string, features: string[]): Promise<StaffUser> {
  const { tenantId, organizationId } = getTokenContext(adminToken)
  const roleId = await createRoleFixture(request, adminToken, { name, tenantId })
  await setRoleAclFeatures(request, adminToken, { roleId, features })
  const email = `${name}@example.com`
  const userId = await createUserFixture(request, adminToken, { email, password: MANAGER_PASSWORD, organizationId, roles: [roleId], name })
  return { roleId, userId, token: await getAuthToken(request, email, MANAGER_PASSWORD) }
}

async function deleteStaffUsers(request: APIRequestContext, adminToken: string, users: StaffUser[]): Promise<void> {
  for (const user of users) {
    await deleteUserIfExists(request, adminToken, user.userId)
    await deleteRoleIfExists(request, adminToken, user.roleId)
  }
}

async function readList(request: APIRequestContext, token: string, path: string): Promise<ListBody> {
  const response = await apiRequest(request, 'GET', path, { token })
  const body = await readJsonSafe<ListBody>(response)
  expect(response.status(), `GET ${path} → ${JSON.stringify(body)}`).toBe(200)
  return body ?? {}
}

/**
 * TC-PM-072: CRM names follow the customers features on every list
 * A staff user with only `property_management.view` (a manager of the building, no customers feature)
 * reads the bookings list, the leases list and the lease detail without any CRM name: `bookedByName`,
 * `companyName` and `contactName` are omitted while the person and company ids stay, and `crmAccess`
 * is `{ people: false, companies: false }`. A user who may also close units gets the closure dry run
 * without `bookingsToCancel[].person`. The administrator (customers features) sees every name.
 */
test.describe('TC-PM-072: CRM names are hidden without the customers features', () => {
  test('bookings list and closure dry run omit names for a caller without customers features', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    const users: StaffUser[] = []
    let setup: BookingSetup | null = null
    try {
      const viewer = await createStaffUser(request, adminToken, `qa-pm-crm-viewer-${stamp}`, ['property_management.view'])
      users.push(viewer)
      const closer = await createStaffUser(request, adminToken, `qa-pm-crm-closer-${stamp}`, [
        'property_management.view',
        'property_management.availability.manage',
      ])
      users.push(closer)
      setup = await createBookingSetup(request, adminToken, stamp, { managerUserIds: [viewer.userId, closer.userId] })
      const [unitId] = setup.unitIds
      const day = bookingDay(4)
      const bookingId = await createBooking(request, adminToken, setup, {
        unitId,
        startsAt: `${day}T09:00`,
        endsAt: `${day}T10:00`,
        bookedByPersonId: setup.personId as string,
        customerCompanyId: setup.companyId,
      })

      const listPath = `/api/property_management/bookings?id=${bookingId}`
      const adminList = await readList(request, adminToken, listPath)
      expect(adminList.crmAccess).toEqual(FULL_CRM)
      expect(adminList.items?.[0]).toMatchObject({ bookedByName: `Marta Booker ${stamp}`, companyName: `QA PM Member Co ${stamp}` })

      const viewerList = await readList(request, viewer.token, listPath)
      expect(viewerList.crmAccess).toEqual(NO_CRM)
      const [viewerItem] = viewerList.items ?? []
      expect(viewerItem).toMatchObject({ id: bookingId, bookedByPersonId: setup.personId, customerCompanyId: setup.companyId })
      expect(viewerItem).not.toHaveProperty('bookedByName')
      expect(viewerItem).not.toHaveProperty('companyName')

      const closure = { subjectType: 'unit' as const, subjectId: unitId, startsAt: `${isoDayFromToday(0)}T00:00`, endsAt: `${addIsoDays(day, 1)}T00:00` }
      const closerPreview = await postClosure(request, closer.token, closure, true)
      const closerBody = await readJsonSafe<PreviewBody>(closerPreview)
      expect(closerPreview.status(), `dry run → ${JSON.stringify(closerBody)}`).toBe(200)
      expect(closerBody?.crmAccess).toEqual(NO_CRM)
      expect(closerBody?.bookingsToCancel?.map((booking) => booking.id)).toEqual([bookingId])
      expect(closerBody?.bookingsToCancel?.[0]).not.toHaveProperty('person')

      const adminPreview = await readJsonSafe<PreviewBody>(await postClosure(request, adminToken, closure, true))
      expect(adminPreview?.crmAccess).toEqual(FULL_CRM)
      expect(adminPreview?.bookingsToCancel?.[0]).toMatchObject({ id: bookingId, person: `Marta Booker ${stamp}` })
    } finally {
      await cleanupBookingSetup(request, adminToken, setup)
      await deleteStaffUsers(request, adminToken, users)
    }
  })

  test('leases list and lease detail omit names for a caller without customers features', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    const users: StaffUser[] = []
    let setup: LeaseSetup | null = null
    let personId: string | null = null
    try {
      const viewer = await createStaffUser(request, adminToken, `qa-pm-crm-lease-viewer-${stamp}`, ['property_management.view'])
      users.push(viewer)
      setup = await createLeaseSetup(request, adminToken, stamp, { managerUserIds: [viewer.userId] })
      const [companyId] = setup.companyIds
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'Lena',
        lastName: `Contact ${stamp}`,
        displayName: `Lena Contact ${stamp}`,
        companyEntityId: companyId,
      })
      const lease = await createLease(request, adminToken, setup, {
        unitId: setup.unitIds[0],
        customerCompanyId: companyId,
        primaryContactPersonId: personId,
        startsOn: isoDayFromToday(10),
        termMonths: 6,
      })

      const listPath = `/api/property_management/leases?id=${lease.id}`
      const adminList = await readList(request, adminToken, listPath)
      expect(adminList.crmAccess).toEqual(FULL_CRM)
      expect(adminList.items?.[0]).toMatchObject({ companyName: `QA PM Tenant 1 ${stamp}`, contactName: `Lena Contact ${stamp}` })

      const viewerList = await readList(request, viewer.token, listPath)
      expect(viewerList.crmAccess).toEqual(NO_CRM)
      const [viewerItem] = viewerList.items ?? []
      expect(viewerItem).toMatchObject({ id: lease.id, customerCompanyId: companyId, primaryContactPersonId: personId })
      expect(viewerItem).not.toHaveProperty('companyName')
      expect(viewerItem).not.toHaveProperty('contactName')

      const detailResponse = await apiRequest(request, 'GET', `/api/property_management/leases/${lease.id}`, { token: viewer.token })
      const detail = await readJsonSafe<LeaseDetailBody>(detailResponse)
      expect(detailResponse.status(), `GET lease detail → ${JSON.stringify(detail)}`).toBe(200)
      expect(detail?.crmAccess).toEqual(NO_CRM)
      expect(detail?.lease).toMatchObject({ id: lease.id, customerCompanyId: companyId, primaryContactPersonId: personId })
      expect(detail?.lease).not.toHaveProperty('companyName')
      expect(detail?.lease).not.toHaveProperty('contactName')

      const adminDetail = await readJsonSafe<LeaseDetailBody>(
        await apiRequest(request, 'GET', `/api/property_management/leases/${lease.id}`, { token: adminToken }),
      )
      expect(adminDetail?.crmAccess).toEqual(FULL_CRM)
      expect(adminDetail?.lease).toMatchObject({ companyName: `QA PM Tenant 1 ${stamp}`, contactName: `Lena Contact ${stamp}` })
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await cleanupLeaseSetup(request, adminToken, setup)
      await deleteStaffUsers(request, adminToken, users)
    }
  })
})
