import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createOrderLineFixture, deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import {
  createCustomerCompanyFixture,
  deleteCustomerCompanyFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  cleanupDraftClaimWithLines,
  createClaimFixture,
  createWarrantyRegistrationFixture,
  deleteWarrantyRegistrationIfExists,
  readClaim,
  readWarrantyClaimSettings,
  readWarrantyEntitlement,
  readWarrantyRegistration,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  updateWarrantyRegistration,
  uniqueLabel,
  type WarrantyClaimSettingsResult,
} from './helpers'

async function createSalesOrderForCustomer(
  request: APIRequestContext,
  token: string,
  input: { customerId: string; orderNumber: string; lineName: string; sku: string },
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
    sku: input.sku,
    name: input.lineName,
    quantity: 1,
    unitPriceNet: 30,
    unitPriceGross: 36,
    currencyCode: 'USD',
  })
  return { orderId, lineId }
}

async function setDefaultWarrantyMonths(
  request: APIRequestContext,
  token: string,
  months: number,
  snapshot: WarrantyClaimSettingsResult,
): Promise<void> {
  const current = await readWarrantyClaimSettings(request, token)
  await saveWarrantyClaimSettings(request, token, {
    slaHours: current.slaHours,
    slaPauseOnInfoRequested: current.slaPauseOnInfoRequested,
    slaAtRiskThresholdPct: current.slaAtRiskThresholdPct,
    autoApproveEnabled: current.autoApproveEnabled,
    autoApproveMaxAmount: current.autoApproveMaxAmount,
    autoApproveCurrencyCode: current.autoApproveCurrencyCode,
    autoApproveRequireInWarranty: current.autoApproveRequireInWarranty,
    defaultWarrantyMonths: months,
    businessHours: current.businessHours,
    escalationTiers: current.escalationTiers,
    adjudicationUseRules: current.adjudicationUseRules,
    quarantineGrades: current.quarantineGrades,
    returnLabelProvider: current.returnLabelProvider,
  }, current.updatedAt ?? snapshot.updatedAt)
}

test.describe('TC-WC-017: warranty claim registration and entitlement', () => {
  test('covers registration CRUD locking, entitlement precedence, and claim entitlement stamping', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-017')
    const settingsBefore = await readWarrantyClaimSettings(request, adminToken)
    const purchaseDate = new Date().toISOString()
    const serialNumber = `SER-017-${stamp}`

    let customerId: string | null = null
    let orderId: string | null = null
    let orderLineId: string | null = null
    let registrationId: string | null = null
    let claimId: string | null = null

    try {
      await setDefaultWarrantyMonths(request, adminToken, 12, settingsBefore)
      customerId = await createCustomerCompanyFixture(request, adminToken, `QA WC Entitlement Customer ${stamp}`)
      const order = await createSalesOrderForCustomer(request, adminToken, {
        customerId,
        orderNumber: `WC-017-${stamp}`,
        lineName: 'QA entitlement order line',
        sku: `WC-017-SKU-${stamp}`,
      })
      orderId = order.orderId
      orderLineId = order.lineId

      const registration = await createWarrantyRegistrationFixture(request, adminToken, {
        serialNumber,
        sku: `WC-017-SKU-${stamp}`,
        productName: 'QA registered product',
        customerId,
        orderId,
        purchaseDate,
        warrantyMonths: 24,
        coverageType: 'extended',
        source: 'manual',
        notes: `Initial registration ${stamp}`,
      })
      registrationId = registration.id
      expect(registration.serialNumber).toBe(serialNumber)
      expect(registration.customerId).toBe(customerId)
      expect(registration.orderId).toBe(orderId)
      expect(registration.updatedAt, 'registration create should expose updatedAt').toBeTruthy()
      expect(registration.warrantyExpiresAt, 'registration should compute warrantyExpiresAt').toBeTruthy()

      const staleUpdatedAt = registration.updatedAt
      await new Promise((resolve) => setTimeout(resolve, 10))
      const updateResponse = await updateWarrantyRegistration(
        request,
        adminToken,
        { id: registration.id, notes: `Fresh registration edit ${stamp}` },
        registration.updatedAt,
      )
      expect(updateResponse.status(), 'fresh registration update should return 200').toBe(200)
      const updatedRegistration = await readWarrantyRegistration(request, adminToken, registration.id!)
      expect(updatedRegistration.notes).toBe(`Fresh registration edit ${stamp}`)

      const staleResponse = await updateWarrantyRegistration(
        request,
        adminToken,
        { id: registration.id, notes: `Stale registration edit ${stamp}` },
        staleUpdatedAt,
      )
      expect(staleResponse.status(), 'stale registration update should return 409').toBe(409)

      const registrationEntitlement = await readWarrantyEntitlement(
        request,
        adminToken,
        new URLSearchParams({
          serialNumber,
          orderId,
          purchaseDate,
          sku: `WC-017-SKU-${stamp}`,
        }).toString(),
      )
      expect(registrationEntitlement.source, 'serial registration should take precedence over order/date').toBe('registration')
      expect(registrationEntitlement.coverageType).toBe('extended')
      expect(registrationEntitlement.priorRegistrationCount).toBeGreaterThan(0)

      const orderEntitlement = await readWarrantyEntitlement(
        request,
        adminToken,
        new URLSearchParams({
          orderId,
          purchaseDate,
          sku: `WC-017-SKU-${stamp}`,
        }).toString(),
      )
      expect(orderEntitlement.source).toBe('order')
      expect(orderEntitlement.warrantyStatus).toBe('in_warranty')

      const resolverEntitlement = await readWarrantyEntitlement(
        request,
        adminToken,
        new URLSearchParams({
          purchaseDate,
          sku: `WC-017-SKU-${stamp}`,
        }).toString(),
      )
      expect(resolverEntitlement.source).toBe('resolver')
      expect(resolverEntitlement.warrantyStatus).toBe('in_warranty')

      const stampedClaim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerId,
        orderId,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            orderLineId,
            sku: `WC-017-SKU-${stamp}`,
            productName: 'QA entitlement stamped product',
            serialNumber,
            purchaseDate,
            faultDescription: 'Claim should stamp entitlement source',
            qtyClaimed: 1,
            creditAmount: 25,
          },
        ],
      })
      claimId = stampedClaim.id
      const readStampedClaim = await readClaim(request, adminToken, stampedClaim.id!)
      expect(
        readStampedClaim.entitlementSource,
        'created claim should expose a non-null entitlement_source when serial/order facts are present',
      ).toBeTruthy()
    } finally {
      await cleanupDraftClaimWithLines(request, adminToken, claimId)
      await deleteWarrantyRegistrationIfExists(request, adminToken, registrationId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/order-lines', orderLineId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      await deleteCustomerCompanyFixture(request, adminToken, customerId)
      await restoreWarrantyClaimSettings(request, adminToken, settingsBefore)
    }
  })
})
