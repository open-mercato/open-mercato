/**
 * TC-CRM-7487: CRM detail tab strips never scroll and every tab stays reachable
 *
 * On the three canonical CRM detail pages (people-v2, companies-v2, deals) at a desktop
 * width that used to overflow the strip (1024 x 900) and at a narrow width:
 * - the tab list has no horizontal or vertical scroll range (no native scrollbars)
 * - the last tab is reachable: through the More menu when the strip folds, otherwise
 *   with the keyboard (End), and it becomes the selected tab
 * - a tab chosen from the More menu is lifted inline, so the selection stays visible
 *
 * Fixtures: one person, one company and one deal created through the API and removed in
 * `finally`. Needs the customers module only.
 */
import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

export const integrationMeta = { dependsOnModules: ['customers'] }

const VIEWPORTS = [
  { width: 1024, height: 900 },
  { width: 760, height: 900 },
]

async function expectNoStripScroll(page: Page, label: string): Promise<void> {
  const tabList = page.getByRole('tablist').first()
  await expect(tabList, label).toBeVisible({ timeout: 30_000 })
  const geometry = await tabList.evaluate((element) => {
    const strip = element.parentElement?.parentElement ?? element
    return {
      stripScrollWidth: strip.scrollWidth,
      stripClientWidth: strip.clientWidth,
      listScrollHeight: element.scrollHeight,
      listClientHeight: element.clientHeight,
      overflowX: getComputedStyle(element).overflowX,
    }
  })
  expect(geometry.stripScrollWidth, `${label}: strip has no horizontal scroll range`).toBeLessThanOrEqual(geometry.stripClientWidth + 1)
  expect(geometry.listScrollHeight, `${label}: tab list has no vertical scroll range`).toBeLessThanOrEqual(geometry.listClientHeight + 1)
  expect(geometry.overflowX, `${label}: tab list does not scroll`).not.toBe('auto')
}

async function reachLastTab(page: Page, label: string): Promise<void> {
  const more = page.getByTestId('detail-tabs-more')
  if (await more.isVisible().catch(() => false)) {
    await more.click()
    const items = page.getByRole('menuitem')
    const lastLabel = (await items.last().textContent())?.trim() ?? ''
    expect(lastLabel, `${label}: More menu lists the folded tabs`).not.toBe('')
    await items.last().click()
    const lifted = page.getByRole('tab', { name: new RegExp(`^${lastLabel.replace(/NEW$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
    await expect(lifted, `${label}: tab chosen from More is lifted inline`).toHaveAttribute('aria-selected', 'true')
    return
  }
  const tabs = page.getByRole('tab')
  await tabs.first().focus()
  await page.keyboard.press('End')
  await expect(tabs.last(), `${label}: End reaches the last tab`).toHaveAttribute('aria-selected', 'true')
}

test.describe('TC-CRM-7487: CRM detail tab strips do not scroll', () => {
  test('keeps every tab reachable without scrollbars on person, company and deal pages', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    let token: string | null = null
    let personId: string | null = null
    let companyId: string | null = null
    let dealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA 7487 Co ${stamp}`)
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: `Person ${stamp}`, displayName: `QA 7487 Person ${stamp}`, companyEntityId: companyId })
      dealId = await createDealFixture(request, token, { title: `QA 7487 Deal ${stamp}`, companyIds: [companyId] })
      await login(page, 'admin')

      const routes = [
        `/backend/customers/people-v2/${personId}`,
        `/backend/customers/companies-v2/${companyId}`,
        `/backend/customers/deals/${dealId}`,
      ]
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        for (const route of routes) {
          const label = `${route} @ ${viewport.width}px`
          await page.goto(route, { waitUntil: 'domcontentloaded' })
          await expect(page.getByRole('tab').first(), label).toBeVisible({ timeout: 30_000 })
          await expectNoStripScroll(page, label)
          await reachLastTab(page, label)
          await expectNoStripScroll(page, `${label} after selecting the last tab`)
        }
      }
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
