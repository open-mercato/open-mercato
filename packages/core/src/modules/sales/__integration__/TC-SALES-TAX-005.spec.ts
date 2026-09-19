import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  getTaxProviderSelection,
  putTaxProviderRaw,
  readJson,
  restoreDefaultTaxProvider,
} from './helpers/taxProvider'

const SECRET_SHAPED = 'lk_this_should_never_be_stored'

/**
 * TC-SALES-TAX-005 — Acceptance 5 of .ai/specs/2026-09-19-pluggable-tax-providers.md.
 *
 * Secrets belong to the integrations module, which encrypts them at rest and
 * masks them in the admin UI. The settings surface must therefore never carry
 * one in either direction: it must not return a credential, and it must refuse
 * to store a value under a key a provider declared as a secret.
 */
test.describe('TC-SALES-TAX-005: the settings surface never carries a secret', () => {
  test('neither route returns a credential and neither accepts a secret field', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request, 'admin')

    try {
      // 1. The provider catalog exposes field definitions only.
      const catalog = await readJson(request, token, '/api/sales/tax-providers')
      const items = Array.isArray(catalog.items) ? (catalog.items as Array<Record<string, unknown>>) : []
      // The default provider is the only one the product registers; the
      // integration runner adds the test provider these specs select.
      expect(items.length, 'the default and the integration test provider must be registered').toBeGreaterThanOrEqual(2)
      expect(items.map((item) => item.key)).toEqual(
        expect.arrayContaining(['table-rates', 'integration-test-rate'])
      )

      for (const item of items) {
        const fields = Array.isArray(item.fields) ? (item.fields as Array<Record<string, unknown>>) : []
        for (const field of fields) {
          expect(field.type, `provider ${String(item.key)} must not expose a secret field`).not.toBe('secret')
        }
      }
      const catalogText = JSON.stringify(catalog)
      expect(catalogText).not.toContain('credential')
      expect(catalogText).not.toContain('licenseKey')

      // 2. The selection route returns the same catalog plus the configured
      //    non secret options, and no credential.
      const selection = await getTaxProviderSelection(request, token)
      const selectionText = JSON.stringify(selection)
      expect(selectionText).not.toContain('credential')
      expect(selectionText).not.toContain('licenseKey')
      expect(selection.timeoutMs).toBeGreaterThanOrEqual(1000)
      expect(selection.timeoutMs).toBeLessThanOrEqual(30000)

      // 3. An unregistered provider is refused rather than silently stored,
      //    which would degrade every later calculation to a fallback.
      const unknown = await putTaxProviderRaw(request, token, {
        providerKey: 'definitely-not-registered',
      })
      expect(unknown.status).toBe(400)

      // 4. A timeout outside the documented bounds is refused, so a provider
      //    cannot be configured to hold a write open indefinitely.
      const badTimeout = await putTaxProviderRaw(request, token, {
        providerKey: 'integration-test-rate',
        timeoutMs: 999_999,
      })
      expect(badTimeout.status).toBe(400)

      // 5. Whatever a caller sends, nothing secret-shaped ends up readable.
      await putTaxProviderRaw(request, token, {
        providerKey: 'integration-test-rate',
        providerSettings: { rate: 5, licenseKey: SECRET_SHAPED },
      })
      const afterAttempt = await getTaxProviderSelection(request, token)
      expect(JSON.stringify(afterAttempt)).not.toContain(SECRET_SHAPED)
    } finally {
      await restoreDefaultTaxProvider(request, token)
    }
  })
})
