import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { listNotifications } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { stampOf } from './helpers'
import { createManagers, deleteManagers, type ManagerFixture } from './staffFixtures'
import {
  addIsoDays,
  cleanupLeaseSetup,
  cleanupPinnedLeaseSetup,
  createLease,
  createLeaseSetup,
  drainSalesOperations,
  isActivated,
  isoDayFromToday,
  pinPendingEnd,
  postLease,
  readLease,
  readSalesDocument,
  SALES_CANCEL_SKIP_REASON,
  SALES_PHASES_SKIP_REASON,
  expectBillingCancelRefused,
  salesCancelUnavailable,
  salesRecurrenceSurfaceAvailable,
  settleLease,
  type LeaseDetail,
  type LeaseSetup,
} from './leaseFixtures'

/**
 * TC-PM-016: ending and deleting a lease
 * Pre-validation refuses an end later than the current end (409 lease_end_later_than_current) and
 * a second change while one is pending (409 lease_change_pending). An end records one
 * recurrence_cancel per order reaching past it and keeps the change pending until sales confirms;
 * while it is pending, a lease or proposal in the released months is refused (409 lease_overlap) —
 * while sales cannot cancel recurring orders the end is refused and the pending end is pinned in the
 * database instead, since the overlap check is local. A lease without invoices can be deleted: it leaves the list and its order is cancelled from its
 * start, never deleted. A manager without `sales.credit_memos.manage` can still end with `keep`: the
 * issued final period is kept, so sales accepts the cancellation and nothing is credited. Cases that
 * need sales' cancel/invoicing surface are guarded by
 * `test.skip(…, 'requires sales recurring orders Phases 2–3')`. A cancellation refused with
 * `recurring_cancel_would_credit` (an invoice issued between the End lease permission check and the
 * cancellation) needs that invoice forced between the request and the worker, so the revert and the
 * manager notification are covered by unit tests only (`__tests__/leaseOperationHandlers.test.ts`,
 * `__tests__/salesOperationRunner.test.ts`).
 */
async function endLease(request: Parameters<typeof apiRequest>[0], token: string, leaseId: string, data: Record<string, unknown>) {
  return apiRequest(request, 'POST', `/api/property_management/leases/${leaseId}/end`, { token, data })
}

async function activeLease(request: Parameters<typeof apiRequest>[0], token: string, setup: LeaseSetup, startsOn: string, termMonths: number) {
  const lease = await createLease(request, token, setup, {
    unitId: setup.unitIds[0],
    customerCompanyId: setup.companyIds[0],
    startsOn,
    termMonths,
  })
  return { lease, detail: await settleLease(request, token, lease.id, isActivated, 'the lease activation') }
}

test.describe('TC-PM-016: end and delete', () => {
  test('pre-validates an end and keeps the change pending until sales confirms', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp)
      const { lease, detail } = await activeLease(request, token, setup, isoDayFromToday(5), 6)

      const later = await endLease(request, token, lease.id, { endsOn: addIsoDays(detail.lease.endsOn, 5), settlement: 'keep' })
      expect(later.status()).toBe(409)
      expect((await readJsonSafe<{ code?: string }>(later))?.code).toBe('lease_end_later_than_current')

      const preview = await apiRequest(request, 'GET', `/api/property_management/leases/${lease.id}/end?endsOn=${isoDayFromToday(30)}`, { token })
      const previewBody = await readJsonSafe<{ options?: Array<{ settlement: string; allowed: boolean }>; ordersToCancel?: number }>(preview)
      expect(preview.status()).toBe(200)
      expect(previewBody?.ordersToCancel).toBe(1)
      expect((previewBody?.options ?? []).map((option) => option.settlement).sort()).toEqual(['credit_full', 'keep', 'prorate'])

      const newEnd = isoDayFromToday(30)
      const ended = await endLease(request, token, lease.id, { endsOn: newEnd, settlement: 'keep' })
      if (salesCancelUnavailable(detail)) {
        await expectBillingCancelRefused(ended)
        expect((await readLease(request, token, lease.id))?.pendingChange, 'a refused end leaves no pending change').toBeNull()
        test.skip(true, SALES_CANCEL_SKIP_REASON)
        return
      }
      const endedBody = await readJsonSafe<{ pending?: boolean; changeId?: string | null }>(ended)
      expect(ended.status(), JSON.stringify(endedBody)).toBe(202)
      expect(endedBody?.pending).toBe(true)

      const pending = await readLease(request, token, lease.id)
      expect(pending?.lease.endsOn).toBe(newEnd)
      expect(pending?.pendingChange).toMatchObject({ kind: 'end' })
      expect(pending?.operations.some((operation) => operation.kind === 'recurrence_cancel')).toBe(true)

      const second = await endLease(request, token, lease.id, { endsOn: isoDayFromToday(20), settlement: 'keep' })
      expect(second.status(), 'a second change waits for the first').toBe(409)
      expect((await readJsonSafe<{ code?: string }>(second))?.code).toBe('lease_change_pending')

      const available = await salesRecurrenceSurfaceAvailable(request, token, detail.lease.salesOrderId)
      test.skip(!available, SALES_PHASES_SKIP_REASON)
      await drainSalesOperations()
      const settled = await settleLease(request, token, lease.id, (entry: LeaseDetail) => entry.pendingChange === null, 'the pending end')
      expect(settled.lease.endsOn).toBe(newEnd)
      const recurrence = await readJsonSafe<{ cancelEffectiveOn?: string }>(
        await apiRequest(request, 'GET', `/api/sales/orders/${detail.lease.salesOrderId}/recurrence`, { token }),
      )
      expect(recurrence?.cancelEffectiveOn).toBe(addIsoDays(newEnd, 1))
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })

  test('deletes a lease before any invoice without deleting its order', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp)
      const { lease, detail } = await activeLease(request, token, setup, isoDayFromToday(40), 12)
      const orderId = detail.lease.salesOrderId as string

      const removed = await apiRequest(request, 'DELETE', `/api/property_management/leases?id=${lease.id}`, { token })
      if (salesCancelUnavailable(detail)) {
        await expectBillingCancelRefused(removed)
        expect(await readLease(request, token, lease.id), 'a refused delete keeps the lease').not.toBeNull()
        test.skip(true, SALES_CANCEL_SKIP_REASON)
        return
      }
      expect(removed.status()).toBe(200)
      const list = await readJsonSafe<{ items?: Array<{ id: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/leases?unitId=${setup.unitIds[0]}`, { token }),
      )
      expect((list?.items ?? []).map((item) => item.id)).not.toContain(lease.id)
      expect(await readLease(request, token, lease.id), 'the deleted lease is gone').toBeNull()
      expect(await readSalesDocument(request, token, 'orders', orderId), 'the order is never deleted').not.toBeNull()

      const available = await salesRecurrenceSurfaceAvailable(request, token, orderId)
      test.skip(!available, SALES_PHASES_SKIP_REASON)
      await drainSalesOperations()
      await expect
        .poll(async () => {
          const response = await apiRequest(request, 'GET', `/api/sales/orders/${orderId}/recurrence`, { token })
          return (await readJsonSafe<{ cancelEffectiveOn?: string }>(response))?.cancelEffectiveOn ?? null
        }, { timeout: 15_000 })
        .toBe(detail.lease.startsOn)
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })

  test('refuses credit settlements without sales.credit_memos.manage', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    let managers: ManagerFixture | null = null
    try {
      managers = await createManagers(request, adminToken, stamp, 1, ['property_management.leases.manage'])
      const [manager] = managers.users
      setup = await createLeaseSetup(request, adminToken, stamp, { managerUserIds: [manager.id] })
      const { lease, detail } = await activeLease(request, adminToken, setup, isoDayFromToday(-40), 6)
      const available = await salesRecurrenceSurfaceAvailable(request, adminToken, detail.lease.salesOrderId)
      test.skip(!available, SALES_PHASES_SKIP_REASON)

      const prorate = await endLease(request, manager.token, lease.id, { endsOn: isoDayFromToday(-1), settlement: 'prorate' })
      expect(prorate.status(), 'prorating an issued month credits it').toBe(403)
      expect((await readJsonSafe<{ code?: string }>(prorate))?.code).toBe('credit_permission_required')

      const keep = await endLease(request, manager.token, lease.id, { endsOn: isoDayFromToday(0), settlement: 'keep' })
      expect([200, 202]).toContain(keep.status())
    } finally {
      await cleanupLeaseSetup(request, adminToken, setup)
      await deleteManagers(request, adminToken, managers)
    }
  })

  test('applies a keep end requested without sales.credit_memos.manage, with no refusal and no credit memo', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    let managers: ManagerFixture | null = null
    try {
      managers = await createManagers(request, adminToken, stamp, 1, ['property_management.leases.manage'])
      const [manager] = managers.users
      setup = await createLeaseSetup(request, adminToken, stamp, { managerUserIds: [manager.id] })
      const { lease, detail } = await activeLease(request, adminToken, setup, isoDayFromToday(0), 6)
      const available = await salesRecurrenceSurfaceAvailable(request, adminToken, detail.lease.salesOrderId)
      test.skip(!available, SALES_PHASES_SKIP_REASON)

      const newEnd = isoDayFromToday(0)
      const ended = await endLease(request, manager.token, lease.id, { endsOn: newEnd, settlement: 'keep' })
      expect([200, 202], JSON.stringify(await readJsonSafe(ended))).toContain(ended.status())
      await drainSalesOperations()
      const settled = await settleLease(request, adminToken, lease.id, (entry: LeaseDetail) => entry.pendingChange === null, 'the pending end')
      expect(settled.lastBillingRefusal, 'keeping the issued final period credits nothing, so sales accepts it').toBeNull()
      expect(settled.lease.endsOn).toBe(newEnd)
      const recurrence = await readJsonSafe<{ cancelEffectiveOn?: string; periods?: Array<{ creditMemoId?: string | null }> }>(
        await apiRequest(request, 'GET', `/api/sales/orders/${detail.lease.salesOrderId}/recurrence`, { token: adminToken }),
      )
      expect(recurrence?.cancelEffectiveOn).toBe(addIsoDays(newEnd, 1))
      expect((recurrence?.periods ?? []).filter((period) => Boolean(period.creditMemoId)), 'no credit memo').toEqual([])
      const notifications = await listNotifications(request, manager.token, { type: 'property_management.lease.billing_change_refused' })
      expect(notifications.items.some((item) => item.sourceEntityId === lease.id), 'nobody is told about a refusal').toBe(false)
    } finally {
      await cleanupLeaseSetup(request, adminToken, setup)
      await deleteManagers(request, adminToken, managers)
    }
  })

  test('a pending end keeps the months it releases taken until sales confirms it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    const pinnedChangeId = randomUUID()
    let pinnedLeaseId: string | null = null
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp, { companies: 2 })
      const { lease, detail } = await activeLease(request, token, setup, isoDayFromToday(5), 6)

      const newEnd = isoDayFromToday(40)
      const ended = await endLease(request, token, lease.id, { endsOn: newEnd, settlement: 'keep' })
      const cancelUnavailable = salesCancelUnavailable(detail)
      if (cancelUnavailable) {
        await expectBillingCancelRefused(ended)
        pinnedLeaseId = lease.id
        expect(await pinPendingEnd(lease.id, pinnedChangeId, newEnd), 'the active lease gets a pinned pending end').toBe(1)
      } else {
        expect(ended.status(), JSON.stringify(await readJsonSafe(ended))).toBe(202)
      }
      expect((await readLease(request, token, lease.id))?.pendingChange).toMatchObject({ kind: 'end' })

      const released = {
        unitId: setup.unitIds[0],
        customerCompanyId: setup.companyIds[1],
        startsOn: addIsoDays(newEnd, 1),
        termMonths: 1,
      }
      const directLease = await postLease(request, token, released)
      expect(directLease.status(), 'a lease in the released months waits for the end').toBe(409)
      expect((await readJsonSafe<{ code?: string }>(directLease))?.code).toBe('lease_overlap')
      const proposal = await postLease(request, token, { ...released, asProposal: true, expiresInDays: 7 })
      expect(proposal.status(), 'a proposal in the released months waits for the end').toBe(409)
      expect((await readJsonSafe<{ code?: string }>(proposal))?.code).toBe('lease_overlap')

      if (cancelUnavailable) {
        test.info().annotations.push({ type: 'partial', description: `sales confirmation not checked: ${SALES_CANCEL_SKIP_REASON}` })
        return
      }
      const available = await salesRecurrenceSurfaceAvailable(request, token, detail.lease.salesOrderId)
      test.skip(!available, SALES_PHASES_SKIP_REASON)
      await drainSalesOperations()
      const settled = await settleLease(request, token, lease.id, (entry: LeaseDetail) => entry.pendingChange === null, 'the pending end')
      expect(settled.lease.endsOn).toBe(newEnd)
      await createLease(request, token, setup, released)
    } finally {
      await cleanupPinnedLeaseSetup(request, token, setup, { leaseId: pinnedLeaseId, changeId: pinnedChangeId })
    }
  })

  test('extend directly, then end during the original term: nothing is invoiced after the end', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp)
      const { lease, detail } = await activeLease(request, token, setup, isoDayFromToday(0), 2)
      const available = await salesRecurrenceSurfaceAvailable(request, token, detail.lease.salesOrderId)
      test.skip(!available, SALES_PHASES_SKIP_REASON)
      const extension = await apiRequest(request, 'POST', `/api/property_management/leases/${lease.id}/extensions`, {
        token,
        data: { months: 3, monthlyRate: 1500, asProposal: false },
      })
      expect(extension.status()).toBe(202)
      await settleLease(
        request,
        token,
        lease.id,
        (entry: LeaseDetail) => entry.versions.filter((version) => version.state === 'in_force').length === 2,
        'the extension version coming into force',
      )
      const newEnd = isoDayFromToday(15)
      expect([200, 202]).toContain((await endLease(request, token, lease.id, { endsOn: newEnd, settlement: 'keep' })).status())
      await drainSalesOperations()
      const settled = await settleLease(request, token, lease.id, (entry: LeaseDetail) => entry.pendingChange === null, 'the pending end')
      for (const version of settled.versions) {
        const invoices = (version.invoices ?? []) as Array<{ periodStart: string }>
        expect(invoices.every((invoice) => invoice.periodStart <= newEnd), `no invoice after ${newEnd} on ${version.id}`).toBe(true)
      }
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })
})
