import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  OMNIBUS_ACTOR_PASSWORD, PRODUCTS_PATH, PRICES_PATH, cleanupOmnibusTenantActor,
  cleanupRestrictedUser, createOmnibusProductFixture, createOmnibusTenantActor,
  createRestrictedUser, deleteEntityIfExists, uniqueStamp, type OmnibusTenantActor,
} from './omnibusHelpers'

const VARIANTS_PATH = '/api/catalog/variants'

async function readVariant(request: APIRequestContext, token: string, id: string) {
  const response = await apiRequest(request, 'GET', `${VARIANTS_PATH}?id=${id}&pageSize=1`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const row = body?.items?.find((item) => item.id === id)
  expect(row).toBeTruthy()
  return row!
}

function comparable(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !['updated_at', 'updatedAt'].includes(key)))
}

async function save(page: Page, locale: 'en' | 'pl', expectedStatus = 200) {
  const response = page.waitForResponse((result) => result.url().includes(VARIANTS_PATH) && result.request().method() === 'PUT')
  await page.getByRole('button', { name: locale === 'pl' ? 'Zapisz zmiany' : 'Save changes', exact: true }).last().click()
  expect((await response).status()).toBe(expectedStatus)
  if (expectedStatus === 200) await expect(page).toHaveURL(/\/backend\/catalog\/products\/[^/]+(?:[?#].*)?$/)
}

for (const locale of ['en', 'pl'] as const) {
  test.describe(`TC-CAT-OMNI-007: variant persistence (${locale})`, () => {
    let actor: OmnibusTenantActor | null = null
    let second: Awaited<ReturnType<typeof createRestrictedUser>> | null = null
    let adminToken: string
    let productId: string | null = null
    let priceKindId: string | null = null
    let priceKindTitle: string
    const variants: string[] = []
    const prices: string[] = []

    test.beforeAll(async ({ request }) => {
      adminToken = await getAuthToken(request, 'superadmin')
      const stamp = uniqueStamp()
      actor = await createOmnibusTenantActor(request, adminToken, stamp, ['catalog.*', 'sales.*'])
      second = await createRestrictedUser(request, adminToken, actor, `${stamp}-second`, ['catalog.*'])
      productId = await createOmnibusProductFixture(request, actor.token, stamp)
      const updated = await apiRequest(request, 'PUT', PRODUCTS_PATH, { token: actor.token, data: { id: productId, omnibusExempt: true } })
      expect(updated.status()).toBe(200)
      priceKindTitle = `Omnibus persistence ${stamp}`
      const kind = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
        token: actor.token, data: { code: `omni_ui_${stamp.replace(/-/g, '_')}`, title: priceKindTitle, currencyCode: 'EUR', displayMode: 'including-tax' },
      })
      expect(kind.status()).toBe(201)
      priceKindId = expectId((await readJsonSafe<{ id?: string }>(kind))?.id, 'price kind')
    })

    test.afterAll(async ({ request }) => {
      if (actor) {
        for (const id of prices) await deleteEntityIfExists(request, actor.token, PRICES_PATH, id)
        for (const id of variants) {
          const response = await apiRequest(request, 'GET', `${PRICES_PATH}?variantId=${id}&pageSize=100`, { token: actor.token })
          const remaining = await readJsonSafe<{ items?: Array<{ id: string }> }>(response)
          for (const price of remaining?.items ?? []) await deleteEntityIfExists(request, actor.token, PRICES_PATH, price.id)
          await deleteEntityIfExists(request, actor.token, VARIANTS_PATH, id)
        }
        await deleteEntityIfExists(request, actor.token, PRODUCTS_PATH, productId)
        await deleteEntityIfExists(request, actor.token, '/api/catalog/price-kinds', priceKindId)
      }
      await cleanupRestrictedUser(request, adminToken, second)
      await cleanupOmnibusTenantActor(request, adminToken, actor)
    })

    test.beforeEach(async ({ page, baseURL }) => {
      const response = await page.request.post('/api/auth/login', {
        form: { email: actor!.email, password: OMNIBUS_ACTOR_PASSWORD },
      })
      expect(response.ok()).toBe(true)
      await page.context().addCookies([
        { name: 'om_selected_tenant', value: actor!.tenantId, url: baseURL! },
        { name: 'om_selected_org', value: actor!.organizationId, url: baseURL! },
        { name: 'locale', value: locale, url: baseURL! },
        { name: 'om_demo_notice_ack', value: 'ack', url: baseURL! },
        { name: 'om_cookie_notice_ack', value: 'ack', url: baseURL! },
        { name: 'om_feedback_suppress', value: '1', url: baseURL! },
      ])
    })

    async function createVariant(request: APIRequestContext, value: boolean | null) {
      const stamp = uniqueStamp()
      const response = await apiRequest(request, 'POST', VARIANTS_PATH, {
        token: actor!.token, data: { productId, name: `Persistence ${stamp}`, sku: `OMNI-${stamp}`, omnibusExempt: value },
      })
      expect(response.status()).toBe(201)
      const id = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'variant')
      variants.push(id)
      return id
    }

    const cases = [
      { value: true, option: { en: 'Exempt (perishable)', pl: 'Zwolniony (nietrwały)' } },
      { value: null, option: { en: 'Inherit from product', pl: 'Dziedzicz z produktu' } },
      { value: false, option: { en: 'Not exempt', pl: 'Niezwolniony' } },
    ] as const

    for (const entry of cases) {
      test(`saves ${entry.value}, reopens ten times and preserves it on an HS-only save`, async ({ page, request }) => {
        const id = await createVariant(request, entry.value === true ? false : true)
        const url = `/backend/catalog/products/${productId}/variants/${id}`
        await page.goto(url)
        const select = page.locator('#catalog-variant-omnibus-exempt')
        await select.click()
        await page.getByRole('option', { name: entry.option[locale], exact: true }).click()
        await save(page, locale)
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await page.goto(url)
          await expect(select).toHaveText(entry.option[locale])
          expect((await readVariant(request, actor!.token, id)).omnibus_exempt).toBe(entry.value)
        }
        const before = comparable(await readVariant(request, actor!.token, id))
        await page.locator('#catalog-variant-hs-code').fill('123456')
        await save(page, locale)
        const after = comparable(await readVariant(request, actor!.token, id))
        expect(after).toEqual({ ...before, hs_code: '123456' })
        await page.goto(url)
        await expect(select).toHaveText(entry.option[locale])
        const parent = await apiRequest(request, 'GET', `${PRODUCTS_PATH}?id=${productId}&pageSize=1`, { token: actor!.token })
        expect((await readJsonSafe<{ items: Array<{ omnibus_exempt: boolean }> }>(parent))?.items[0].omnibus_exempt).toBe(true)
      })
    }

    test('refuses two stale saves and retains the distinct second user edit', async ({ page, request }) => {
      const id = await createVariant(request, true)
      await page.goto(`/backend/catalog/products/${productId}/variants/${id}`)
      await expect(page.locator('#catalog-variant-omnibus-exempt')).toContainText(cases[0].option[locale])
      const changedName = `Second user ${uniqueStamp()}`
      const changed = await apiRequest(request, 'PUT', VARIANTS_PATH, { token: second!.token, data: { id, productId, name: changedName } })
      expect(changed.status()).toBe(200)
      await page.locator('#catalog-variant-hs-code').fill('654321')
      await save(page, locale, 409)
      await save(page, locale, 409)
      expect(await readVariant(request, actor!.token, id)).toMatchObject({ name: changedName, omnibus_exempt: true, hs_code: null })
    })

    test('round-trips a comma price through the browser and a fresh API read', async ({ page, request }) => {
      const id = await createVariant(request, null)
      const url = `/backend/catalog/products/${productId}/variants/${id}`
      await page.goto(url)
      const amount = page.getByLabel(priceKindTitle, { exact: true })
      await amount.fill('19,99')
      const priceSaved = page.waitForResponse((response) => response.url().includes(PRICES_PATH) && response.request().method() === 'POST')
      await save(page, locale)
      expect((await priceSaved).status()).toBe(201)
      const response = await apiRequest(request, 'GET', `${PRICES_PATH}?variantId=${id}&priceKindId=${priceKindId}&pageSize=1`, { token: actor!.token })
      expect(response.status()).toBe(200)
      const rows = await readJsonSafe<{ items?: Array<{ id: string; unit_price_gross: string }> }>(response)
      for (const row of rows?.items ?? []) prices.push(row.id)
      expect(rows?.items).toHaveLength(1)
      expect(rows?.items?.[0].unit_price_gross).toBe('19.99')
      await page.goto(url)
      await expect(amount).toHaveAttribute('type', 'text')
      await expect(amount).toHaveAttribute('inputmode', 'decimal')
      await expect(amount).toHaveValue('19.99')
      expect((await readVariant(request, actor!.token, id)).omnibus_exempt).toBeNull()
    })
  })
}
