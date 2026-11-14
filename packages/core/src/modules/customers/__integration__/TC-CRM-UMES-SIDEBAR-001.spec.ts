import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { DEFAULT_CREDENTIALS, login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture, createPersonFixture, createDealFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createExternalIdsFixture } from './helpers/externalIdsFixture'

export const integrationMeta = { dependsOnModules: ['customers', 'integrations'] }

type ExternalIds = Record<string, { externalId: string; syncStatus: string }>
type Overview = Record<string, unknown> & { _integrations: ExternalIds }
type CustomerKind = 'person' | 'company' | 'deal'

async function readOverview(request: APIRequestContext, token: string, collection: string, id: string) {
  const response = await apiRequest(request, 'GET', `/api/customers/${collection}/${id}`, { token })
  expect(response.ok(), `Read ${collection} detail`).toBeTruthy()
  const body = await readJsonSafe<Overview>(response)
  expect(body).not.toBeNull()
  return body as Overview
}

function expectMapping(body: Overview, kind: CustomerKind, integrationId: string, externalId: string) {
  expect(body._integrations[integrationId]).toEqual({ externalId, syncStatus: 'synced' })
  expect((body[kind] as Record<string, unknown>)._integrations).toEqual(body._integrations)
}

async function expectSingleNativeForm(page: Page, hasZoneLayout: boolean) {
  if (hasZoneLayout) {
    await expect(page.locator('[data-zone-layout-mode][data-persistence-hydrated="true"]').first()).toBeVisible()
  }
  const expand = page.getByRole('button', { name: 'Expand form panel', exact: true })
  if (await expand.isVisible()) await expand.click()
  await expect(page.getByRole('main').locator('form')).toHaveCount(1)
}

for (const kind of ['person', 'company', 'deal'] as const) {
  test(`TC-CRM-UMES-SIDEBAR-001: ${kind} external IDs remain fresh and fit the responsive sidebar`, async ({ page, request }, testInfo) => {
    DEFAULT_CREDENTIALS.admin.password = process.env.TEST_ADMIN_PASSWORD ?? DEFAULT_CREDENTIALS.admin.password
    const token = await getAuthToken(request, 'admin', process.env.TEST_ADMIN_PASSWORD)
    const scope = getTokenScope(token)
    const collection = kind === 'person' ? 'people' : kind === 'company' ? 'companies' : 'deals'
    const name = `External IDs sidebar ${kind} ${Date.now()}`
    const integrationId = `sidebar-${kind}-${Date.now()}`
    const firstExternalId = `EXT-${kind}-first`
    let id: string | null = null
    let fixture: Awaited<ReturnType<typeof createExternalIdsFixture>> | null = null
    try {
      id = kind === 'person'
        ? await createPersonFixture(request, token, { firstName: 'Sidebar', lastName: kind, displayName: name })
        : kind === 'company'
          ? await createCompanyFixture(request, token, name)
          : await createDealFixture(request, token, { title: name })
      fixture = await createExternalIdsFixture({ ...scope, entityType: `customers.${kind}`, entityId: id, integrationId, externalId: firstExternalId })
      const cold = await readOverview(request, token, collection, id)
      expectMapping(cold, kind, integrationId, firstExternalId)
      expectMapping(await readOverview(request, token, collection, id), kind, integrationId, firstExternalId)
      const nativeVersion = (cold[kind] as Record<string, unknown>).updatedAt
      expect(typeof nativeVersion).toBe('string')
      await login(page, 'admin')
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(`/backend/customers/${kind === 'deal' ? 'deals' : `${collection}-v2`}/${id}`)
      const main = page.getByRole('main')
      const externalHeading = main.getByRole('heading', { name: 'External IDs', exact: true })
      const sidebar = main.getByRole('complementary', { includeHidden: true })
      await expect(externalHeading).toBeVisible()
      await expect(sidebar.getByText(firstExternalId, { exact: true })).toBeVisible()
      await expect(sidebar.getByText('synced', { exact: true })).toBeVisible()
      expect(await sidebar.evaluate(node => node.parentElement ? getComputedStyle(node.parentElement).flexDirection : null)).toBe('row')
      await expectSingleNativeForm(page, true)
      await page.screenshot({ path: testInfo.outputPath(`${kind}-desktop.png`), fullPage: true })
      const longExternalId = `EXT${kind.toUpperCase()}${'1234567890'.repeat(20)}`
      await fixture.update(longExternalId)
      const changed = await readOverview(request, token, collection, id)
      expectMapping(changed, kind, integrationId, longExternalId)
      expect((changed[kind] as Record<string, unknown>).updatedAt).toEqual(nativeVersion)
      expectMapping(await readOverview(request, token, collection, id), kind, integrationId, longExternalId)
      await page.setViewportSize({ width: 390, height: 844 })
      await page.reload()
      await expect(sidebar.getByText(longExternalId, { exact: true })).toBeVisible()
      const geometry = await sidebar.evaluate(node => {
        const box = node.getBoundingClientRect()
        const parent = node.parentElement
        const native = parent?.firstElementChild?.getBoundingClientRect()
        const externalId = node.querySelector('code')?.getBoundingClientRect()
        return { left: box.left, right: box.right, width: box.width, scrollWidth: node.scrollWidth, viewport: window.innerWidth, direction: parent ? getComputedStyle(parent).flexDirection : null, top: box.top, nativeBottom: native?.bottom, externalRight: externalId?.right }
      })
      expect(geometry.direction).toBe('column')
      expect(geometry.top).toBeGreaterThanOrEqual(geometry.nativeBottom ?? 0)
      expect(geometry.left).toBeGreaterThanOrEqual(0)
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport)
      expect(geometry.externalRight).toBeLessThanOrEqual(geometry.right)
      expect(geometry.scrollWidth).toBeLessThanOrEqual(Math.ceil(geometry.width))
      await expectSingleNativeForm(page, kind !== 'person')
      await page.screenshot({ path: testInfo.outputPath(`${kind}-narrow-long.png`), fullPage: true })
      await fixture.remove()
      const empty = await readOverview(request, token, collection, id)
      expect(empty._integrations).toEqual({})
      expect((empty[kind] as Record<string, unknown>)._integrations).toEqual({})
      await page.reload()
      await expect(main.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect(sidebar).toHaveCount(1)
      await expect(sidebar).toBeHidden()
      await expect(externalHeading).toHaveCount(0)
      await expectSingleNativeForm(page, kind !== 'person')
      await page.screenshot({ path: testInfo.outputPath(`${kind}-empty.png`), fullPage: true })
    } finally {
      try {
        await fixture?.close()
      } finally {
        try {
          if (id) {
            const deletion = await apiRequest(request, 'DELETE', `/api/customers/${collection}`, { token, data: { id } })
            expect(deletion.ok(), `Clean up owned ${kind}: ${deletion.status()}`).toBeTruthy()
          }
        } finally {
          await page.close()
        }
      }
    }
  })
}
