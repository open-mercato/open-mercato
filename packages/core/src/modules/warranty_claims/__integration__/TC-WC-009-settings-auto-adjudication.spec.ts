import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
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
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  readClaim,
  readClaimEvents,
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  submitClaim,
  type ClaimItem,
  type WarrantyClaimSettingsResult,
  putWarrantyClaimSettings,
  uniqueLabel,
} from './helpers'

type AutoClaimOptions = {
  label: string
  serialNumber: string
  currencyCode?: string
  creditAmount?: number
  warrantyStatus?: 'in_warranty' | 'out_of_warranty' | 'unknown'
  customerName?: string
}

async function createAutoClaim(
  request: APIRequestContext,
  token: string,
  stamp: string,
  options: AutoClaimOptions,
): Promise<ClaimItem> {
  return createClaimFixture(request, token, {
    claimType: 'warranty',
    customerName: options.customerName ?? `QA WC Auto ${options.label} ${stamp}`,
    reasonCode: 'defective',
    currencyCode: options.currencyCode ?? 'USD',
    lines: [
      {
        lineNo: 1,
        sku: `WC-009-${options.label}-${stamp}`,
        productName: `QA auto adjudication ${options.label}`,
        serialNumber: options.serialNumber,
        faultDescription: `Auto adjudication ${options.label}`,
        qtyClaimed: 1,
        creditAmount: options.creditAmount ?? 25,
        warrantyStatus: options.warrantyStatus ?? 'in_warranty',
      },
    ],
  })
}

async function submitAndRead(
  request: APIRequestContext,
  token: string,
  claim: ClaimItem,
): Promise<ClaimItem> {
  expect(claim.id, 'claim should have id').toBeTruthy()
  const response = await submitClaim(request, token, claim.id!, claim.updatedAt)
  expect(response.status(), 'submit should return 200').toBe(200)
  return readClaim(request, token, claim.id!)
}

async function resetAutoApprovalOff(
  request: APIRequestContext,
  token: string,
  current: WarrantyClaimSettingsResult,
): Promise<WarrantyClaimSettingsResult> {
  return saveWarrantyClaimSettings(request, token, {
    slaHours: 48,
    slaPauseOnInfoRequested: true,
    slaAtRiskThresholdPct: 75,
    autoApproveEnabled: false,
    autoApproveMaxAmount: null,
    autoApproveCurrencyCode: null,
    autoApproveRequireInWarranty: true,
  }, current.updatedAt)
}

test.describe('TC-WC-009: warranty claim settings and auto-adjudication', () => {
  test('covers settings CRUD, locking, validation, and risk-gated auto-approval', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenScope(adminToken)
    const stamp = uniqueLabel('tc-wc-009')
    const settingsBefore = await readWarrantyClaimSettings(request, adminToken)

    const createdClaimIds: string[] = []
    let orgBId: string | null = null
    let orgBRoleId: string | null = null
    let orgBUserId: string | null = null

    try {
      orgBId = await createOrganizationFixture(request, superadminToken, {
        tenantId,
        name: `QA WC Settings Org ${stamp}`,
      })
      orgBRoleId = await createRoleFixture(request, superadminToken, {
        tenantId,
        name: `QA WC Settings Role ${stamp}`,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: orgBRoleId,
        features: ['warranty_claims.settings.manage'],
        organizations: [orgBId],
      })
      const orgBPassword = 'Valid1!Pass'
      orgBUserId = await createUserFixture(request, superadminToken, {
        email: `${stamp}@test.invalid`,
        password: orgBPassword,
        organizationId: orgBId,
        roles: [orgBRoleId],
        name: `QA WC Settings User ${stamp}`,
      })
      const orgBToken = await getAuthToken(request, `${stamp}@test.invalid`, orgBPassword)
      const orgBSettings = await readWarrantyClaimSettings(request, orgBToken)
      expect(orgBSettings).toMatchObject({
        slaHours: 48,
        slaPauseOnInfoRequested: true,
        slaAtRiskThresholdPct: 75,
        autoApproveEnabled: false,
        autoApproveMaxAmount: null,
        autoApproveCurrencyCode: null,
        autoApproveRequireInWarranty: true,
        updatedAt: null,
      })

      let settings = await resetAutoApprovalOff(request, adminToken, settingsBefore)
      settings = await saveWarrantyClaimSettings(request, adminToken, {
        slaHours: 6,
        slaPauseOnInfoRequested: false,
      }, settings.updatedAt)
      expect(settings.slaHours).toBe(6)
      expect(settings.slaPauseOnInfoRequested).toBe(false)
      expect(settings.autoApproveEnabled).toBe(false)
      expect(settings.updatedAt, 'settings upsert should return updatedAt').toBeTruthy()
      const staleUpdatedAt = settings.updatedAt

      await new Promise((resolve) => setTimeout(resolve, 10))
      settings = await saveWarrantyClaimSettings(request, adminToken, {
        slaAtRiskThresholdPct: 80,
      }, settings.updatedAt)
      expect(settings.slaHours, 'partial settings save should preserve prior values').toBe(6)
      expect(settings.slaAtRiskThresholdPct).toBe(80)

      settings = await saveWarrantyClaimSettings(request, adminToken, {
        defaultWarrantyMonths: 24,
      }, settings.updatedAt)
      expect(settings.defaultWarrantyMonths).toBe(24)
      expect((await readWarrantyClaimSettings(request, adminToken)).defaultWarrantyMonths).toBe(24)

      settings = await saveWarrantyClaimSettings(request, adminToken, {
        defaultWarrantyMonths: null,
      }, settings.updatedAt)
      expect(settings.defaultWarrantyMonths).toBeNull()
      expect((await readWarrantyClaimSettings(request, adminToken)).defaultWarrantyMonths).toBeNull()

      const stale = await putWarrantyClaimSettings(request, adminToken, { slaHours: 7 }, staleUpdatedAt)
      expect(stale.status(), 'stale settings optimistic-lock header should return 409').toBe(409)

      settings = await resetAutoApprovalOff(request, adminToken, settings)
      const invalidAutoApprove = await putWarrantyClaimSettings(
        request,
        adminToken,
        { autoApproveEnabled: true },
        settings.updatedAt,
      )
      expect(invalidAutoApprove.status(), 'enabled auto-approve without amount/currency should return 400').toBe(400)
      const invalidBody = await readJsonSafe<{ error?: string }>(invalidAutoApprove)
      expect(invalidBody?.error).toBe('warranty_claims.errors.autoApproveConfigIncomplete')

      settings = await saveWarrantyClaimSettings(request, adminToken, {
        slaHours: 48,
        slaPauseOnInfoRequested: true,
        slaAtRiskThresholdPct: 75,
        autoApproveEnabled: true,
        autoApproveMaxAmount: 50,
        autoApproveCurrencyCode: 'USD',
        autoApproveRequireInWarranty: true,
      }, settings.updatedAt)

      const eligible = await createAutoClaim(request, adminToken, stamp, {
        label: 'eligible',
        serialNumber: `SER-009-ELIGIBLE-${stamp}`,
      })
      createdClaimIds.push(eligible.id!)
      const approved = await submitAndRead(request, adminToken, eligible)
      expect(approved.status, 'eligible low-risk in-warranty claim should auto-approve').toBe('approved')
      const eligibleEvents = await readClaimEvents(request, adminToken, eligible.id!)
      expect(
        eligibleEvents.some((event) => event.kind === 'system' && event.payload?.action === 'auto_approved'),
        'auto-approved claim should include a system timeline event',
      ).toBe(true)

      const overMax = await createAutoClaim(request, adminToken, stamp, {
        label: 'over-max',
        serialNumber: `SER-009-OVER-${stamp}`,
        creditAmount: 75,
      })
      createdClaimIds.push(overMax.id!)
      expect((await submitAndRead(request, adminToken, overMax)).status, 'over-max amount should stay submitted').toBe('submitted')

      const currencyMismatch = await createAutoClaim(request, adminToken, stamp, {
        label: 'currency',
        serialNumber: `SER-009-CURRENCY-${stamp}`,
        currencyCode: 'EUR',
      })
      createdClaimIds.push(currencyMismatch.id!)
      expect((await submitAndRead(request, adminToken, currencyMismatch)).status, 'currency mismatch should stay submitted').toBe('submitted')

      const outOfWarranty = await createAutoClaim(request, adminToken, stamp, {
        label: 'out-warranty',
        serialNumber: `SER-009-OOW-${stamp}`,
        warrantyStatus: 'out_of_warranty',
      })
      createdClaimIds.push(outOfWarranty.id!)
      expect((await submitAndRead(request, adminToken, outOfWarranty)).status, 'out-of-warranty line should stay submitted').toBe('submitted')

      const duplicateSerial = `SER-009-DUP-${stamp}`
      const duplicatePrior = await createAutoClaim(request, adminToken, stamp, {
        label: 'duplicate-prior',
        serialNumber: duplicateSerial,
      })
      createdClaimIds.push(duplicatePrior.id!)
      const duplicateTarget = await createAutoClaim(request, adminToken, stamp, {
        label: 'duplicate-target',
        serialNumber: duplicateSerial,
      })
      createdClaimIds.push(duplicateTarget.id!)
      expect((await submitAndRead(request, adminToken, duplicateTarget)).status, 'duplicate-serial risk should stay submitted').toBe('submitted')

      settings = await saveWarrantyClaimSettings(request, adminToken, {
        autoApproveEnabled: false,
        autoApproveMaxAmount: null,
        autoApproveCurrencyCode: null,
        autoApproveRequireInWarranty: true,
      }, settings.updatedAt)
      expect(settings.autoApproveEnabled).toBe(false)
      const settingsOff = await createAutoClaim(request, adminToken, stamp, {
        label: 'settings-off',
        serialNumber: `SER-009-OFF-${stamp}`,
      })
      createdClaimIds.push(settingsOff.id!)
      expect((await submitAndRead(request, adminToken, settingsOff)).status, 'default/off auto-approval should stay submitted').toBe('submitted')
    } finally {
      await restoreWarrantyClaimSettings(request, adminToken, settingsBefore)
      for (const claimId of [...createdClaimIds].reverse()) {
        await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      }
      await deleteUserIfExists(request, superadminToken, orgBUserId)
      await deleteRoleIfExists(request, superadminToken, orgBRoleId)
      await deleteOrganizationIfExists(request, superadminToken, orgBId)
    }
  })
})
