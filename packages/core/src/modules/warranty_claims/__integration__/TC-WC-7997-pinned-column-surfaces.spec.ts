import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { THEME_STORAGE_KEY } from '@open-mercato/ui/theme/theme-init-script'
import {
  createWarrantyVendorPolicyFixture,
  deleteWarrantyVendorPolicyIfExists,
} from './helpers'

const lists = [
  { name: 'claims', path: '/backend/warranty_claims', api: '/api/warranty_claims' },
  { name: 'registrations', path: '/backend/warranty_claims/registrations', api: '/api/warranty_claims/registrations' },
  { name: 'guides', path: '/backend/warranty_claims/troubleshooting-guides', api: '/api/warranty_claims/troubleshooting-guides' },
  { name: 'policies', path: '/backend/warranty_claims/vendor-policies', api: '/api/warranty_claims/vendor-policies' },
] as const

async function openList(page: Page, list: typeof lists[number], search: string) {
  const initialResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === list.api && response.request().method() === 'GET' && response.ok(),
  )
  await page.goto(list.path)
  await initialResponse
  const table = page.getByRole('table').first()
  await expect(table.locator('thead th').first()).toBeVisible()
  const searchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === list.api && url.searchParams.get('search') === search && response.ok()
  })
  await page.locator('[data-slot=search-input-wrapper] input').first().fill(search)
  await searchResponse
  return table
}

async function expectMatchingSurfaces(page: Page, cells: Locator, testInfo: TestInfo, checkpoint: string) {
  const points = await cells.evaluateAll((elements) => elements.flatMap((element) => {
    const bounds = element.getBoundingClientRect()
    const sampleX = Math.floor(bounds.left + 8)
    const sampleY = Math.floor(bounds.bottom - 7)
    if (bounds.width === 0 || sampleX < 0 || sampleX >= window.innerWidth || sampleY < 0 || sampleY >= window.innerHeight) return []
    return [{ tag: element.tagName, pinned: getComputedStyle(element).position === 'sticky', sampleX, sampleY }]
  }))
  const screenshot = await page.screenshot({ animations: 'disabled' })
  const colors = await page.evaluate(async ({ encoded, samples }) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('[internal] Canvas context unavailable')
    context.drawImage(bitmap, 0, 0)
    const result = samples.map((sample) => ({
      ...sample,
      rgb: Array.from(context.getImageData(sample.sampleX, sample.sampleY, 1, 1).data).slice(0, 3),
    }))
    bitmap.close()
    return result
  }, { encoded: screenshot.toString('base64'), samples: points })
  await testInfo.attach(checkpoint, { body: screenshot, contentType: 'image/png' })
  expect(colors.length, `${checkpoint}: visible table cells are required`).toBeGreaterThan(0)
  for (const tag of new Set(colors.map((color) => color.tag))) {
    const group = colors.filter((color) => color.tag === tag)
    const normal = group.find((color) => !color.pinned)
    expect(normal, `${checkpoint}: a visible normal ${tag} cell is required`).toBeTruthy()
    const pinned = group.filter((color) => color.pinned)
    expect(pinned, `${checkpoint}: both edge columns must be pinned`).toHaveLength(2)
    for (const cell of pinned) {
      const difference = Math.max(...cell.rgb.map((channel, index) => Math.abs(channel - normal!.rgb[index])))
      expect(difference, `${checkpoint}: pinned ${tag} ${cell.rgb} must match normal ${normal!.rgb}`).toBeLessThanOrEqual(1)
    }
  }
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`TC-WC-7997: pinned surfaces in ${theme} theme`, () => {
    test.use({ viewport: { width: 1280, height: 900 }, colorScheme: theme, deviceScaleFactor: 1 })
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: THEME_STORAGE_KEY, value: theme })
      await login(page, 'admin')
      await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(theme === 'dark')
    })

    for (const list of lists) {
      test(`${list.name}: empty pinned headers match the header strip`, async ({ page }, testInfo) => {
        const table = await openList(page, list, `no-results-${randomUUID()}`)
        await expect(table.locator('tbody td[colspan]')).toContainText(/no |nothing|empty/i)
        await page.mouse.move(0, 0)
        await expectMatchingSurfaces(page, table.locator('thead th'), testInfo, `${theme}-${list.name}-empty-header`)
      })
    }

    test('populated policy matches at rest and on hover, with mobile pinning disabled', async ({ page, request }, testInfo) => {
      const token = await getAuthToken(request, 'admin')
      let policyId: string | null = null
      try {
        const vendorName = `QA pinned surfaces ${randomUUID()}`
        const policy = await createWarrantyVendorPolicyFixture(request, token, { vendorName, coverageMonths: 12, isActive: true })
        policyId = policy.id
        const table = await openList(page, lists[3], vendorName)
        const row = table.locator('tbody tr').filter({ hasText: vendorName })
        await expect(row).toBeVisible()
        const cells = table.locator('thead th').or(row.locator('td'))
        await page.mouse.move(0, 0)
        await expectMatchingSurfaces(page, cells, testInfo, `${theme}-policy-rest`)
        await row.hover()
        await expectMatchingSurfaces(page, cells, testInfo, `${theme}-policy-hover`)
        await page.setViewportSize({ width: 600, height: 900 })
        await expect.poll(() => table.locator('[class*=sticky]').evaluateAll((elements) =>
          elements.every((element) => getComputedStyle(element).position !== 'sticky'),
        )).toBe(true)
      } finally {
        await deleteWarrantyVendorPolicyIfExists(request, token, policyId)
      }
    })
  })
}
