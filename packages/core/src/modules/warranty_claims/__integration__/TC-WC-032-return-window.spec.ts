import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  canManageSalesOrders,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  cleanupDraftClaimWithLines,
  createClaimFixture,
  readWarrantyClaimRisk,
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  submitAndExpect,
  uniqueLabel,
  type WarrantyClaimSettingsResult,
} from './helpers'

async function createAgedOrderFixture(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  placedDaysAgo: number,
): Promise<string> {
  const placedAt = new Date(Date.now() - placedDaysAgo * 86_400_000).toISOString()
  const response = await apiRequest(request, 'POST', '/api/sales/orders', {
    token,
    data: { currencyCode: 'USD', placedAt },
  })
  const body = await readJsonSafe<{ id?: string | null; orderId?: string | null }>(response)
  expect(response.status(), `aged order create should return 201: ${JSON.stringify(body)}`).toBe(201)
  const orderId = body?.id ?? body?.orderId ?? null
  expect(orderId, 'aged order create should return an id').toBeTruthy()
  return orderId as string
}

function windowClaimBody(orderId: string, stamp: string, claimType: 'return' | 'warranty'): Record<string, unknown> {
  return {
    claimType,
    channel: 'staff',
    orderId,
    currencyCode: 'USD',
    lines: [
      {
        lineNo: 1,
        sku: `WC-032-${stamp}`,
        productName: 'QA return-window product',
        qtyClaimed: 1,
      },
    ],
  }
}

test.describe('TC-WC-032: return-window eligibility policy', () => {
  test('round-trips the setting and flags out-of-window returns without blocking them', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-032')
    let settingsBefore: WarrantyClaimSettingsResult | null = null
    let agedOrderId: string | null = null
    let freshOrderId: string | null = null
    let agedClaimId: string | null = null
    let warrantyClaimId: string | null = null
    let freshClaimId: string | null = null

    try {
      if (!(await canManageSalesOrders(request, token))) {
        test.skip(true, 'sales order management is unavailable for the admin role on this database')
      }
      settingsBefore = await readWarrantyClaimSettings(request, token)

      const saved = await saveWarrantyClaimSettings(request, token, { returnWindowDays: 30 }, settingsBefore.updatedAt)
      expect(saved.returnWindowDays, 'settings save should round-trip returnWindowDays').toBe(30)
      const reread = await readWarrantyClaimSettings(request, token)
      expect(reread.returnWindowDays, 'settings read should return the saved window').toBe(30)

      agedOrderId = await createAgedOrderFixture(request, token, 90)
      freshOrderId = await createAgedOrderFixture(request, token, 1)

      const agedClaim = await createClaimFixture(request, token, windowClaimBody(agedOrderId, `${stamp}-aged`, 'return'))
      agedClaimId = agedClaim.id ?? null
      const submitted = await submitAndExpect(request, token, agedClaim)
      expect(submitted.status, 'out-of-window claim still submits (advisory, never a deny)').toBe('submitted')

      const agedRisk = await readWarrantyClaimRisk(request, token, agedClaim.id!)
      const windowSignal = agedRisk.signals.find((signal) => signal.id === 'outside_return_window')
      expect(windowSignal, `risk should include outside_return_window: ${JSON.stringify(agedRisk.signals)}`).toBeTruthy()
      expect(['medium', 'high']).toContain(windowSignal?.level ?? '')

      const warrantyClaim = await createClaimFixture(request, token, windowClaimBody(agedOrderId, `${stamp}-wty`, 'warranty'))
      warrantyClaimId = warrantyClaim.id ?? null
      const warrantyRisk = await readWarrantyClaimRisk(request, token, warrantyClaim.id!)
      expect(
        warrantyRisk.signals.some((signal) => signal.id === 'outside_return_window'),
        'warranty claims are not window-gated',
      ).toBe(false)

      const freshClaim = await createClaimFixture(request, token, windowClaimBody(freshOrderId, `${stamp}-fresh`, 'return'))
      freshClaimId = freshClaim.id ?? null
      const freshRisk = await readWarrantyClaimRisk(request, token, freshClaim.id!)
      expect(
        freshRisk.signals.some((signal) => signal.id === 'outside_return_window'),
        'in-window returns carry no window signal',
      ).toBe(false)

      const cleared = await saveWarrantyClaimSettings(request, token, { returnWindowDays: null }, reread.updatedAt)
      expect(cleared.returnWindowDays, 'setting clears back to null').toBeNull()
      const disabledRisk = await readWarrantyClaimRisk(request, token, agedClaim.id!)
      expect(
        disabledRisk.signals.some((signal) => signal.id === 'outside_return_window'),
        'null setting disables the signal entirely',
      ).toBe(false)
    } finally {
      await cleanupDraftClaimWithLines(request, token, freshClaimId)
      await cleanupDraftClaimWithLines(request, token, warrantyClaimId)
      await cancelThenDeleteClaimIfPossible(request, token, agedClaimId)
      if (agedOrderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', agedOrderId)
      if (freshOrderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', freshOrderId)
      await restoreWarrantyClaimSettings(request, token, settingsBefore)
    }
  })
})
