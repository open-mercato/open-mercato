import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createFixedTemplateInput,
  deleteCheckoutEntityIfExists,
  updateLink,
  updateTemplate,
} from './helpers/fixtures'

const PAYER_REQUIRED_PROVIDER = 'mock_payer_required'
const PAYER_FIELDS_ERROR_KEY = 'checkout.validation.gatewayProviderKey.payerFieldsNotCollected'

const DEFAULT_CUSTOMER_FIELDS = [
  { key: 'firstName', label: 'First name', kind: 'text', required: true, fixed: false, sortOrder: 0 },
  { key: 'lastName', label: 'Last name', kind: 'text', required: true, fixed: false, sortOrder: 1 },
  { key: 'email', label: 'Email', kind: 'text', required: true, fixed: false, sortOrder: 2 },
]

const OPTIONAL_EMAIL_CUSTOMER_FIELDS = DEFAULT_CUSTOMER_FIELDS.map((field) => (
  field.key === 'email' ? { ...field, required: false } : field
))

async function postCheckout(
  request: APIRequestContext,
  token: string,
  kind: 'templates' | 'links',
  data: Record<string, unknown>,
) {
  const response = await apiRequest(request, 'POST', `/api/checkout/${kind}`, { token, data })
  const body = await readJsonSafe<{ id?: string; fieldErrors?: Record<string, string> }>(response)
  return { status: response.status(), body }
}

async function expectPayerFieldsRejected(response: { status(): number; json(): Promise<unknown> }) {
  expect(response.status()).toBe(422)
  expect(await response.json()).toMatchObject({
    fieldErrors: { gatewayProviderKey: PAYER_FIELDS_ERROR_KEY },
  })
}

test.describe('TC-CHKT-044: Link/template save rejects providers whose required payer fields are not collected', () => {
  test('template create/update enforces the payer fields declared by the provider descriptor', async ({ request }) => {
    let token: string | null = null
    let templateId: string | null = null
    let unaffectedTemplateId: string | null = null

    try {
      token = await getAuthToken(request)

      const rejected = await postCheckout(request, token, 'templates', {
        ...createFixedTemplateInput({ gatewayProviderKey: PAYER_REQUIRED_PROVIDER, collectCustomerDetails: false }),
      })
      expect(rejected.status).toBe(422)
      expect(rejected.body?.fieldErrors?.gatewayProviderKey).toBe(PAYER_FIELDS_ERROR_KEY)

      const rejectedOptionalEmail = await postCheckout(request, token, 'templates', {
        ...createFixedTemplateInput({ gatewayProviderKey: PAYER_REQUIRED_PROVIDER }),
        customerFieldsSchema: OPTIONAL_EMAIL_CUSTOMER_FIELDS,
      })
      expect(rejectedOptionalEmail.status).toBe(422)
      expect(rejectedOptionalEmail.body?.fieldErrors?.gatewayProviderKey).toBe(PAYER_FIELDS_ERROR_KEY)

      const created = await postCheckout(request, token, 'templates', {
        ...createFixedTemplateInput({ gatewayProviderKey: PAYER_REQUIRED_PROVIDER }),
        customerFieldsSchema: DEFAULT_CUSTOMER_FIELDS,
      })
      expect(created.status).toBe(201)
      templateId = created.body?.id ?? null
      expect(templateId).toBeTruthy()

      await expectPayerFieldsRejected(await updateTemplate(request, token, templateId!, {
        customerFieldsSchema: OPTIONAL_EMAIL_CUSTOMER_FIELDS,
      }))

      const unaffected = await postCheckout(request, token, 'templates', {
        ...createFixedTemplateInput({ gatewayProviderKey: 'mock', collectCustomerDetails: false }),
      })
      expect(unaffected.status).toBe(201)
      unaffectedTemplateId = unaffected.body?.id ?? null
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
      await deleteCheckoutEntityIfExists(request, token, 'templates', unaffectedTemplateId)
    }
  })

  test('link create/update enforces the payer fields declared by the provider descriptor', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null
    let unaffectedLinkId: string | null = null

    try {
      token = await getAuthToken(request)

      const rejected = await postCheckout(request, token, 'links', {
        ...createFixedTemplateInput({ gatewayProviderKey: PAYER_REQUIRED_PROVIDER, collectCustomerDetails: false }),
      })
      expect(rejected.status).toBe(422)
      expect(rejected.body?.fieldErrors?.gatewayProviderKey).toBe(PAYER_FIELDS_ERROR_KEY)

      const created = await postCheckout(request, token, 'links', {
        ...createFixedTemplateInput({ gatewayProviderKey: PAYER_REQUIRED_PROVIDER }),
        customerFieldsSchema: DEFAULT_CUSTOMER_FIELDS,
      })
      expect(created.status).toBe(201)
      linkId = created.body?.id ?? null
      expect(linkId).toBeTruthy()

      await expectPayerFieldsRejected(await updateLink(request, token, linkId!, {
        collectCustomerDetails: false,
      }))

      const accepted = await updateLink(request, token, linkId!, {
        gatewayProviderKey: 'mock',
        collectCustomerDetails: false,
      })
      expect(accepted.status()).toBe(200)

      const unaffected = await postCheckout(request, token, 'links', {
        ...createFixedTemplateInput({ gatewayProviderKey: 'mock', collectCustomerDetails: false }),
      })
      expect(unaffected.status).toBe(201)
      unaffectedLinkId = unaffected.body?.id ?? null
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
      await deleteCheckoutEntityIfExists(request, token, 'links', unaffectedLinkId)
    }
  })
})
