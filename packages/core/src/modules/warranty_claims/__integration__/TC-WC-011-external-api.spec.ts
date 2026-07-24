import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createOrderLineFixture, deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import {
  createCustomerCompanyFixture,
  deleteCustomerCompanyFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  createApiKeyFixture,
  createClaimFixture,
  deleteApiKeyIfExists,
  externalRequest,
  listClaims,
  postClaimEvent,
  readClaim,
  readRequiredJson,
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  uniqueLabel,
} from './helpers'

type ExternalSubmitResponse = {
  ok?: boolean
  id?: string | null
  claimNumber?: string | null
  status?: string | null
  externalRef?: string | null
  lines?: Array<{ id?: string | null; warrantyStatus?: string | null }>
}

type ExternalLookupResponse = {
  ok?: boolean
  claim?: {
    id?: string | null
    claimNumber?: string | null
    externalRef?: string | null
    status?: string | null
    channel?: string | null
  }
  lines?: Array<{ id?: string | null; warrantyStatus?: string | null }>
  events?: Array<{ id?: string | null; kind?: string | null; body?: string | null }>
}

async function createSalesOrderForCustomer(
  request: APIRequestContext,
  token: string,
  input: { customerId: string; orderNumber: string; lineName: string },
): Promise<{ orderId: string; lineId: string }> {
  const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
    token,
    data: {
      currencyCode: 'USD',
      customerEntityId: input.customerId,
      customerReference: input.orderNumber,
      orderNumber: input.orderNumber,
      placedAt: new Date().toISOString(),
    },
  })
  const orderBody = await readJsonSafe<{ id?: string | null }>(orderResponse)
  expect(orderResponse.status(), `sales order ${input.orderNumber} should be created`).toBe(201)
  expect(orderBody?.id, 'sales order create response should include id').toBeTruthy()
  const orderId = orderBody!.id as string
  const lineId = await createOrderLineFixture(request, token, orderId, {
    kind: 'product',
    name: input.lineName,
    quantity: 2,
    unitPriceNet: 10,
    unitPriceGross: 12,
    currencyCode: 'USD',
  })
  return { orderId, lineId }
}

test.describe('TC-WC-011: warranty claims external API', () => {
  test('authenticates API keys, resolves order/customer references, is idempotent, and filters timeline visibility', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    const stamp = uniqueLabel('tc-wc-011')
    const settingsBefore = await readWarrantyClaimSettings(request, adminToken)

    const createdApiKeys: Array<{ id: string | null; token: string | null }> = []
    const createdClaimRefs: Array<{ id: string | null; token: string | null }> = []
    let externalRoleId: string | null = null
    let noExternalRoleId: string | null = null
    let orgBId: string | null = null
    let orgBRoleId: string | null = null
    let orgBUserId: string | null = null
    let companyAId: string | null = null
    let companyBId: string | null = null
    let orderAId: string | null = null
    let orderALineId: string | null = null

    try {
      await saveWarrantyClaimSettings(request, adminToken, {
        autoApproveEnabled: false,
        autoApproveMaxAmount: null,
        autoApproveCurrencyCode: null,
        autoApproveRequireInWarranty: true,
      }, settingsBefore.updatedAt)

      externalRoleId = await createRoleFixture(request, superadminToken, {
        tenantId,
        name: uniqueLabel('wc-ext'),
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: externalRoleId,
        features: ['warranty_claims.external.submit', 'warranty_claims.external.view'],
        organizations: [organizationId],
      })
      noExternalRoleId = await createRoleFixture(request, superadminToken, {
        tenantId,
        name: uniqueLabel('wc-ext-denied'),
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: noExternalRoleId,
        features: ['warranty_claims.claim.view'],
        organizations: [organizationId],
      })

      const externalKey = await createApiKeyFixture(request, adminToken, {
        name: uniqueLabel('wc-ext-key'),
        roles: [externalRoleId],
        tenantId,
        organizationId,
      })
      createdApiKeys.push({ id: externalKey.id, token: adminToken })
      const noExternalKey = await createApiKeyFixture(request, adminToken, {
        name: uniqueLabel('wc-ext-denied-key'),
        roles: [noExternalRoleId],
        tenantId,
        organizationId,
      })
      createdApiKeys.push({ id: noExternalKey.id, token: adminToken })

      const companyAName = `QA WC External Customer A ${stamp}`
      const companyBName = `QA WC External Customer B ${stamp}`
      companyAId = await createCustomerCompanyFixture(request, adminToken, companyAName)
      companyBId = await createCustomerCompanyFixture(request, adminToken, companyBName)
      const orderNumber = `WC-EXT-ORDER-${stamp}`
      const order = await createSalesOrderForCustomer(request, adminToken, {
        customerId: companyAId,
        orderNumber,
        lineName: `QA WC External Order Line ${stamp}`,
      })
      orderAId = order.orderId
      orderALineId = order.lineId

      const validExternalBody = {
        externalRef: uniqueLabel('ext'),
        orderNumber,
        reasonCode: 'defective',
        lines: [
          {
            sku: `WC-EXT-SKU-${stamp}`,
            faultDescription: 'External submit reported a warranty failure',
            qtyClaimed: 1,
          },
        ],
      }

      const noKey = await request.post('/api/warranty_claims/external/claims', {
        headers: { 'Content-Type': 'application/json', Cookie: '' },
        data: validExternalBody,
      })
      expect(noKey.status(), 'external POST without X-Api-Key should return 401').toBe(401)

      const garbageKey = await externalRequest(
        request,
        'POST',
        '/api/warranty_claims/external/claims',
        'not-a-real-api-key',
        validExternalBody,
      )
      expect(garbageKey.status(), 'external POST with an invalid API key should return 401').toBe(401)

      const forbiddenBeforeValidation = await externalRequest(
        request,
        'POST',
        '/api/warranty_claims/external/claims',
        noExternalKey.secret,
        { definitelyInvalid: true },
      )
      expect(forbiddenBeforeValidation.status(), 'key without external.submit should be rejected before validation').toBe(403)

      const missingExternalRef = await externalRequest(
        request,
        'POST',
        '/api/warranty_claims/external/claims',
        externalKey.secret,
        {
          orderNumber,
          reasonCode: 'defective',
          lines: [{ faultDescription: 'Missing external ref but otherwise valid', qtyClaimed: 1 }],
        },
      )
      expect(missingExternalRef.status(), 'missing externalRef should return 400').toBe(400)

      const createResponse = await externalRequest(
        request,
        'POST',
        '/api/warranty_claims/external/claims',
        externalKey.secret,
        validExternalBody,
      )
      const created = await readRequiredJson<ExternalSubmitResponse>(
        createResponse,
        'external create response should be JSON',
      )
      expect(createResponse.status(), `external happy path should return 201: ${JSON.stringify(created)}`).toBe(201)
      expect(created.id, 'external create response should include id').toBeTruthy()
      expect(created.claimNumber, 'external create response should include claimNumber').toBeTruthy()
      expect(created.status).toBe('submitted')
      expect(created.externalRef).toBe(validExternalBody.externalRef)
      expect(created.lines?.length, 'external create response should include lines').toBeGreaterThan(0)
      expect(Object.prototype.hasOwnProperty.call(created.lines?.[0] ?? {}, 'warrantyStatus')).toBe(true)
      const claimId = created.id as string
      createdClaimRefs.push({ id: claimId, token: adminToken })
      const staffClaim = await readClaim(request, adminToken, claimId)
      expect(staffClaim.channel).toBe('api')
      expect(staffClaim.customerId).toBe(companyAId)
      expect(staffClaim.customerName).toBe(companyAName)

      const claimsAfterFirstCreate = (await listClaims(
        request,
        adminToken,
        `channel=api&search=${encodeURIComponent(companyAName)}&pageSize=100`,
      )).filter((item) => item.customerName === companyAName)
      expect(claimsAfterFirstCreate.map((item) => item.id)).toEqual([claimId])

      const replayResponse = await externalRequest(
        request,
        'POST',
        '/api/warranty_claims/external/claims',
        externalKey.secret,
        validExternalBody,
      )
      const replay = await readRequiredJson<ExternalSubmitResponse>(
        replayResponse,
        'external replay response should be JSON',
      )
      expect(replayResponse.status(), 'idempotent replay should return 200').toBe(200)
      expect(replay.id).toBe(claimId)
      const claimsAfterReplay = (await listClaims(
        request,
        adminToken,
        `channel=api&search=${encodeURIComponent(companyAName)}&pageSize=100`,
      )).filter((item) => item.customerName === companyAName)
      expect(claimsAfterReplay.map((item) => item.id)).toEqual([claimId])

      const mismatchResponse = await externalRequest(
        request,
        'POST',
        '/api/warranty_claims/external/claims',
        externalKey.secret,
        {
          externalRef: uniqueLabel('ext-mismatch'),
          orderNumber,
          customerId: companyBId,
          reasonCode: 'defective',
          lines: [{ faultDescription: 'Contradicting customer reference', qtyClaimed: 1 }],
        },
      )
      expect(mismatchResponse.status(), 'contradicting customerId should return 400').toBe(400)
      const mismatchBody = await readJsonSafe<{ error?: string }>(mismatchResponse)
      expect(mismatchBody?.error, 'customer/order mismatch should include a stable error message').toBeTruthy()

      const missingOrder = await externalRequest(
        request,
        'POST',
        '/api/warranty_claims/external/claims',
        externalKey.secret,
        {
          externalRef: uniqueLabel('ext-missing-order'),
          orderNumber: uniqueLabel('missing'),
          reasonCode: 'defective',
          lines: [{ faultDescription: 'Unknown order number', qtyClaimed: 1 }],
        },
      )
      expect(missingOrder.status(), 'unresolvable orderNumber should return 400').toBe(400)

      const unlinkedContactName = `QA WC External Contact ${stamp}`
      const unlinkedResponse = await externalRequest(
        request,
        'POST',
        '/api/warranty_claims/external/claims',
        externalKey.secret,
        {
          externalRef: uniqueLabel('ext-unlinked'),
          contactName: unlinkedContactName,
          contactEmail: `wc-ext-${stamp}@example.invalid`,
          reasonCode: 'defective',
          lines: [{ faultDescription: 'Unlinked external claim', qtyClaimed: 1 }],
        },
      )
      const unlinked = await readRequiredJson<ExternalSubmitResponse>(
        unlinkedResponse,
        'unlinked external response should be JSON',
      )
      expect(unlinkedResponse.status(), 'unlinked contact-email path should return 201').toBe(201)
      expect(unlinked.id, 'unlinked external create response should include id').toBeTruthy()
      createdClaimRefs.push({ id: unlinked.id ?? null, token: adminToken })
      const unlinkedStaffClaim = await readClaim(request, adminToken, unlinked.id as string)
      expect(unlinkedStaffClaim.customerId).toBeNull()
      expect(unlinkedStaffClaim.customerName).toBe(unlinkedContactName)

      const unlinkedMissingEmail = await externalRequest(
        request,
        'POST',
        '/api/warranty_claims/external/claims',
        externalKey.secret,
        {
          externalRef: uniqueLabel('ext-no-contact-email'),
          reasonCode: 'defective',
          lines: [{ faultDescription: 'Missing contact email for unlinked claim', qtyClaimed: 1 }],
        },
      )
      expect(unlinkedMissingEmail.status(), 'unlinked external claim without contactEmail should return 400').toBe(400)

      const internalBody = `Internal-only external status note ${stamp}`
      const customerBody = `Customer-visible external status note ${stamp}`
      const internalComment = await postClaimEvent(request, adminToken, {
        claimId,
        body: internalBody,
        visibility: 'internal',
      })
      expect(internalComment.status(), 'staff internal comment should be accepted').toBe(200)
      const customerComment = await postClaimEvent(request, adminToken, {
        claimId,
        body: customerBody,
        visibility: 'customer',
      })
      expect(customerComment.status(), 'staff customer-visible comment should be accepted').toBe(200)

      const lookupResponse = await externalRequest(
        request,
        'GET',
        `/api/warranty_claims/external/claims?claimNumber=${encodeURIComponent(created.claimNumber as string)}`,
        externalKey.secret,
      )
      const lookup = await readRequiredJson<ExternalLookupResponse>(
        lookupResponse,
        'external lookup response should be JSON',
      )
      expect(lookupResponse.status(), 'external GET by claimNumber should return 200').toBe(200)
      expect(lookup.claim?.id).toBe(claimId)
      expect(lookup.lines?.length, 'external lookup should include claim lines').toBeGreaterThan(0)
      const externalEventBodies = (lookup.events ?? []).map((event) => event.body)
      expect(externalEventBodies).toContain(customerBody)
      expect(externalEventBodies).not.toContain(internalBody)

      orgBId = await createOrganizationFixture(request, superadminToken, {
        tenantId,
        name: `QA WC External Org B ${stamp}`,
      })
      orgBRoleId = await createRoleFixture(request, superadminToken, {
        tenantId,
        name: `QA WC External Org B Role ${stamp}`,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: orgBRoleId,
        features: [
          'warranty_claims.claim.view',
          'warranty_claims.claim.create',
          'warranty_claims.claim.manage',
          'warranty_claims.claim.delete',
        ],
        organizations: [orgBId],
      })
      const orgBPassword = 'Valid1!Pass'
      const orgBEmail = `${stamp}@org-b.test.invalid`
      orgBUserId = await createUserFixture(request, superadminToken, {
        email: orgBEmail,
        password: orgBPassword,
        organizationId: orgBId,
        roles: [orgBRoleId],
        name: `QA WC External Org B User ${stamp}`,
      })
      const orgBToken = await getAuthToken(request, orgBEmail, orgBPassword)
      const orgBExternalRef = uniqueLabel('ext-org-b')
      const orgBClaim = await createClaimFixture(request, orgBToken, {
        claimType: 'warranty',
        externalRef: orgBExternalRef,
        customerName: `QA WC External Org B Customer ${stamp}`,
        reasonCode: 'defective',
        lines: [
          {
            lineNo: 1,
            productName: `QA WC External Org B Product ${stamp}`,
            faultDescription: 'Org B isolated claim',
            qtyClaimed: 1,
          },
        ],
      })
      createdClaimRefs.push({ id: orgBClaim.id, token: orgBToken })

      const crossOrgLookup = await externalRequest(
        request,
        'GET',
        `/api/warranty_claims/external/claims?externalRef=${encodeURIComponent(orgBExternalRef)}`,
        externalKey.secret,
      )
      expect(crossOrgLookup.status(), 'org-A API key must not see org-B externalRef').toBe(404)
    } finally {
      await restoreWarrantyClaimSettings(request, adminToken, settingsBefore)
      for (const claim of [...createdClaimRefs].reverse()) {
        await cancelThenDeleteClaimIfPossible(request, claim.token, claim.id)
      }
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/order-lines', orderALineId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderAId)
      await deleteCustomerCompanyFixture(request, adminToken, companyBId)
      await deleteCustomerCompanyFixture(request, adminToken, companyAId)
      for (const key of [...createdApiKeys].reverse()) {
        await deleteApiKeyIfExists(request, key.token, key.id)
      }
      await deleteUserIfExists(request, superadminToken, orgBUserId)
      await deleteRoleIfExists(request, superadminToken, orgBRoleId)
      await deleteOrganizationIfExists(request, superadminToken, orgBId)
      await deleteRoleIfExists(request, superadminToken, noExternalRoleId)
      await deleteRoleIfExists(request, superadminToken, externalRoleId)
    }
  })
})
