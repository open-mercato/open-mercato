import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { createRandomCurrencyFixture, deleteCurrenciesEntityIfExists } from '@open-mercato/core/helpers/integration/currenciesFixtures'

const PRICES = '/api/catalog/prices'
const field = (page: Page, id: string) => page.locator(`[data-crud-field-id="${id}"] input`)
const save = (page: Page) => page.locator('button[type="submit"]').last().click()

async function pick(page: Page, id: string, query: string, label: RegExp) {
  const input = page.locator(`[data-crud-field-id="${id}"]`).getByRole('combobox')
  await input.fill(query)
  await page.getByRole('option', { name: label }).first().click()
}

for (const locale of ['pl', 'en']) {
  test(`flat price rules preserve locale decimals, rejected edits and concurrent changes (${locale})`, async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = randomUUID().replace(/-/g, '')
    const title = `Decimal${stamp}`
    let productId: string | null = null
    let kindId: string | null = null
    let currencyId: string | null = null
    let priceId: string | null = null
    try {
      productId = await createProductFixture(request, token, { title, sku: title })
      const kind = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
        token, data: { code: title.toLowerCase(), title, displayMode: 'excluding-tax' },
      })
      expect(kind.status()).toBe(201)
      kindId = expectId((await readJsonSafe<{ id?: string }>(kind))?.id, 'price-kind fixture id')
      const currency = await createRandomCurrencyFixture(request, token, { name: title })
      currencyId = currency.id
      await login(page, 'admin')
      await page.context().addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
      await page.goto('/backend/catalog/prices/create')
      await pick(page, 'productId', title, new RegExp(title))
      await pick(page, 'priceKindId', title, new RegExp(title))
      await pick(page, 'currencyCode', currency.code, new RegExp(`^${currency.code}`))
      await field(page, 'unitPriceNet').fill(locale === 'pl' ? '12,50' : '12.50')
      await field(page, 'unitPriceGross').fill(locale === 'pl' ? '15,38' : '15.38')
      const createdPromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === PRICES)
      await save(page)
      const created = await createdPromise
      priceId = expectId((JSON.parse(await created.text()) as { id?: string }).id, 'created price id')
      expect(created.status()).toBe(201)
      await expect(page).toHaveURL(/\/backend\/catalog\/prices(\?.*)?$/)

      const readPrice = async () => {
        const response = await apiRequest(request, 'GET', `${PRICES}?ids=${priceId}&pageSize=1`, { token })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ items: Record<string, unknown>[] }>(response)
        expect(body?.items).toHaveLength(1)
        return body!.items[0]
      }
      const amount = (row: Record<string, unknown>, suffix: 'net' | 'gross') => Number(row[`unit_price_${suffix}`] ?? row[suffix === 'net' ? 'unitPriceNet' : 'unitPriceGross'])
      expect(amount(await readPrice(), 'net')).toBe(12.5)
      expect(amount(await readPrice(), 'gross')).toBe(15.38)
      const editUrl = `/backend/catalog/prices/${priceId}/edit`
      await page.goto(editUrl)
      await expect(field(page, 'unitPriceNet')).toHaveValue(/^12\.50?$/)

      for (const invalid of ['12,3,4', '-1', '1 2']) {
        const before = await readPrice()
        await field(page, 'unitPriceNet').fill(invalid)
        await field(page, 'unitPriceGross').fill('999')
        await save(page)
        await expect(page.getByText(locale === 'pl' ? 'Podaj poprawną, nieujemną cenę.' : 'Provide a valid non-negative price.').first()).toBeVisible()
        expect(await readPrice()).toEqual(before)
      }

      for (const [net, gross] of [['21,25', '26,14'], ['1.500', '1.845'], ['0', '0']]) {
        await field(page, 'unitPriceNet').fill(net)
        await field(page, 'unitPriceGross').fill(gross)
        const updatedPromise = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === PRICES)
        await save(page)
        expect((await updatedPromise).status()).toBe(200)
        await expect(page).toHaveURL(/\/backend\/catalog\/prices(\?.*)?$/)
        const row = await readPrice()
        expect(amount(row, 'net')).toBe(Number(net.replace(',', '.')))
        expect(amount(row, 'gross')).toBe(Number(gross.replace(',', '.')))
        await page.goto(editUrl)
        await expect(field(page, 'unitPriceNet')).toHaveValue(String(row.unit_price_net ?? row.unitPriceNet))
      }

      const bumped = await apiRequest(request, 'PUT', PRICES, { token, data: { id: priceId, unitPriceNet: '7.5', unitPriceGross: '9.23' } })
      expect(bumped.status()).toBe(200)
      const beforeStale = await readPrice()
      await field(page, 'unitPriceNet').fill('88,50')
      const stalePromise = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === PRICES)
      await save(page)
      expect((await stalePromise).status()).toBe(409)
      await expect(page.getByTestId('record-conflict-banner')).toBeVisible()
      expect(await readPrice()).toEqual(beforeStale)
    } finally {
      if (!priceId && productId) {
        const response = await apiRequest(request, 'GET', `${PRICES}?productId=${productId}&pageSize=100`, { token })
        const body = await readJsonSafe<{ items?: { id: string }[] }>(response)
        for (const row of body?.items ?? []) await deleteGeneralEntityIfExists(request, token, PRICES, row.id)
      }
      await deleteGeneralEntityIfExists(request, token, PRICES, priceId)
      await deleteGeneralEntityIfExists(request, token, '/api/catalog/price-kinds', kindId)
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
}
