import { expect, test, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import * as dg from './helpers/document-generators-api'

async function openDocumentsTab(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const tab = page.getByRole('tab', { name: 'Documents', exact: true }).or(page.getByRole('button', { name: 'Documents', exact: true }))
  await expect(tab.first()).toBeVisible({ timeout: 30_000 })
  await tab.first().click()
}

async function generateFromCard(page: Page, templateLabel: string, downloadLabel: string): Promise<void> {
  const card = page.locator('li', { has: page.getByRole('heading', { name: templateLabel }) })
  await expect(card).toBeVisible({ timeout: 20_000 })
  await card.getByRole('button', { name: 'Preview' }).click()
  const dialog = page.getByRole('dialog')
  const downloadButton = dialog.getByRole('button', { name: downloadLabel })
  await expect(downloadButton).toBeVisible({ timeout: 30_000 })
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
  await downloadButton.click()
  await downloadPromise
  await dialog.getByRole('button', { name: 'Close' }).click()
}

test.describe('TC-DOCUMENT-022: scoped history on Sales Documents tabs', () => {
  test('order tab generates a PDF and shows only its own persisted row without reload', async ({ page, request }) => {
    test.slow()
    test.setTimeout(180_000)
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    let otherOrderId: string | null = null
    try {
      orderId = await dg.createOrderWithLine(request, token)
      otherOrderId = await dg.createOrderWithLine(request, token)
      await login(page, 'admin')
      await openDocumentsTab(page, `/backend/sales/documents/${orderId}?kind=order`)
      await expect(page.getByText('No generated documents found.')).toBeVisible({ timeout: 20_000 })

      await generateFromCard(page, 'Order invoice (PDF)', 'Download PDF')
      await expect(page.getByRole('row', { name: /Order invoice \(PDF\)/ })).toBeVisible({ timeout: 20_000 })

      const own = await dg.fetchResourceHistory(request, token, dg.ORDER_KIND, orderId)
      expect(own.items.map((row) => row.resourceId)).toEqual([orderId])
      const other = await dg.fetchResourceHistory(request, token, dg.ORDER_KIND, otherOrderId)
      expect(other.items).toHaveLength(0)

      await openDocumentsTab(page, `/backend/sales/documents/${otherOrderId}?kind=order`)
      await expect(page.getByText('No generated documents found.')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('row', { name: /Order invoice \(PDF\)/ })).toHaveCount(0)
    } finally {
      await dg.deleteOrder(request, token, orderId)
      await dg.deleteOrder(request, token, otherOrderId)
    }
  })

  test('quote tab generates a PDF and shows the persisted row without reload', async ({ page, request }) => {
    test.slow()
    test.setTimeout(180_000)
    const token = await getAuthToken(request, 'admin')
    let quoteId: string | null = null
    try {
      quoteId = await dg.createQuote(request, token)
      await login(page, 'admin')
      await openDocumentsTab(page, `/backend/sales/documents/${quoteId}?kind=quote`)
      await generateFromCard(page, 'Quote offer (PDF)', 'Download PDF')
      await expect(page.getByRole('row', { name: /Quote offer \(PDF\)/ })).toBeVisible({ timeout: 20_000 })
      const own = await dg.fetchResourceHistory(request, token, dg.QUOTE_KIND, quoteId)
      expect(own.items.map((row) => row.resourceId)).toEqual([quoteId])
    } finally {
      await dg.deleteQuote(request, token, quoteId)
    }
  })

  test('a successful generate with no persisted row stays valid', async () => {
    test.skip(
      true,
      'Requires forcing GenerationHistoryService.persist to fail, which needs a server-side fault injection hook; covered by the generate route unit test.',
    )
  })
})
