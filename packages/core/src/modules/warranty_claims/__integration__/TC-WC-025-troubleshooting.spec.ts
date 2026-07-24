import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { uniqueLabel } from './helpers'

type TroubleshootingOption = {
  label: string
  next?: TroubleshootingNode
  resolution?: string
  reasonCode?: string
}

type TroubleshootingNode = {
  prompt: string
  options: TroubleshootingOption[]
}

type TroubleshootingGuideItem = {
  id: string | null
  title: string | null
  claimType: string | null
  reasonCode: string | null
  steps?: TroubleshootingNode | null
  isActive: boolean
  updatedAt: string | null
}

type GuideListResponse = {
  items?: TroubleshootingGuideItem[]
}

type GuideCreateResponse = {
  id?: string | null
  error?: string
}

type OkResponse = {
  ok?: boolean
  error?: string
}

type PortalTroubleshootingResponse = {
  guide: {
    id: string
    title: string
    steps: TroubleshootingNode
  } | null
  error?: string
}

async function createGuide(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/warranty_claims/troubleshooting-guides', {
    token,
    data,
  })
  const body = await readJsonSafe<GuideCreateResponse>(response)
  expect(response.status(), `POST troubleshooting guide should return 201: ${JSON.stringify(body)}`).toBe(201)
  expect(body?.id, 'guide create response should include id').toBeTruthy()
  return body!.id as string
}

async function readGuide(
  request: APIRequestContext,
  token: string,
  guideId: string,
): Promise<TroubleshootingGuideItem> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/warranty_claims/troubleshooting-guides?ids=${encodeURIComponent(guideId)}&pageSize=10`,
    { token },
  )
  const body = await readJsonSafe<GuideListResponse>(response)
  expect(response.status(), `GET troubleshooting guide should return 200: ${JSON.stringify(body)}`).toBe(200)
  const guide = body?.items?.find((item) => item.id === guideId)
  expect(guide, `guide ${guideId} should be readable`).toBeTruthy()
  return guide as TroubleshootingGuideItem
}

async function deleteGuideIfExists(
  request: APIRequestContext,
  token: string | null,
  guideId: string | null,
): Promise<void> {
  if (!token || !guideId) return
  await apiRequest(
    request,
    'DELETE',
    `/api/warranty_claims/troubleshooting-guides?id=${encodeURIComponent(guideId)}`,
    { token },
  ).catch(() => undefined)
}

test.describe('TC-WC-025: warranty claim troubleshooting guides', () => {
  test('supports admin CRUD and returns active matching guides to the portal walker', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-025')
    const reasonCode = `reason-${stamp}`
    const missingReasonCode = `missing-${stamp}`

    let guideId: string | null = null
    let customerRoleId: string | null = null
    let customerId: string | null = null
    let customerUserId: string | null = null

    const steps: TroubleshootingNode = {
      prompt: `Does the product power on ${stamp}?`,
      options: [
        { label: 'No', resolution: 'replace' },
        {
          label: 'Yes',
          next: {
            prompt: `Is there visible damage ${stamp}?`,
            options: [{ label: 'Yes', reasonCode }],
          },
        },
      ],
    }

    try {
      guideId = await createGuide(request, adminToken, {
        claimType: 'warranty',
        reasonCode,
        title: `QA WC Troubleshooting ${stamp}`,
        steps,
        isActive: true,
      })

      let guide = await readGuide(request, adminToken, guideId)
      expect(guide.title).toBe(`QA WC Troubleshooting ${stamp}`)
      expect(guide.claimType).toBe('warranty')
      expect(guide.reasonCode).toBe(reasonCode)
      expect(guide.steps?.prompt).toBe(steps.prompt)
      expect(guide.isActive).toBe(true)

      const updateResponse = await apiRequest(request, 'PUT', '/api/warranty_claims/troubleshooting-guides', {
        token: adminToken,
        data: {
          id: guideId,
          title: `QA WC Troubleshooting Updated ${stamp}`,
          isActive: true,
        },
      })
      const updateBody = await readJsonSafe<OkResponse>(updateResponse)
      expect(updateResponse.status(), `PUT troubleshooting guide should return 200: ${JSON.stringify(updateBody)}`).toBe(200)
      expect(updateBody?.ok).toBe(true)
      guide = await readGuide(request, adminToken, guideId)
      expect(guide.title).toBe(`QA WC Troubleshooting Updated ${stamp}`)

      customerRoleId = (await createCustomerRoleFixture(request, adminToken, {
        name: `QA WC Troubleshooting Portal ${stamp}`,
        features: [],
      })).id
      customerId = await createCustomerCompanyFixture(request, adminToken, `QA WC Troubleshooting Customer ${stamp}`)
      const customerUser = await createCustomerUserFixture(request, adminToken, {
        customerEntityId: customerId,
        roleIds: [customerRoleId],
        displayName: `QA WC Troubleshooting User ${stamp}`,
      })
      customerUserId = customerUser.id
      const session = await portalLogin(request, {
        email: customerUser.email,
        password: customerUser.password,
        tenantId,
      })

      const matchQuery = new URLSearchParams({ claimType: 'warranty', reasonCode })
      const matchResponse = await request.get(`/api/warranty_claims/portal/troubleshooting?${matchQuery.toString()}`, {
        headers: portalCookieHeaders(session),
      })
      const matchBody = await readJsonSafe<PortalTroubleshootingResponse>(matchResponse)
      expect(matchResponse.status(), `portal troubleshooting match should return 200: ${JSON.stringify(matchBody)}`).toBe(200)
      expect(matchBody?.guide?.id).toBe(guideId)
      expect(matchBody?.guide?.title).toBe(`QA WC Troubleshooting Updated ${stamp}`)
      expect(matchBody?.guide?.steps.prompt).toBe(steps.prompt)

      const missingQuery = new URLSearchParams({ claimType: 'warranty', reasonCode: missingReasonCode })
      const missingResponse = await request.get(`/api/warranty_claims/portal/troubleshooting?${missingQuery.toString()}`, {
        headers: portalCookieHeaders(session),
      })
      const missingBody = await readJsonSafe<PortalTroubleshootingResponse>(missingResponse)
      expect(missingResponse.status(), `portal troubleshooting null lookup should return 200: ${JSON.stringify(missingBody)}`).toBe(200)
      expect(missingBody?.guide).toBeNull()
    } finally {
      await deleteCustomerUserFixture(request, adminToken, customerUserId)
      await deleteCustomerRoleFixture(request, adminToken, customerRoleId)
      await deleteCustomerCompanyFixture(request, adminToken, customerId)
      await deleteGuideIfExists(request, adminToken, guideId)
    }
  })
})
