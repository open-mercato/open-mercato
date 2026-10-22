import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createSalesOrderFixture,
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

type SalesDocument = {
  id: string
  orderNumber?: string | null
  quoteNumber?: string | null
}

test.describe('TC-SALES-7782: Native document UI with empty extension regions', () => {
  for (const kind of ['order', 'quote'] as const) {
    test(`preserves the ${kind} header, status and details without extension placeholders`, async ({ page, request }, testInfo) => {
      const token = await getAuthToken(request, 'admin')
      const apiPath = kind === 'order' ? '/api/sales/orders' : '/api/sales/quotes'
      let documentId: string | null = null

      try {
        documentId = kind === 'order'
          ? await createSalesOrderFixture(request, token)
          : await createSalesQuoteFixture(request, token)
        const documentResponse = await apiRequest(request, 'GET', `${apiPath}?id=${encodeURIComponent(documentId)}`, { token })
        expect(documentResponse.ok()).toBeTruthy()
        const payload = await readJsonSafe<{ items?: SalesDocument[] }>(documentResponse)
        const record = payload?.items?.find((entry) => entry.id === documentId)
        const documentNumber = kind === 'order' ? record?.orderNumber : record?.quoteNumber
        expect(documentNumber, 'The fixture should have a generated document number').toBeTruthy()
        if (!documentNumber) throw new Error('Sales document fixture has no document number')

        await login(page, 'admin')
        const documentWrites: string[] = []
        page.on('request', (outgoing) => {
          const url = new URL(outgoing.url())
          if (url.pathname === apiPath && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(outgoing.method())) {
            documentWrites.push(`${outgoing.method()} ${url.pathname}`)
          }
        })

        await page.goto(`/backend/sales/${kind === 'order' ? 'orders' : 'quotes'}/${documentId}`)
        const main = page.getByRole('main')
        const status = main.getByRole('button', { name: /^Status / })
        await expect(main.getByText(kind === 'order' ? 'Sales order' : 'Sales quote', { exact: true })).toBeVisible()
        await expect(main.getByText(documentNumber, { exact: true })).toBeVisible()
        await expect(status).toBeVisible()
        await expect(status).toHaveAccessibleName(/^Status .+ Edit$/)
        await expect(main.getByRole('button', { name: 'Items', exact: true })).toBeVisible()
        await expect(main.getByRole('button', { name: 'Addresses', exact: true })).toBeVisible()
        await expect(main.getByRole('button', { name: 'Adjustments', exact: true })).toBeVisible()
        await expect(main.getByRole('button', { name: 'Add item', exact: true })).toBeVisible()
        await expect(main.getByText('Details', { exact: true })).toBeVisible()
        await expect(main.getByRole('heading', { name: 'Custom data', exact: true })).toBeVisible()
        await expect(main.getByRole('heading', { name: 'Tags', exact: true })).toBeVisible()
        await expect(main.getByText(/^detail:sales\.(order|quote):(stage-bar|closure)$/)).toHaveCount(0)
        await expect(main.getByRole('progressbar')).toHaveCount(0)
        await expect(main.getByRole('button', { name: /^(mark as )?(won|lost)$/i })).toHaveCount(0)
        await expect(page.getByRole('dialog')).toHaveCount(0)

        await page.reload()
        await expect(main.getByText(documentNumber, { exact: true })).toBeVisible()
        await expect(status).toHaveAccessibleName(/^Status .+ Edit$/)
        await expect(main.getByRole('heading', { name: 'Custom data', exact: true })).toBeVisible()
        await expect(kind === 'order'
          ? main.getByText(/^QA seed line /)
          : main.getByText('No items yet.', { exact: true })).toBeVisible()
        await expect(main.getByText(/^Loading custom data/)).toHaveCount(0)
        expect(documentWrites, 'Reading and reloading a document must not trigger native status or closure writes').toEqual([])

        const screenshotPath = testInfo.outputPath(`sales-${kind}-empty-extension-regions.png`)
        await page.screenshot({ path: screenshotPath, fullPage: true })
        await testInfo.attach(`sales-${kind}-native-document`, { path: screenshotPath, contentType: 'image/png' })
      } finally {
        await deleteSalesEntityIfExists(request, token, apiPath, documentId)
      }
    })
  }
})
