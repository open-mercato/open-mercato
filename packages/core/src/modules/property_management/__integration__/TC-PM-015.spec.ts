import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { stampOf } from './helpers'
import {
  addIsoDays,
  cleanupLeaseSetup,
  createLease,
  createLeaseSetup,
  isActivated,
  isoDayFromToday,
  readField,
  readLease,
  readSalesDocument,
  SALES_CANCEL_SKIP_REASON,
  expectBillingCancelRefused,
  salesCancelUnavailable,
  settleLease,
  type LeaseDetail,
  type LeaseSetup,
} from './leaseFixtures'

/**
 * TC-PM-015: lease extensions
 * A direct extension writes a pending `extended` version and a new recurring order that starts the
 * day after the current term; once the order exists `ends_on` moves. An extension proposal is the
 * lease's only open proposal (a second → 409, a direct extension meanwhile → 409), and ending the
 * lease withdraws it.
 */
async function postExtension(request: Parameters<typeof apiRequest>[0], token: string, leaseId: string, data: Record<string, unknown>) {
  return apiRequest(request, 'POST', `/api/property_management/leases/${leaseId}/extensions`, { token, data })
}

test.describe('TC-PM-015: lease extensions', () => {
  test('extends directly with a follow-on recurring order', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp)
      const lease = await createLease(request, token, setup, {
        unitId: setup.unitIds[0],
        customerCompanyId: setup.companyIds[0],
        startsOn: isoDayFromToday(5),
        termMonths: 3,
      })
      const active = await settleLease(request, token, lease.id, isActivated, 'the lease activation')
      const termEnd = active.lease.endsOn

      const extension = await postExtension(request, token, lease.id, { months: 6, monthlyRate: 1400, asProposal: false })
      const body = await readJsonSafe<{ versionId?: string; status?: string }>(extension)
      expect(extension.status(), JSON.stringify(body)).toBe(202)
      expect(body?.status).toBe('pending')

      const extended = await settleLease(
        request,
        token,
        lease.id,
        (detail: LeaseDetail) => detail.versions.some((version) => version.id === body?.versionId && version.state === 'in_force'),
        'the extension version coming into force',
      )
      const version = extended.versions.find((entry) => entry.id === body?.versionId)
      expect(version?.event).toBe('extended')
      expect(version?.startsOn).toBe(addIsoDays(termEnd, 1))
      expect(extended.lease.endsOn).toBe(version?.endsOn)
      expect(extended.lease.termMonths).toBe(9)
      const order = await readSalesDocument(request, token, 'orders', version?.salesOrderId as string)
      expect(readField(order, 'recurrence')).toMatchObject({ frequency: 'monthly', startsOn: addIsoDays(termEnd, 1), periodCount: 6 })
      expect(version?.salesOrderId, 'the extension has its own order').not.toBe(active.lease.salesOrderId)
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })

  test('allows one open extension proposal and withdraws it when the lease ends', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp)
      const lease = await createLease(request, token, setup, {
        unitId: setup.unitIds[0],
        customerCompanyId: setup.companyIds[0],
        startsOn: isoDayFromToday(1),
        termMonths: 2,
      })
      const active = await settleLease(request, token, lease.id, isActivated, 'the lease activation')

      const proposal = await postExtension(request, token, lease.id, { months: 12, monthlyRate: 1300, asProposal: true, expiresInDays: 7 })
      const proposalBody = await readJsonSafe<{ proposalId?: string; status?: string }>(proposal)
      expect(proposal.status(), JSON.stringify(proposalBody)).toBe(202)
      expect(proposalBody?.status).toBe('sending')

      const second = await postExtension(request, token, lease.id, { months: 3, monthlyRate: 1300, asProposal: true, expiresInDays: 7 })
      expect(second.status(), 'one open proposal per lease').toBe(409)
      expect((await readJsonSafe<{ code?: string }>(second))?.code).toBe('lease_proposal_open')
      const direct = await postExtension(request, token, lease.id, { months: 3, monthlyRate: 1300, asProposal: false })
      expect(direct.status(), 'no direct extension while a proposal is open').toBe(409)

      const end = await apiRequest(request, 'POST', `/api/property_management/leases/${lease.id}/end`, {
        token,
        data: { endsOn: addIsoDays(active.lease.endsOn, -10), settlement: 'keep' },
      })
      if (salesCancelUnavailable(active)) {
        await expectBillingCancelRefused(end)
        const kept = await readLease(request, token, lease.id)
        expect(kept?.proposals.find((entry) => entry.id === proposalBody?.proposalId)?.status, 'a refused end keeps the proposal open').not.toBe('withdrawn')
        test.skip(true, SALES_CANCEL_SKIP_REASON)
        return
      }
      expect([200, 202]).toContain(end.status())
      const after = await readLease(request, token, lease.id)
      expect(after?.proposals.find((entry) => entry.id === proposalBody?.proposalId)?.status, 'ending withdraws the open extension proposal').toBe('withdrawn')
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })
})
