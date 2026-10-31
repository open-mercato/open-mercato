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

test.describe('TC-SALES-7782: Document extension host contributors', () => {
  for (const kind of ['order', 'quote'] as const) {
    test(`mounts scoped ${kind} stage and closure contributions without document writes`, async ({ page, request }, testInfo) => {
      const token = await getAuthToken(request, 'admin')
      const apiPath = kind === 'order' ? '/api/sales/orders' : '/api/sales/quotes'
      let documentId: string | null = null
      try {
        documentId = kind === 'order'
          ? await createSalesOrderFixture(request, token)
          : await createSalesQuoteFixture(request, token)
        await login(page, 'admin')
        await page.addInitScript(() => {
          const contributions = ['order', 'quote'].flatMap((documentKind) =>
            ['stage-bar', 'closure'].map((surface) => ({
              id: `qa.sales.${documentKind}.${surface}`,
              spot: `detail:sales.${documentKind}:${surface}`,
              documentKind,
              surface,
            })),
          )
          const widgets = contributions.map((contribution) => ({
            moduleId: 'sales', key: contribution.id, widgetId: contribution.id,
            loader: async () => ({ default: {
              metadata: { id: contribution.id, title: contribution.id },
              Widget: ({ context, data }: {
                context: { kind: string; documentId: string; organizationId: string | null; tenantId: string | null; resourceKind: string; resourceId: string; record: { id: string }; retryLastMutation: unknown }
                data: { id: string }
              }) => ({
                $$typeof: Symbol.for('react.transitional.element'), type: 'p', key: null,
                props: { 'data-testid': contribution.id, children: [
                contribution.id, context.kind, context.documentId,
                context.organizationId, context.tenantId,
                context.resourceKind, context.resourceId,
                context.record.id, data.id, typeof context.retryLastMutation,
              ].join('|') },
              }),
            } }),
          }))
          const table = Object.fromEntries(contributions.map((contribution) => [contribution.spot, contribution.id]))
          const additions: Record<string, unknown[]> = {
            __openMercatoCoreInjectionWidgetEntries__: widgets,
            __openMercatoCoreInjectionTables__: [{ moduleId: 'sales', table }],
          }
          for (const [key, contribution] of Object.entries(additions)) {
            let registered: unknown[] = []
            Object.defineProperty(globalThis, key, {
              configurable: true,
              get: () => [...registered, ...contribution],
              set: (value: unknown) => { registered = Array.isArray(value) ? value : [] },
            })
          }
        })
        const writes: string[] = []
        page.on('request', (outgoing) => {
          if (new URL(outgoing.url()).pathname === apiPath && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(outgoing.method())) {
            writes.push(outgoing.method())
          }
        })
        await page.goto(`/backend/sales/${kind === 'order' ? 'orders' : 'quotes'}/${documentId}`)
        const main = page.getByRole('main')
        const documentResponse = await apiRequest(request, 'GET', `${apiPath}?id=${documentId}`, { token })
        expect(documentResponse.ok()).toBeTruthy()
        const payload = await readJsonSafe<{ items?: Array<{ id: string; organizationId: string; tenantId: string }> }>(documentResponse)
        const record = payload?.items?.find((entry) => entry.id === documentId)
        expect(record?.organizationId).toBeTruthy()
        expect(record?.tenantId).toBeTruthy()
        for (const surface of ['stage-bar', 'closure']) {
          const expected = [
            `qa.sales.${kind}.${surface}`, kind, documentId,
            record?.organizationId, record?.tenantId,
            `sales.${kind}`, documentId, documentId, documentId, 'function',
          ].join('|')
          const widget = main.getByTestId(`qa.sales.${kind}.${surface}`)
          await expect(widget).toBeVisible()
          await expect(widget).toHaveText(expected)
        }
        await expect(main.getByText(new RegExp(`^qa\\.sales\\.${kind === 'order' ? 'quote' : 'order'}\\.`))).toHaveCount(0)
        await expect(main.getByRole('button', { name: /^Status / })).toBeVisible()
        await expect(main.getByRole('heading', { name: 'Custom data', exact: true })).toBeVisible()
        expect(writes).toEqual([])
        const desktopScreenshot = testInfo.outputPath(`${kind}-contributors-desktop.png`)
        await page.screenshot({ path: desktopScreenshot, fullPage: true })
        await testInfo.attach(`${kind}-contributors-desktop`, { path: desktopScreenshot, contentType: 'image/png' })
        await page.setViewportSize({ width: 390, height: 844 })
        await expect(main.getByText(new RegExp(`^qa\\.sales\\.${kind}\\.stage-bar\\|`))).toBeVisible()
        const mobileScreenshot = testInfo.outputPath(`${kind}-contributors-mobile.png`)
        await page.screenshot({ path: mobileScreenshot, fullPage: true })
        await testInfo.attach(`${kind}-contributors-mobile`, { path: mobileScreenshot, contentType: 'image/png' })
      } finally {
        await deleteSalesEntityIfExists(request, token, apiPath, documentId)
      }
    })
  }
})
