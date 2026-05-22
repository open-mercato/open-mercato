import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { listPlans, STARTER_PRICE_CODE, syncPlans } from './helpers/fixtures'

test.describe('TC-SUB-001: subscription plan sync idempotency', () => {
  test('provisions provider refs and remains rerunnable without duplicate catalog rows', async ({ request }) => {
    const token = await getAuthToken(request)

    const first = await syncPlans(request, token)
    expect(first.providerEnsured).toBeGreaterThanOrEqual(2)

    const before = await listPlans(request, token)
    const second = await syncPlans(request, token)
    const after = await listPlans(request, token)

    expect(second.providerEnsured).toBeGreaterThanOrEqual(2)
    expect(after.items.map((plan) => plan.code).sort()).toEqual(before.items.map((plan) => plan.code).sort())
    expect(after.items.flatMap((plan) => plan.prices.map((price) => price.code))).toContain(STARTER_PRICE_CODE)
  })
})
