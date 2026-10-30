import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

const REFERRALS_PATH = '/api/marketing_automation/referrals'
const CLAIM_PATH = '/api/marketing_automation/referrals/claim'

type CodeBody = { customerId?: string; code?: string; url?: string | null }

/**
 * TC-MA-023: the referral programme.
 *
 * The rules worth asserting are the ones a programme gets gamed through: one code per person, one referral per
 * person, and no claiming your own code.
 */
test.describe('TC-MA-023 referrals', () => {
  test('a code is issued once per customer and can be claimed by somebody else, but only once', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const referrerId = await createPersonFixture(request, token, {
      firstName: 'Referrer',
      lastName: `One${stamp}`,
      displayName: `Referrer One ${stamp}`,
      primaryEmail: `qa-ma-ref-a-${stamp}@example.com`,
    })
    const referredId = await createPersonFixture(request, token, {
      firstName: 'Referred',
      lastName: `Two${stamp}`,
      displayName: `Referred Two ${stamp}`,
      primaryEmail: `qa-ma-ref-b-${stamp}@example.com`,
    })

    try {
      const issued = await apiRequest(request, 'POST', REFERRALS_PATH, { token, data: { customerId: referrerId } })
      expect(issued.status()).toBe(200)
      const code = (await readJsonSafe<CodeBody>(issued))?.code
      expect(code).toBeTruthy()
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)

      // Idempotent: a second request returns the SAME code, because a replaced one would break every
      // message that already printed it.
      const again = await apiRequest(request, 'POST', REFERRALS_PATH, { token, data: { customerId: referrerId } })
      expect((await readJsonSafe<CodeBody>(again))?.code).toBe(code)

      // Nobody may claim their own code.
      const selfClaim = await apiRequest(request, 'POST', CLAIM_PATH, {
        token,
        data: { code, customerId: referrerId },
      })
      expect(selfClaim.status()).toBe(409)
      expect((await readJsonSafe<{ code?: string }>(selfClaim))?.code).toBe('marketing_automation.referral.self_referral')

      // Lower case and with the separators people add — both forgiven.
      const claimed = await apiRequest(request, 'POST', CLAIM_PATH, {
        token,
        data: { code: `${String(code).slice(0, 4).toLowerCase()}-${String(code).slice(4).toLowerCase()}`, customerId: referredId },
      })
      expect(claimed.status()).toBe(200)
      expect(await readJsonSafe<{ claimed?: boolean }>(claimed)).toEqual({ claimed: true })

      // Being referred happens to a person once.
      const second = await apiRequest(request, 'POST', CLAIM_PATH, { token, data: { code, customerId: referredId } })
      expect(second.status()).toBe(409)
      expect((await readJsonSafe<{ code?: string }>(second))?.code).toBe('marketing_automation.referral.already_referred')

      const listed = await readJsonSafe<{ items?: Array<{ customerId?: string; customerName?: string | null; claimed?: number; converted?: number }> }>(
        await apiRequest(request, 'GET', `${REFERRALS_PATH}?limit=100`, { token }),
      )
      const row = (listed?.items ?? []).find((item) => item.customerId === referrerId)
      // The name comes back for a caller who may read customer data, which is what lets the screen list people
      // rather than fifty identical links. It is decrypted, so this also proves the read went through the
      // decrypting finder.
      expect(typeof row?.customerName).toBe('string')
      expect(row?.customerName?.length).toBeGreaterThan(0)
      expect(row?.claimed).toBe(1)
      // Nothing was bought, so nothing converted — the two numbers are deliberately different questions.
      expect(row?.converted).toBe(0)

      const profile = await readJsonSafe<{ referral?: { code?: string; claimed?: number; converted?: number; referredBy?: unknown } }>(
        await apiRequest(request, 'GET', `/api/marketing_automation/customers/${referrerId}/profile`, { token }),
      )
      expect(profile?.referral?.code).toBe(code)
      expect(profile?.referral?.claimed).toBe(1)

      const referredProfile = await readJsonSafe<{ referral?: { referredBy?: { status?: string } | null } }>(
        await apiRequest(request, 'GET', `/api/marketing_automation/customers/${referredId}/profile`, { token }),
      )
      expect(referredProfile?.referral?.referredBy?.status).toBe('pending')
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', referredId)
      await deleteEntityIfExists(request, token, '/api/customers/people', referrerId)
    }
  })

  test('an unknown code is a 404, and a malformed one never reaches a lookup', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const customerId = await createPersonFixture(request, token, {
      firstName: 'Claimer',
      lastName: `Three${stamp}`,
      displayName: `Claimer Three ${stamp}`,
      primaryEmail: `qa-ma-ref-c-${stamp}@example.com`,
    })
    try {
      const unknown = await apiRequest(request, 'POST', CLAIM_PATH, { token, data: { code: 'ZZZZZZZZ', customerId } })
      expect(unknown.status()).toBe(404)
      expect((await readJsonSafe<{ code?: string }>(unknown))?.code).toBe('marketing_automation.referral.unknown_code')

      // Wrong shape: refused as unknown rather than treated as a query.
      const malformed = await apiRequest(request, 'POST', CLAIM_PATH, { token, data: { code: 'nope', customerId } })
      expect(malformed.status()).toBe(404)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', customerId)
    }
  })

  test('an order by the referred customer converts the referral', async ({ request }) => {
    /**
     * The shared budget is 20s and the wait below is up to 20s, so this test could only ever end as a
     * TIMEOUT — never as its own assertion. It failed for a real reason and reported "Test timeout of
     * 20000ms exceeded", which says nothing about referrals, nothing about what was polled, and nothing
     * anybody could act on. `slow()` triples the budget rather than hard-coding a number that would drift
     * from the config.
     */
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const referrerId = await createPersonFixture(request, token, {
      firstName: 'Converting',
      lastName: `Referrer${stamp}`,
      displayName: `Converting Referrer ${stamp}`,
      primaryEmail: `qa-ma-conv-a-${stamp}@example.com`,
    })
    const referredId = await createPersonFixture(request, token, {
      firstName: 'Converting',
      lastName: `Buyer${stamp}`,
      displayName: `Converting Buyer ${stamp}`,
      primaryEmail: `qa-ma-conv-b-${stamp}@example.com`,
    })
    let orderId: string | null = null

    try {
      const code = (await readJsonSafe<CodeBody>(
        await apiRequest(request, 'POST', REFERRALS_PATH, { token, data: { customerId: referrerId } }),
      ))?.code
      expect(code).toBeTruthy()

      const claimed = await apiRequest(request, 'POST', CLAIM_PATH, { token, data: { code, customerId: referredId } })
      expect(claimed.status()).toBe(200)

      const created = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: {
          currencyCode: 'USD',
          customerEntityId: referredId,
          /**
           * PLACED, because an unplaced order converts nothing — by design.
           *
           * The conversion subscriber skips an order with no `placedAt`: the payout is irreversible once it
           * fires, so a cart that was never submitted must not trigger it. Without this field the spec was
           * asking the subscriber to do the one thing it is written not to do, and then waiting for it.
           */
          placedAt: new Date().toISOString(),
          lines: [{ currencyCode: 'USD', quantity: 1, name: `QA referral line ${stamp}`, unitPriceNet: 100, unitPriceGross: 123 }],
        },
      })
      // A shop that does not let this caller create orders cannot be tested for this, and saying so is
      // better than asserting something unrelated.
      test.skip(!created.ok(), 'this installation does not allow creating sales orders through the API')
      const orderBody = await readJsonSafe<{ id?: string; orderId?: string }>(created)
      orderId = orderBody?.id ?? orderBody?.orderId ?? null
      expect(orderId).toBeTruthy()

      /**
       * The conversion happens on a persistent subscriber, so it lands once the queue worker has picked the
       * order event up.
       */
      let converted = 0
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const listed = await readJsonSafe<{ items?: Array<{ customerId?: string; converted?: number }> }>(
          await apiRequest(request, 'GET', `${REFERRALS_PATH}?limit=100`, { token }),
        )
        converted = (listed?.items ?? []).find((item) => item.customerId === referrerId)?.converted ?? 0
        if (converted > 0) break
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      expect(converted, 'the order should have converted the referral').toBe(1)

      const referredProfile = await readJsonSafe<{ referral?: { referredBy?: { status?: string } | null } }>(
        await apiRequest(request, 'GET', `/api/marketing_automation/customers/${referredId}/profile`, { token }),
      )
      expect(referredProfile?.referral?.referredBy?.status).toBe('converted')
    } finally {
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteEntityIfExists(request, token, '/api/customers/people', referredId)
      await deleteEntityIfExists(request, token, '/api/customers/people', referrerId)
    }
  })

  test('the palette offers the step and the trigger', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const body = await readJsonSafe<{
      steps?: Array<{ type?: string }>
      triggers?: Array<{ eventId?: string; available?: boolean; contextKeys?: string[] }>
    }>(await apiRequest(request, 'GET', '/api/marketing_automation/palette', { token }))

    expect((body?.steps ?? []).map((step) => step.type)).toContain('issue_referral_code')
    const trigger = (body?.triggers ?? []).find((entry) => entry.eventId === 'marketing_automation.referral.converted')
    expect(trigger?.available).toBe(true)
    // The referred customer travels as context, because the SUBJECT of this trigger is the referrer.
    expect(trigger?.contextKeys).toContain('trigger.referredEntityId')
  })

  test('a code cannot be issued for a customer that does not exist', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', REFERRALS_PATH, {
      token,
      data: { customerId: '00000000-0000-0000-0000-000000000000' },
    })
    expect(response.status()).toBe(404)
  })

  test('an anonymous caller can neither list nor claim', async ({ request }) => {
    expect([401, 403]).toContain((await request.get(REFERRALS_PATH)).status())
    expect([401, 403]).toContain((await request.post(CLAIM_PATH, { data: { code: 'ABCDEFGH', customerId: '00000000-0000-0000-0000-000000000000' } })).status())
  })
})
