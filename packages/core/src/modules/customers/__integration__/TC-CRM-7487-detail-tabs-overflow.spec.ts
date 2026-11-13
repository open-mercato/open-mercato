/**
 * TC-CRM-7487: CRM detail tab strips never scroll and every tab stays reachable
 *
 * On the three canonical CRM detail pages (people-v2, companies-v2, deals) at a desktop
 * width that used to overflow the strip (1024 x 900) and at a narrow width:
 * - once the injected tabs have loaded, the tab list has no horizontal or vertical scroll
 *   range (no native scrollbars)
 * - the last tab is reachable: through the More menu when the strip folds, otherwise
 *   with the keyboard (End), and it becomes the selected tab
 * - a tab chosen from the More menu is lifted inline, so the selection stays visible
 *
 * Below 768px people-v2 renders MobilePersonDetail, which opens on its Details zone with
 * the rail unmounted, so that page is loaded on its Activity zone and has to fold there.
 * Companies-v2 and deals have no mobile layout: their rail stays mounted and only folds
 * when the tabs do not fit, so both paths stay in play for them.
 *
 * Fixtures: one person, one company and one deal created through the API and removed in
 * `finally`. Needs the customers module only.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
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

const MOBILE_LAYOUT_MAX_WIDTH = 767

async function expectNoStripScroll(rail: Locator, label: string): Promise<void> {
  await expect(rail, label).toBeVisible({ timeout: 30_000 })
  const geometry = await rail.evaluate((element) => {
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

async function waitForInjectedTabs(page: Page, rail: Locator, label: string): Promise<void> {
  await expect(page.getByTestId('detail-tabs-row').filter({ has: rail }), `${label}: injected tabs have loaded`).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
}

async function reachLastTab(page: Page, rail: Locator, label: string): Promise<void> {
  await expect(async () => {
    const more = page.getByTestId('detail-tabs-more')
    if (await more.isVisible()) {
      await more.click({ timeout: 2_000 })
      const items = page.getByRole('menu', { name: 'More' }).getByRole('menuitem')
      const lastLabel = (await items.last().textContent({ timeout: 2_000 }))?.trim() ?? ''
      expect(lastLabel, `${label}: More menu lists the folded tabs`).not.toBe('')
      await items.last().click({ timeout: 2_000 })
      const lifted = rail.getByRole('tab', { name: new RegExp(`^${lastLabel.replace(/NEW$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
      await expect(lifted, `${label}: tab chosen from More is lifted inline`).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 })
      return
    }
    const tabs = rail.getByRole('tab')
    await tabs.first().focus({ timeout: 2_000 })
    await page.keyboard.press('End')
    await expect(tabs.last(), `${label}: End reaches the last tab`).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 })
  }, `${label}: last tab is reachable`).toPass({ timeout: 30_000 })
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

      const detailPages = [
        { route: `/backend/customers/people-v2/${personId}`, railName: 'Person detail sections', hasMobileLayout: true },
        { route: `/backend/customers/companies-v2/${companyId}`, railName: 'Company detail sections', hasMobileLayout: false },
        { route: `/backend/customers/deals/${dealId}`, railName: 'Deal detail sections', hasMobileLayout: false },
      ]
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        for (const { route, railName, hasMobileLayout } of detailPages) {
          const onMobileLayout = hasMobileLayout && viewport.width <= MOBILE_LAYOUT_MAX_WIDTH
          const label = `${route} @ ${viewport.width}px`
          await page.goto(onMobileLayout ? `${route}?zone=activity` : route, { waitUntil: 'domcontentloaded' })
          const rail = page.getByRole('tablist', { name: railName })
          await expect(rail, label).toBeVisible({ timeout: 30_000 })
          await waitForInjectedTabs(page, rail, label)
          await expectNoStripScroll(rail, label)
          if (onMobileLayout) {
            await expect(page.getByTestId('detail-tabs-more'), `${label}: person tabs fold at this width`).toBeVisible({ timeout: 30_000 })
          }
          await reachLastTab(page, rail, label)
          await expectNoStripScroll(rail, `${label} after selecting the last tab`)
        }
      }
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
