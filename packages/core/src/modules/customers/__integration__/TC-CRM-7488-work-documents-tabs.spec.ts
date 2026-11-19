/**
 * TC-CRM-7488: Pending work and Related documents live inside the CRM detail workspace
 *
 * Verifies on the three canonical CRM detail pages (people-v2, companies-v2, deals):
 * - neither panel renders as a detached card under the detail layout on landing
 * - both are reachable as tabs of the related-content workspace (inline or via the
 *   person page's More menu) and render their own heading once selected
 * - selecting one does not break the built-in tabs
 * - on a phone-width person page the Related documents actions stay inside the viewport
 *
 * Fixtures: one person, one company and one deal created through the API and removed in
 * `finally`. Needs the workflows and documents modules.
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

export const integrationMeta = { dependsOnModules: ['workflows', 'documents', 'customers'] }

const ACTIVITY_TAB = /^activit/i

async function openWorkspaceTab(page: Page, label: RegExp): Promise<void> {
  await expect(async () => {
    const tab = page.getByRole('tab', { name: label })
    if (await tab.isVisible()) {
      await tab.click()
      return
    }
    await page.getByTestId('detail-tabs-more').click({ timeout: 2_000 })
    await page.getByRole('menuitem', { name: label }).click({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
}

test.describe('TC-CRM-7488: work and documents inside the CRM detail workspace', () => {
  test('mounts both panels as tabs on person, company and deal pages', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    let token: string | null = null
    let personId: string | null = null
    let companyId: string | null = null
    let dealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA 7488 Co ${stamp}`)
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: `Person ${stamp}`, displayName: `QA 7488 Person ${stamp}`, companyEntityId: companyId })
      dealId = await createDealFixture(request, token, { title: `QA 7488 Deal ${stamp}`, companyIds: [companyId] })
      await login(page, 'admin')

      const routes = [
        `/backend/customers/people-v2/${personId}`,
        `/backend/customers/companies-v2/${companyId}`,
        `/backend/customers/deals/${dealId}`,
      ]
      for (const route of routes) {
        await page.goto(route, { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('tab', { name: ACTIVITY_TAB }), `workspace on ${route}`).toBeVisible({ timeout: 30_000 })

        await expect(page.getByRole('heading', { name: 'Pending work' }), `no detached Pending work on ${route}`).toHaveCount(0)
        await expect(page.getByRole('heading', { name: 'Related documents' }), `no detached Related documents on ${route}`).toHaveCount(0)

        await openWorkspaceTab(page, /^Pending work/)
        await expect(page.getByTestId('workflows-pending-work'), `Pending work tab on ${route}`).toBeVisible({ timeout: 30_000 })
        await expect(page.getByRole('heading', { name: 'Pending work' })).toHaveCount(1)

        await openWorkspaceTab(page, /^Related documents/)
        await expect(page.getByRole('heading', { name: 'Related documents' }), `Related documents tab on ${route}`).toBeVisible({ timeout: 30_000 })
        await expect(page.getByRole('heading', { name: 'Pending work' })).toHaveCount(0)

        await page.getByRole('tab', { name: ACTIVITY_TAB }).click()
        await expect(page.getByRole('tab', { name: ACTIVITY_TAB })).toHaveAttribute('aria-selected', 'true')
        await expect(page.getByRole('heading', { name: 'Related documents' })).toHaveCount(0)
      }
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('keeps the Related documents actions inside a 390px viewport on the person page', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    const phoneWidth = 390
    let token: string | null = null
    let personId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: `Phone ${stamp}`, displayName: `QA 7488 Phone ${stamp}` })
      await login(page, 'admin')

      await page.goto(`/backend/customers/people-v2/${personId}?tab=related-documents`, { waitUntil: 'domcontentloaded' })
      const main = page.getByRole('main')
      await expect(main.getByRole('heading', { name: 'Related documents' })).toBeVisible({ timeout: 30_000 })

      await page.setViewportSize({ width: phoneWidth, height: 844 })
      await main.getByRole('tab', { name: 'Activity', exact: true }).click()
      await expect(main.getByRole('heading', { name: 'Related documents' })).toBeVisible({ timeout: 30_000 })

      const actions = main.getByTestId('related-documents-actions')
      await expect(actions).toBeVisible()
      const buttons = actions.getByRole('button')
      await expect(buttons).toHaveCount(2)
      for (const button of await buttons.all()) {
        await button.scrollIntoViewIfNeeded()
        const box = await button.boundingBox()
        expect(box, 'action button is laid out').not.toBeNull()
        expect(box!.x, 'action button starts inside the viewport').toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width, 'action button ends inside the viewport').toBeLessThanOrEqual(phoneWidth)
      }
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
