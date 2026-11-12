import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['eudr', 'customers'] }

const HTML_NAME = '<strong data-eudr-popup-probe="literal">Coffee & cocoa</strong>'
const ORDINARY_NAME = 'Ordinary coffee plot'

type Fixture = { path: string; id: string }

async function cleanupFixtures(request: APIRequestContext, token: string, fixtures: Fixture[]) {
  const failures: string[] = []
  for (const record of [...fixtures].reverse()) {
    try {
      const response = await apiRequest(request, 'DELETE', `${record.path}?id=${record.id}`, { token })
      if (!response.ok()) failures.push(`${record.path}/${record.id}: ${response.status()}`)
    } catch (error) {
      failures.push(`${record.path}/${record.id}: ${String(error)}`)
    }
  }
  expect(failures, 'all fixtures must be removed').toEqual([])
}


function feature(name?: string) {
  return {
    type: 'Feature',
    properties: name === undefined ? {} : { name },
    geometry: { type: 'Point', coordinates: [-3.9876543, 5.1234567] },
  }
}

async function createRecord(request: APIRequestContext, token: string, path: string, data: Record<string, unknown>) {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.status(), `create ${path}`).toBe(201)
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, `create ${path} returns an id`)
}

async function expectPopup(page: Page, name?: string) {
  const marker = page.locator('.leaflet-overlay-pane path.leaflet-interactive')
  await expect(marker).toHaveCount(1)
  await expect(marker).toBeVisible()
  await marker.click()
  const popup = page.locator('.leaflet-popup-content')
  if (name === undefined) {
    await expect(popup).toHaveCount(0)
  } else {
    await expect(popup).toHaveText(name)
    await expect(popup.locator('strong, [data-eudr-popup-probe]')).toHaveCount(0)
  }
  await expect(page.locator('[data-eudr-popup-probe]')).toHaveCount(0)
}

async function replacePreview(page: Page, name?: string) {
  await page.getByPlaceholder('Paste GeoJSON geometry', { exact: true }).fill(JSON.stringify(feature(name)))
  await expect(page.locator('.leaflet-popup-content')).toHaveCount(0)
  await expectPopup(page, name)
}

test.describe('TC-EUDR-020: Literal GeoJSON popup names in real consumers', () => {
  test('create and persisted edit previews replace layers and render names as text', async ({ page, request }, testInfo) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const cleanup: Fixture[] = []
    try {
      const supplierId = await createCompanyFixture(request, token, `TC-EUDR-020 ${randomUUID()}`)
      cleanup.push({ path: '/api/customers/companies', id: supplierId })
      const plotId = await createRecord(request, token, '/api/eudr/plots', {
        supplierEntityId: supplierId, name: `Popup ${randomUUID()}`, originCountry: 'CI',
        geometry: feature(HTML_NAME), areaHa: 1,
      })
      cleanup.push({ path: '/api/eudr/plots', id: plotId })
      const persisted = await apiRequest(request, 'GET', `/api/eudr/plots?ids=${plotId}`, { token })
      expect(persisted.status()).toBe(200)
      expect((await readJsonSafe<{ items: Array<{ geometry: unknown }> }>(persisted))?.items[0]?.geometry).toEqual(feature(HTML_NAME))

      await login(page, 'admin')
      await page.goto('/backend/eudr/plots/create')
      await page.getByRole('button', { name: 'Paste JSON', exact: true }).click()
      await replacePreview(page, HTML_NAME)
      await page.screenshot({ path: testInfo.outputPath('create-literal-popup.png') })
      await replacePreview(page, ORDINARY_NAME)
      await replacePreview(page)
      await replacePreview(page, HTML_NAME)

      await page.goto(`/backend/eudr/plots/${plotId}`)
      await page.reload()
      await expectPopup(page, HTML_NAME)
      await page.screenshot({ path: testInfo.outputPath('edit-literal-popup.png') })
      await replacePreview(page, ORDINARY_NAME)
      await replacePreview(page)
      await replacePreview(page, HTML_NAME)
    } finally {
      await cleanupFixtures(request, token, cleanup)
    }
  })

  test('statement detail reloads persisted HTML-looking, ordinary and missing names', async ({ page, request }, testInfo) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const cleanup: Fixture[] = []
    try {
      const supplierId = await createCompanyFixture(request, token, `TC-EUDR-020 ${randomUUID()}`)
      cleanup.push({ path: '/api/customers/companies', id: supplierId })
      const plotId = await createRecord(request, token, '/api/eudr/plots', {
        supplierEntityId: supplierId, name: `Popup ${randomUUID()}`, originCountry: 'CI',
        geometry: feature(HTML_NAME), areaHa: 1,
      })
      cleanup.push({ path: '/api/eudr/plots', id: plotId })
      const statementId = await createRecord(request, token, '/api/eudr/statements', {
        title: `Popup ${randomUUID()}`, commodity: 'coffee',
      })
      cleanup.push({ path: '/api/eudr/statements', id: statementId })
      const submissionId = await createRecord(request, token, '/api/eudr/evidence-submissions', {
        supplierEntityId: supplierId, statementId, commodity: 'coffee', plotIds: [plotId],
      })
      cleanup.push({ path: '/api/eudr/evidence-submissions', id: submissionId })
      await login(page, 'admin')
      await page.goto(`/backend/eudr/statements/${statementId}`)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Plot map', exact: true })).toBeVisible()
      await expectPopup(page, HTML_NAME)
      await page.screenshot({ path: testInfo.outputPath('statement-literal-popup.png') })

      for (const name of [ORDINARY_NAME, undefined, HTML_NAME]) {
        const update = await apiRequest(request, 'PUT', '/api/eudr/plots', {
          token, data: { id: plotId, geometry: feature(name) },
        })
        expect(update.status(), 'replace persisted geometry').toBe(200)
        await page.reload()
        await expectPopup(page, name)
      }
    } finally {
      await cleanupFixtures(request, token, cleanup)
    }
  })
})
