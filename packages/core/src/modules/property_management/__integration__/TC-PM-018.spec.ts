import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { listNotifications } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { stampOf } from './helpers'
import { createManagers, deleteManagers, type ManagerFixture } from './staffFixtures'
import {
  cleanupLeaseSetup,
  createLease,
  createLeaseSetup,
  isActivated,
  isoDayFromToday,
  SALES_PHASES_SKIP_REASON,
  salesRecurrenceSurfaceAvailable,
  waitForLease,
  type LeaseSetup,
} from './leaseFixtures'

/**
 * TC-PM-018: lease building access and staff notifications
 * Manager A cannot list, open, end, extend or delete a lease in manager B's building (filtered / 404).
 * Staff notifications about a lease (billing change refused, orphaned order) reach the building's
 * managers and the administrators, never manager B.
 */
test.describe('TC-PM-018: lease access and staff notifications', () => {
  test('scopes leases to the managers of their building', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let managers: ManagerFixture | null = null
    let setup: LeaseSetup | null = null
    try {
      managers = await createManagers(request, adminToken, stamp, 2, ['property_management.leases.manage'])
      const [managerA, managerB] = managers.users
      setup = await createLeaseSetup(request, adminToken, stamp, { managerUserIds: [managerB.id] })
      const lease = await createLease(request, adminToken, setup, {
        unitId: setup.unitIds[0],
        customerCompanyId: setup.companyIds[0],
        startsOn: isoDayFromToday(10),
        termMonths: 6,
      })

      const listA = await readJsonSafe<{ items?: Array<{ id: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/leases?id=${lease.id}`, { token: managerA.token }),
      )
      expect(listA?.items ?? []).toHaveLength(0)
      const listB = await readJsonSafe<{ items?: Array<{ id: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/leases?id=${lease.id}`, { token: managerB.token }),
      )
      expect((listB?.items ?? []).map((item) => item.id)).toEqual([lease.id])

      const detailA = await apiRequest(request, 'GET', `/api/property_management/leases/${lease.id}`, { token: managerA.token })
      expect(detailA.status()).toBe(404)
      const endA = await apiRequest(request, 'POST', `/api/property_management/leases/${lease.id}/end`, {
        token: managerA.token,
        data: { endsOn: isoDayFromToday(20), settlement: 'keep' },
      })
      expect(endA.status()).toBe(404)
      const extendA = await apiRequest(request, 'POST', `/api/property_management/leases/${lease.id}/extensions`, {
        token: managerA.token,
        data: { months: 3, monthlyRate: 1000, asProposal: false },
      })
      expect(extendA.status()).toBe(404)
      const deleteA = await apiRequest(request, 'DELETE', `/api/property_management/leases?id=${lease.id}`, { token: managerA.token })
      expect(deleteA.status()).toBe(404)
      const createA = await apiRequest(request, 'POST', '/api/property_management/leases', {
        token: managerA.token,
        data: { unitId: setup.unitIds[0], customerCompanyId: setup.companyIds[0], startsOn: isoDayFromToday(400), termMonths: 3, monthlyRate: 1000, asProposal: false },
      })
      expect(createA.status(), "manager A cannot lease a unit of B's building").toBe(422)

      const detailB = await apiRequest(request, 'GET', `/api/property_management/leases/${lease.id}`, { token: managerB.token })
      expect(detailB.status()).toBe(200)
    } finally {
      await cleanupLeaseSetup(request, adminToken, setup)
      await deleteManagers(request, adminToken, managers)
    }
  })

  test('sends billing notifications to the building managers and administrators only', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let managers: ManagerFixture | null = null
    let setup: LeaseSetup | null = null
    try {
      managers = await createManagers(request, adminToken, stamp, 2, ['property_management.leases.manage'])
      const [managerA, managerB] = managers.users
      setup = await createLeaseSetup(request, adminToken, stamp, { managerUserIds: [managerA.id] })
      const lease = await createLease(request, adminToken, setup, {
        unitId: setup.unitIds[0],
        customerCompanyId: setup.companyIds[0],
        startsOn: isoDayFromToday(0),
        termMonths: 6,
      })
      const active = await waitForLease(request, adminToken, lease.id, isActivated)
      test.skip(!active, 'the property_management.sales_operation worker did not run in this environment')
      const available = await salesRecurrenceSurfaceAvailable(request, adminToken, active?.lease.salesOrderId ?? null)
      test.skip(!available, SALES_PHASES_SKIP_REASON)

      const ended = await apiRequest(request, 'POST', `/api/property_management/leases/${lease.id}/end`, {
        token: managerA.token,
        data: { endsOn: isoDayFromToday(0), settlement: 'keep' },
      })
      expect([200, 202]).toContain(ended.status())
      const settled = await waitForLease(request, adminToken, lease.id, (detail) => detail.pendingChange === null)
      test.skip(!settled?.lastBillingRefusal, 'sales did not refuse the cancellation (no invoice was issued between the check and the cancellation)')
      const type = 'property_management.lease.billing_change_refused'
      const forA = await listNotifications(request, managerA.token, { type })
      const forAdmin = await listNotifications(request, adminToken, { type })
      const forB = await listNotifications(request, managerB.token, { type })
      expect(forA.items.some((item) => item.sourceEntityId === lease.id)).toBe(true)
      expect(forAdmin.items.some((item) => item.sourceEntityId === lease.id)).toBe(true)
      expect(forB.items.some((item) => item.sourceEntityId === lease.id), 'manager B is not notified').toBe(false)
    } finally {
      await cleanupLeaseSetup(request, adminToken, setup)
      await deleteManagers(request, adminToken, managers)
    }
  })
})
