import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createFixedTemplateInput,
  createLinkFixture,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  readLink,
  readTemplate,
  updateLink,
  updateTemplate,
} from './helpers/fixtures'

test.describe('TC-CHKT-039: Draft template/pay-link gateway provider edit validation', () => {
  test('template: clearing the required gateway provider is rejected and preserves the previous value', async ({ request }) => {
    let token: string | null = null
    let templateId: string | null = null

    try {
      token = await getAuthToken(request)
      templateId = await createTemplateFixture(request, token, createFixedTemplateInput({ status: 'draft' }))

      const clearResponse = await updateTemplate(request, token, templateId, {
        name: 'Consulting Fee (no gateway)',
        pricingMode: 'fixed',
        fixedPriceAmount: 49.99,
        fixedPriceCurrencyCode: 'USD',
        status: 'draft',
        gatewayProviderKey: null,
      })
      expect(clearResponse.status()).toBe(400)
      const clearBody = await readJsonSafe<{ fieldErrors?: { gatewayProviderKey?: string }; error?: string }>(clearResponse)
      expect(clearBody?.fieldErrors?.gatewayProviderKey ?? clearBody?.error ?? '').toContain('checkout.validation.gatewayProviderKey.required')

      const cleared = await readTemplate(request, token, templateId)
      expect(cleared.gatewayProviderKey).toBe('mock')
      expect(cleared.name).not.toBe('Consulting Fee (no gateway)')

      const renameResponse = await updateTemplate(request, token, templateId, {
        name: 'Consulting Fee renamed',
      })
      expect(
        renameResponse.ok(),
        `Editing a field while retaining the existing gateway should succeed: ${renameResponse.status()} ${JSON.stringify(await readJsonSafe(renameResponse))}`,
      ).toBeTruthy()

      const renamed = await readTemplate(request, token, templateId)
      expect(renamed.gatewayProviderKey).toBe('mock')
      expect(renamed.name).toBe('Consulting Fee renamed')

      const blankResponse = await updateTemplate(request, token, templateId, {
        gatewayProviderKey: '   ',
      })
      expect(blankResponse.status()).toBe(400)
      const blankBody = await readJsonSafe<{ fieldErrors?: { gatewayProviderKey?: string }; error?: string }>(blankResponse)
      expect(blankBody?.fieldErrors?.gatewayProviderKey ?? blankBody?.error ?? '').toContain('checkout.validation.gatewayProviderKey.required')

      const blanked = await readTemplate(request, token, templateId)
      expect(blanked.gatewayProviderKey).toBe('mock')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })

  test('pay-link: clearing the gateway provider on a draft saves and round-trips as null', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'draft' }))
      linkId = link.id

      const clearResponse = await updateLink(request, token, link.id, {
        name: 'Pay link (no gateway)',
        pricingMode: 'fixed',
        fixedPriceAmount: 49.99,
        fixedPriceCurrencyCode: 'USD',
        status: 'draft',
        gatewayProviderKey: null,
      })
      expect(
        clearResponse.ok(),
        `Clearing the gateway on a draft pay-link should succeed: ${clearResponse.status()} ${JSON.stringify(await readJsonSafe(clearResponse))}`,
      ).toBeTruthy()

      const cleared = await readLink(request, token, link.id)
      expect(cleared.gatewayProviderKey ?? null).toBeNull()
      expect(cleared.name).toBe('Pay link (no gateway)')

      const renameResponse = await updateLink(request, token, link.id, {
        name: 'Pay link renamed',
        gatewayProviderKey: null,
      })
      expect(
        renameResponse.ok(),
        `Editing a field on a gateway-less draft pay-link should succeed: ${renameResponse.status()} ${JSON.stringify(await readJsonSafe(renameResponse))}`,
      ).toBeTruthy()

      const renamed = await readLink(request, token, link.id)
      expect(renamed.gatewayProviderKey ?? null).toBeNull()
      expect(renamed.name).toBe('Pay link renamed')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })

  test('pay-link: publishing still requires a gateway provider', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'draft' }))
      linkId = link.id

      const publishResponse = await updateLink(request, token, link.id, {
        status: 'active',
        gatewayProviderKey: null,
      })
      expect([400, 422]).toContain(publishResponse.status())
      const body = await readJsonSafe<{ error?: string; fieldErrors?: { gatewayProviderKey?: string } }>(publishResponse)
      const fieldError = typeof body?.fieldErrors?.gatewayProviderKey === 'string' ? body.fieldErrors.gatewayProviderKey : ''
      const errorMessage = typeof body?.error === 'string' ? body.error : ''
      expect(`${fieldError} ${errorMessage}`.toLowerCase()).toContain('gateway')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
