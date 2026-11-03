import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'
import {
  createLinkFixture,
  createPriceListTemplateInput,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  readLink,
  readTemplate,
} from './helpers/fixtures'

/**
 * TC-CHKT-PRECISION-002: saving only the title of a template or pay link keeps
 * every digit of its price-list amounts, in dot- and comma-decimal locales.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

const PRICE = '1.123456789012345678'

const LOCALES = [
  { locale: 'en', titlePlaceholder: 'Consulting session payment', amountLabel: 'Amount 1', displayedPrice: PRICE },
  { locale: 'pl', titlePlaceholder: 'Płatność za sesję konsultingową', amountLabel: 'Kwota 1', displayedPrice: PRICE.replace('.', ',') },
] as const

const EDITORS = [
  { kind: 'templates' as const, path: 'templates' },
  { kind: 'links' as const, path: 'pay-links' },
]

type PriceListItem = { id: string; amount: number; amountExact?: string | null }

async function useLocale(page: Page, locale: string) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([
    { name: 'locale', value: locale, url: baseUrl, sameSite: 'Lax' },
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
  ])
}

async function readPriceListItems(
  request: APIRequestContext,
  token: string,
  kind: 'templates' | 'links',
  id: string,
): Promise<PriceListItem[]> {
  const record = kind === 'templates' ? await readTemplate(request, token, id) : await readLink(request, token, id)
  return ((record as { priceListItems?: PriceListItem[] }).priceListItems ?? []) as PriceListItem[]
}

test.describe('TC-CHKT-PRECISION-002: exact price-list amounts survive an admin title edit', () => {
  for (const { locale, titlePlaceholder, amountLabel, displayedPrice } of LOCALES) {
    for (const { kind, path } of EDITORS) {
      test(`${kind} editor in ${locale} keeps ${PRICE} after a title-only save`, async ({ page, request }) => {
        test.setTimeout(150_000)
        const token = await getAuthToken(request, 'admin')
        let currencyId: string | null = null
        let entityId: string | null = null

        try {
          const currency = await createRandomCurrencyFixture(request, token, {
            name: `QA TC-CHKT-PRECISION-002 ${kind} ${locale}`,
            decimalPlaces: 18,
          })
          currencyId = currency.id
          const input = createPriceListTemplateInput({
            priceListItems: [{ id: 'precise', description: 'Precise', amount: PRICE as unknown as number, currencyCode: currency.code }],
            status: 'draft',
          })
          entityId = kind === 'templates'
            ? await createTemplateFixture(request, token, input)
            : (await createLinkFixture(request, token, input)).id
          const [created] = await readPriceListItems(request, token, kind, entityId)
          expect(created?.amountExact).toBe(PRICE)

          await login(page, 'admin')
          await useLocale(page, locale)
          await page.goto(`/backend/checkout/${path}/${encodeURIComponent(entityId)}`, { waitUntil: 'domcontentloaded' })
          const amountInput = page.getByRole('textbox', { name: amountLabel, exact: true })
          await expect(amountInput).toHaveValue(displayedPrice, { timeout: 30_000 })

          await page.getByPlaceholder(titlePlaceholder).fill(`QA title only ${Date.now()}`)
          const saved = page.waitForResponse((response) =>
            response.request().method() === 'PUT'
              && new URL(response.url()).pathname === `/api/checkout/${kind}/${entityId}`,
          )
          await page.locator('form button[type="submit"]').first().click()
          expect((await saved).status()).toBe(200)

          const [afterSave] = await readPriceListItems(request, token, kind, entityId)
          expect(afterSave?.amountExact).toBe(PRICE)

          await page.goto(`/backend/checkout/${path}/${encodeURIComponent(entityId)}`, { waitUntil: 'domcontentloaded' })
          await expect(amountInput).toHaveValue(displayedPrice, { timeout: 30_000 })

          await page.setViewportSize({ width: 390, height: 844 })
          await expect(amountInput).toBeVisible()
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
          expect(overflow).toBeLessThanOrEqual(0)
        } finally {
          await deleteCheckoutEntityIfExists(request, token, kind, entityId)
          await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId)
        }
      })
    }
  }
})
