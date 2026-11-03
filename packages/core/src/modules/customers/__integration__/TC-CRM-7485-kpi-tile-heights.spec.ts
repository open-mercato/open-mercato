/**
 * TC-CRM-7485: KPI tiles on the company detail page share one outline per row
 *
 * With one open deal and no interactions the four tiles carry different content
 * (a trend caption on Active deals, a plain count on Activities, placeholders on LTV
 * and Client since), which used to leave their bottom borders misaligned. Verifies:
 * - at the four-column width every card has the same height and the same top/bottom
 * - at the two-column width each row of two keeps equal heights
 * - hiding a tile and restoring all tiles keeps the remaining cards aligned
 *
 * Fixtures: one company and one deal created through the API and removed in `finally`.
 */
import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

export const integrationMeta = { dependsOnModules: ['customers'] }

type CardBox = { top: number; bottom: number; height: number; width: number }

async function readCardBoxes(page: Page): Promise<CardBox[]> {
  const tiles = page.getByTestId('company-kpi-tile')
  await expect(tiles.first()).toBeVisible({ timeout: 30_000 })
  return tiles.evaluateAll((elements) =>
    elements.map((element) => {
      const card = element.firstElementChild as HTMLElement
      const rect = card.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width }
    }),
  )
}

function expectAlignedRows(boxes: CardBox[], label: string): void {
  const rows = new Map<number, CardBox[]>()
  for (const box of boxes) {
    const key = [...rows.keys()].find((top) => Math.abs(top - box.top) <= 1) ?? box.top
    rows.set(key, [...(rows.get(key) ?? []), box])
  }
  for (const [top, row] of rows) {
    const reference = row[0]
    for (const box of row) {
      expect(Math.abs(box.height - reference.height), `${label}: equal heights in the row at ${top}`).toBeLessThanOrEqual(1)
      expect(Math.abs(box.bottom - reference.bottom), `${label}: aligned bottom edges in the row at ${top}`).toBeLessThanOrEqual(1)
      expect(Math.abs(box.width - reference.width), `${label}: equal widths in the row at ${top}`).toBeLessThanOrEqual(1)
    }
  }
}

test.describe('TC-CRM-7485: company KPI tiles share one outline per row', () => {
  test('keeps card heights equal across content, breakpoints and hide/show', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    let token: string | null = null
    let companyId: string | null = null
    let dealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA 7485 Co ${stamp}`)
      dealId = await createDealFixture(request, token, { title: `QA 7485 Deal ${stamp}`, companyIds: [companyId] })
      await login(page, 'admin')

      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText('ACTIVE DEALS', { exact: true })).toBeVisible({ timeout: 30_000 })

      const wide = await readCardBoxes(page)
      expect(wide, 'four tiles render').toHaveLength(4)
      expect(new Set(wide.map((box) => Math.round(box.top))).size, 'four columns at 1440px').toBe(1)
      expectAlignedRows(wide, '1440px')

      await page.setViewportSize({ width: 1024, height: 900 })
      const medium = await readCardBoxes(page)
      expect(new Set(medium.map((box) => Math.round(box.top))).size, 'two rows at 1024px').toBe(2)
      expectAlignedRows(medium, '1024px')

      await page.setViewportSize({ width: 1440, height: 900 })
      const firstTile = page.getByTestId('company-kpi-tile').first()
      await firstTile.hover()
      await firstTile.getByRole('button', { name: 'Hide tile' }).click()
      const afterHide = await readCardBoxes(page)
      expect(afterHide, 'one tile hidden').toHaveLength(3)
      expectAlignedRows(afterHide, 'after hiding a tile')

      await page.getByRole('button', { name: 'Show all' }).click()
      const restored = await readCardBoxes(page)
      expect(restored, 'all tiles restored').toHaveLength(4)
      expectAlignedRows(restored, 'after Show all')
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
