import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

export const integrationMeta = { dependsOnModules: ['catalog', 'attachments'] }

async function openCreateForm(page: Page) {
  await login(page, 'admin')
  await page.goto('/backend/catalog/products/create', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByPlaceholder('e.g., Summer sneaker')).toBeVisible()
}

async function expectViewportContained(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))).toEqual({ documentWidth: 390, viewportWidth: 390 })
}

test.describe('TC-CAT-046: Product-create mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('keeps every step reachable by pointer and keyboard without widening the document', async ({ page }, testInfo) => {
    await openCreateForm(page)
    const navigation = page.locator('nav').filter({
      has: page.getByRole('button', { name: 'General data', exact: true }),
    })
    const steps = [
      { name: 'General data', content: () => page.getByPlaceholder('e.g., Summer sneaker') },
      { name: 'Organize', content: () => page.getByRole('main').getByText('Categories', { exact: true }) },
      { name: 'Units of measure', content: () => page.getByLabel('Base unit', { exact: true }) },
      { name: 'Compliance & commerce', content: () => page.getByLabel('Country of origin (ISO code)', { exact: true }) },
      { name: 'Variants', content: () => page.getByLabel('Yes, this is a product with variants') },
    ]
    await expect(navigation.getByRole('button')).toHaveCount(steps.length)
    await expectViewportContained(page)
    await page.getByPlaceholder('e.g., Summer sneaker').fill('long-product-name-'.repeat(30))
    for (const step of steps) {
      const button = navigation.getByRole('button', { name: step.name, exact: true })
      await expect(button).toBeInViewport({ ratio: 1 })
      await button.click()
      await expect(step.content()).toBeVisible()
      await expectViewportContained(page)
    }
    await navigation.getByRole('button', { name: steps[0].name, exact: true }).focus()
    for (const [index, step] of steps.entries()) {
      if (index > 0) await page.keyboard.press('Tab')
      await expect(navigation.getByRole('button', { name: step.name, exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(step.content()).toBeVisible()
      await expectViewportContained(page)
    }
    await page.screenshot({ path: testInfo.outputPath('mobile-steps.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect.poll(() => navigation.getByRole('button').evaluateAll((buttons) =>
      new Set(buttons.map((button) => button.getBoundingClientRect().top)).size,
    )).toBe(1)
    await expect(navigation).toBeInViewport({ ratio: 1 })
  })

  test('keeps long media filenames and upload, default, and remove controls usable', async ({ page, request }, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    let attachmentId: string | null = null
    const filename = `product-${'long-filename-'.repeat(12)}.png`
    try {
      await openCreateForm(page)
      const chooseFiles = page.getByRole('button', { name: 'Choose files', exact: true })
      await expectViewportContained(page)
      const chooser = page.waitForEvent('filechooser')
      await chooseFiles.click()
      const uploadResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/attachments',
      )
      await (await chooser).setFiles({
        name: filename,
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
      })
      const uploaded = await uploadResponse
      expect(uploaded.ok()).toBeTruthy()
      const body = await uploaded.json() as { item: { id: string } }
      attachmentId = body.item.id
      const mediaCard = page.getByText(filename, { exact: true }).locator('xpath=../..')
      await expect(page.getByRole('img', { name: filename, exact: true })).toBeVisible()
      await expect(mediaCard.getByText('Default preview', { exact: true })).toBeVisible()
      await expect(chooseFiles).toBeEnabled()
      await expectViewportContained(page)
      await mediaCard.scrollIntoViewIfNeeded()
      for (const button of await mediaCard.getByRole('button').all()) {
        await expect(button).toBeInViewport({ ratio: 1 })
      }
      await mediaCard.getByRole('button').first().click()
      await expect(mediaCard.getByText('Default preview', { exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('mobile-long-media.png'), fullPage: true })
      await mediaCard.getByRole('button').last().focus()
      await page.keyboard.press('Enter')
      await expect(page.getByText(filename, { exact: true })).toHaveCount(0)
      await expectViewportContained(page)
    } finally {
      if (attachmentId) {
        await apiRequest(request, 'DELETE', `/api/attachments?id=${encodeURIComponent(attachmentId)}`, { token })
      }
    }
  })
})
