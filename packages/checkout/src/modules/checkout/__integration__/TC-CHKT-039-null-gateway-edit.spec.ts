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

test.describe('TC-CHKT-039: Draft template/pay-link edits tolerate a null gateway provider (issue #2505)', () => {
  test('template: clearing the gateway provider on a draft saves and round-trips as null', async ({ request }) => {
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
      expect(
        clearResponse.ok(),
        `Clearing the gateway on a draft template should succeed: ${clearResponse.status()} ${JSON.stringify(await readJsonSafe(clearResponse))}`,
      ).toBeTruthy()

      const cleared = await readTemplate(request, token, templateId)
      expect(cleared.gatewayProviderKey ?? null).toBeNull()
      expect(cleared.name).toBe('Consulting Fee (no gateway)')

      const renameResponse = await updateTemplate(request, token, templateId, {
        name: 'Consulting Fee renamed',
        gatewayProviderKey: null,
      })
      expect(
        renameResponse.ok(),
        `Editing a field on a gateway-less draft template should succeed: ${renameResponse.status()} ${JSON.stringify(await readJsonSafe(renameResponse))}`,
      ).toBeTruthy()

      const renamed = await readTemplate(request, token, templateId)
      expect(renamed.gatewayProviderKey ?? null).toBeNull()
      expect(renamed.name).toBe('Consulting Fee renamed')

      const blankResponse = await updateTemplate(request, token, templateId, {
        gatewayProviderKey: '   ',
      })
      expect(
        blankResponse.ok(),
        `A blank gateway should normalize to null on a draft template: ${blankResponse.status()} ${JSON.stringify(await readJsonSafe(blankResponse))}`,
      ).toBeTruthy()

      const blanked = await readTemplate(request, token, templateId)
      expect(blanked.gatewayProviderKey ?? null).toBeNull()
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
