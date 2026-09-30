import { expect, test } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
} from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

/**
 * TC-CAT-036: catalog product edit — section policy preservation invariant.
 * Source: `.ai/specs/2026-09-30-catalog-product-form-section-policy.md`
 *
 * The whole section-policy feature rests on one server-side property: for
 * `catalog/products`, **omitting a key from the update payload preserves the
 * stored value, and only an explicit `null` clears it**. That is what lets a
 * hidden section simply stop contributing its slice instead of sending
 * defaults — and it is exactly the property that makes the alternative
 * (hiding the card only) unsafe, because `buildComplianceProductPayload`
 * always emits all 23 compliance/SEO keys, nulling the blanks.
 *
 * This spec pins that invariant against the real API, and pins that the
 * unmodified edit page still round-trips a save. The policy-ACTIVE rendering
 * and submit paths are covered by the component tests in
 * `backend/catalog/products/[id]/__tests__/page.sectionPolicy.test.tsx`, which
 * drive the real page component with a real policy applied — a browser-driven
 * test cannot reach the app's module registry to install one, because a
 * section policy is a build-time `modules.ts` decision rather than per-request
 * state.
 *
 * Self-contained: creates its own product, writes its own compliance and UoM
 * data, and deletes the product in teardown. Relies on no seeded record.
 */
test.describe('TC-CAT-036: product section policy preservation invariant', () => {
  test('omitting a section’s keys preserves its stored values; an explicit null clears them', async ({
    request,
  }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-036 ${stamp}`,
        sku: `QA-TC-CAT-036-${stamp}`,
      })

      // Give the compliance and UoM sections real stored data to protect.
      const seedResponse = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: {
          id: productId,
          countryOfOriginCode: 'PL',
          pkwiuCode: '10.71.11',
          cnCode: '1905 90',
          hsCode: '190590',
          taxClassificationCode: 'VAT-5',
          gtuCodes: ['GTU_01'],
          seoTitle: `QA SEO ${stamp}`,
          defaultUnit: 'kg',
          uomRoundingScale: 3,
        },
      })
      expect(seedResponse.ok(), `Seeding compliance data failed: ${seedResponse.status()}`).toBeTruthy()

      const readProduct = async () => {
        const response = await apiRequest(
          request,
          'GET',
          `/api/catalog/products?id=${encodeURIComponent(productId as string)}&page=1&pageSize=1`,
          { token: token as string },
        )
        expect(response.ok()).toBeTruthy()
        const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
        const item = body.items?.[0]
        expect(item, 'Product fixture should be readable').toBeTruthy()
        return item as Record<string, unknown>
      }

      const seeded = await readProduct()
      expect(seeded.pkwiuCode ?? seeded.pkwiu_code).toBe('10.71.11')
      expect(seeded.defaultUnit ?? seeded.default_unit).toBe('kg')

      // The hidden-section shape: a title-only update, with every compliance and
      // UoM key ABSENT — exactly what the page sends when those sections are
      // hidden by an `overrides.forms.sections` policy.
      const partialUpdate = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productId, title: `QA TC-CAT-036 renamed ${stamp}` },
      })
      expect(partialUpdate.ok(), `Partial update failed: ${partialUpdate.status()}`).toBeTruthy()

      const afterPartial = await readProduct()
      expect(afterPartial.title).toBe(`QA TC-CAT-036 renamed ${stamp}`)
      // Every hidden-section value survives untouched. If this ever regresses,
      // hiding a section silently destroys tenant data.
      expect(afterPartial.pkwiuCode ?? afterPartial.pkwiu_code).toBe('10.71.11')
      expect(afterPartial.cnCode ?? afterPartial.cn_code).toBe('1905 90')
      expect(afterPartial.hsCode ?? afterPartial.hs_code).toBe('190590')
      expect(afterPartial.countryOfOriginCode ?? afterPartial.country_of_origin_code).toBe('PL')
      expect(
        afterPartial.taxClassificationCode ?? afterPartial.tax_classification_code,
      ).toBe('VAT-5')
      expect(afterPartial.gtuCodes ?? afterPartial.gtu_codes).toEqual(['GTU_01'])
      expect(afterPartial.seoTitle ?? afterPartial.seo_title).toBe(`QA SEO ${stamp}`)
      expect(afterPartial.defaultUnit ?? afterPartial.default_unit).toBe('kg')

      // The other half of the contract, and the reason omission (not `null`) is
      // the rule: an explicit null DOES clear. A visual-only hide would send
      // these nulls on every save.
      const nullingUpdate = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productId, pkwiuCode: null, cnCode: null },
      })
      expect(nullingUpdate.ok(), `Nulling update failed: ${nullingUpdate.status()}`).toBeTruthy()

      const afterNulling = await readProduct()
      expect(afterNulling.pkwiuCode ?? afterNulling.pkwiu_code ?? null).toBeNull()
      expect(afterNulling.cnCode ?? afterNulling.cn_code ?? null).toBeNull()
      // Untouched keys still survive, so this really is per-key and not a wipe.
      expect(afterNulling.hsCode ?? afterNulling.hs_code).toBe('190590')
    } finally {
      if (token && productId) {
        await deleteCatalogProductIfExists(request, token, productId)
      }
    }
  })

  test('the unmodified edit page still loads and saves with no policy configured', async ({
    page,
    request,
  }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-036 UI ${stamp}`,
        sku: `QA-TC-CAT-036-UI-${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${productId}`, { waitUntil: 'domcontentloaded' })

      const titleField = page.getByRole('textbox', { name: /title/i }).first()
      await expect(titleField).toBeVisible({ timeout: 15_000 })
      await titleField.clear()
      await titleField.fill(`QA TC-CAT-036 UI renamed ${stamp}`)

      const savePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          /\/api\/catalog\/products(?:\?|$)/.test(response.url()),
        { timeout: 15_000 },
      )
      await page.getByRole('button', { name: /Save/i }).first().click()
      const saveResponse = await savePromise
      expect(saveResponse.ok(), `Save failed: ${saveResponse.status()}`).toBeTruthy()

      const verify = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?id=${encodeURIComponent(productId)}&page=1&pageSize=1`,
        { token },
      )
      expect(verify.ok()).toBeTruthy()
      const body = (await verify.json()) as { items?: Array<{ title?: string }> }
      expect(body.items?.[0]?.title).toBe(`QA TC-CAT-036 UI renamed ${stamp}`)
    } finally {
      if (token && productId) {
        await deleteCatalogProductIfExists(request, token, productId)
      }
    }
  })
})
