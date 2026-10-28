import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { stampOf } from './helpers'
import {
  cleanupLeaseSetup,
  createLease,
  createLeaseSetup,
  isActivated,
  isoDayFromToday,
  readLease,
  runLeaseSweep,
  waitForLease,
  type LeaseSetup,
} from './leaseFixtures'

/**
 * TC-PM-017: lease sweep
 * The daily `property_management.lease_sweep` expires proposals whose respond-by date has passed
 * (the unit is free again) and never ends a lease whose billing change is still pending. The
 * respond-by / end dates are moved into the past directly in the database — no API sets them.
 */
test.describe('TC-PM-017: lease sweep', () => {
  test('expires a proposal past its respond-by date and frees the unit', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp, { companies: 2 })
      const proposed = await createLease(request, token, setup, {
        unitId: setup.unitIds[0],
        customerCompanyId: setup.companyIds[0],
        startsOn: isoDayFromToday(30),
        termMonths: 12,
        asProposal: true,
        expiresInDays: 14,
      })
      const sent = await waitForLease(request, token, proposed.id, (detail) =>
        detail.proposals.some((proposal) => proposal.id === proposed.proposalId && proposal.status === 'sent'),
      )
      test.skip(!sent, 'the property_management.sales_operation worker did not run in this environment')
      await withClient((client) =>
        client.query('update property_management_lease_proposals set respond_by = $1 where id = $2', [isoDayFromToday(-1), proposed.proposalId]),
      )
      const swept = await runLeaseSweep(getTokenContext(token))
      test.skip(!swept, 'the property_management.lease_sweep worker did not run in this environment')

      const after = await readLease(request, token, proposed.id)
      expect(after?.lease.status).toBe('expired')
      expect(after?.proposals.find((proposal) => proposal.id === proposed.proposalId)?.status).toBe('expired')

      const next = await createLease(request, token, setup, {
        unitId: setup.unitIds[0],
        customerCompanyId: setup.companyIds[1],
        startsOn: isoDayFromToday(40),
        termMonths: 3,
      })
      expect(next.status, 'the expired proposal no longer reserves the unit').toBe('pending_order')
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })

  test('leaves a lease with a pending end alone', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp)
      const lease = await createLease(request, token, setup, {
        unitId: setup.unitIds[0],
        customerCompanyId: setup.companyIds[0],
        startsOn: isoDayFromToday(5),
        termMonths: 6,
      })
      const active = await waitForLease(request, token, lease.id, isActivated)
      test.skip(!active, 'the property_management.sales_operation worker did not run in this environment')
      const ended = await apiRequest(request, 'POST', `/api/property_management/leases/${lease.id}/end`, {
        token,
        data: { endsOn: isoDayFromToday(20), settlement: 'keep' },
      })
      expect([200, 202]).toContain(ended.status())
      const pending = await readLease(request, token, lease.id)
      test.skip(!pending?.pendingChange, 'the end settled before the sweep could observe it as pending')
      await withClient((client) =>
        client.query('update property_management_leases set ends_on = $1 where id = $2', [isoDayFromToday(-1), lease.id]),
      )
      const swept = await runLeaseSweep(getTokenContext(token))
      test.skip(!swept, 'the property_management.lease_sweep worker did not run in this environment')
      const after = await readLease(request, token, lease.id)
      expect(after?.pendingChange, 'the change is still pending').not.toBeNull()
      expect(after?.lease.status, 'the sweep skips a lease with a pending change').toBe('active')
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })
})
