import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createDealFixture,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

/**
 * #8382: the deal detail page's InlineActivityComposer header row (title +
 * "Schedule"/"Save activity" buttons) did not wrap at narrow viewports. The
 * Button primitive is `whitespace-nowrap shrink-0`, so the row's own
 * min-content width exceeded the 390px viewport and the excess painted
 * outside the card as scrollable overflow — `documentElement.scrollWidth`
 * (472) vs `clientWidth` (390). jsdom has no layout engine, so this can only
 * be pinned in a real browser.
 */
test.describe('TC-8382: deal detail activity composer does not overflow at 390px (#8382)', () => {
  test('the deal detail page cannot be scrolled sideways on a 390px viewport', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let dealId: string | null = null
    const stamp = Date.now()

    try {
      token = await getAuthToken(request)
      dealId = await createDealFixture(request, token, {
        title: `QA TC-8382 Deal ${stamp}`,
      })

      await login(page, 'admin')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/backend/customers/deals/${dealId}`, { waitUntil: 'domcontentloaded' })

      const saveButton = page.getByRole('button', { name: /Save activity/i }).first()
      await expect(saveButton).toBeVisible({ timeout: 30_000 })

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)

      const scrolledX = await page.evaluate(() => {
        window.scrollTo(9999, 0)
        return window.scrollX
      })
      expect(scrolledX, 'the document must not scroll horizontally').toBe(0)
    } finally {
      await deleteEntityByBody(request, token, '/api/customers/deals', dealId)
    }
  })
})
