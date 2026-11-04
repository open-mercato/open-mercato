import { randomUUID } from 'node:crypto'
import { expect, test as base, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture, createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  cleanupReceivingClaimFixture,
  createClaimFixture,
  listClaimLines,
  readClaim,
  readClaimLine,
  readWarrantyClaimSettings,
  receiveClaimLine,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  submitClaim,
  transitionClaim,
  updateClaim,
  type ClaimItem,
  type ClaimLineItem,
  type WarrantyClaimSettingsResult,
} from '../helpers'

export type RecoveryAction = 'grading' | 'label' | 'release'
export type RecoveryFixture = {
  claim: ClaimItem & { id: string; updatedAt: string }
  line: ClaimLineItem & { id: string; updatedAt: string }
  writerToken: string
  email: string
  password: string
}

async function deleteOwnedUser(request: APIRequestContext, token: string, userId: string) {
  const response = await apiRequest(request, 'DELETE', `/api/auth/users?id=${userId}`, { token })
  expect(response.status(), 'delete owned user').toBe(200)
  const lookup = await apiRequest(request, 'GET', `/api/auth/users?ids=${userId}`, { token })
  expect(lookup.status()).toBe(200)
  expect(await readJsonSafe(lookup)).toMatchObject({ items: [] })
}

export const test = base.extend<{
  recovery: RecoveryFixture
  recoveryAction: RecoveryAction
  bootstrapRequest: APIRequestContext
}>({
  recoveryAction: ['grading', { option: true }],
  bootstrapRequest: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL })
    try { await use(context) } finally { await context.dispose() }
  },
  recovery: async ({ request, bootstrapRequest, recoveryAction }, use) => {
    const bootstrapToken = await getAuthToken(bootstrapRequest, 'superadmin')
    const { tenantId } = getTokenContext(bootstrapToken)
    const suffix = randomUUID()
    const password = `Wc8579!${randomUUID()}`
    const email = `wc8579-browser-${suffix}@example.com`
    const writerEmail = `wc8579-writer-${suffix}@example.com`
    const userIds: string[] = []
    let organizationId: string | null = null
    let claimId: string | null = null
    let writerToken: string | null = null
    let settingsBefore: WarrantyClaimSettingsResult | null = null
    let recordLockSettingsBefore: Record<string, unknown> | null = null

    try {
      const lockingSettings = await apiRequest(bootstrapRequest, 'GET', '/api/record_locks/settings', { token: bootstrapToken })
      if (lockingSettings.status() === 200) {
        const body = await readJsonSafe<{ settings: Record<string, unknown> }>(lockingSettings)
        expect(typeof body?.settings.enabled).toBe('boolean')
        recordLockSettingsBefore = body!.settings
        const disabled = await apiRequest(bootstrapRequest, 'POST', '/api/record_locks/settings', {
          token: bootstrapToken, data: { ...recordLockSettingsBefore, enabled: false },
        })
        expect(disabled.status()).toBe(200)
        expect(await readJsonSafe(disabled)).toMatchObject({ settings: { enabled: false } })
      } else {
        expect(lockingSettings.status(), 'record locks may be absent in OSS installations').toBe(404)
      }
      organizationId = await createOrganizationFixture(bootstrapRequest, bootstrapToken, { name: `WC8579 ${suffix}`, tenantId })
      for (const userEmail of [email, writerEmail]) {
        userIds.push(await createUserFixture(bootstrapRequest, bootstrapToken, {
          email: userEmail, password, organizationId, roles: ['admin'],
        }))
      }
      writerToken = await getAuthToken(request, writerEmail, password)
      expect(getTokenContext(writerToken).organizationId).toBe(organizationId)
      settingsBefore = await readWarrantyClaimSettings(request, writerToken)
      await saveWarrantyClaimSettings(request, writerToken, {
        autoApproveEnabled: false,
        adjudicationUseRules: false,
        quarantineGrades: ['D'],
        returnLabelProvider: null,
      }, settingsBefore.updatedAt)
      let claim = await createClaimFixture(request, writerToken, {
        claimType: 'warranty',
        customerName: `WC8579 ${suffix}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [{ productName: `Conflict regression ${suffix}`, qtyClaimed: 1, creditAmount: 10 }],
      })
      claimId = claim.id!
      expect((await submitClaim(request, writerToken, claimId, claim.updatedAt)).status()).toBe(200)
      const statuses = recoveryAction === 'label'
        ? ['in_review', 'approved']
        : ['in_review', 'approved', 'awaiting_return', 'received']
      for (const toStatus of statuses) {
        claim = await readClaim(request, writerToken, claimId)
        expect((await transitionClaim(request, writerToken, { id: claimId, toStatus }, claim.updatedAt)).status()).toBe(200)
      }
      const [createdLine] = await listClaimLines(request, writerToken, claimId)
      expect(createdLine.id).toBeTruthy()
      if (recoveryAction === 'release') {
        expect((await receiveClaimLine(request, writerToken, {
          lineId: createdLine.id!, conditionGrade: 'D', updatedAt: createdLine.updatedAt,
        })).status()).toBe(200)
      }
      claim = await readClaim(request, writerToken, claimId)
      const parentUpdate = await updateClaim(request, writerToken, {
        id: claimId, vendorRef: `Independent parent version ${suffix}`,
      }, claim.updatedAt)
      expect(parentUpdate.status(), JSON.stringify(await readJsonSafe(parentUpdate))).toBe(200)
      claim = await readClaim(request, writerToken, claimId)
      const line = await readClaimLine(request, writerToken, claimId, createdLine.id!)
      expect(claim.updatedAt).toBeTruthy()
      expect(line.updatedAt).toBeTruthy()
      expect(line.updatedAt, 'line and claim versions must be distinguishable').not.toBe(claim.updatedAt)
      await use({
        claim: { ...claim, id: claimId, updatedAt: claim.updatedAt! },
        line: { ...line, id: line.id!, updatedAt: line.updatedAt! },
        writerToken, email, password,
      })
    } finally {
      const failures: unknown[] = []
      for (const cleanup of [
        async () => { await restoreWarrantyClaimSettings(request, writerToken, settingsBefore) },
        async () => {
          if (!writerToken || !claimId) return
          await cleanupReceivingClaimFixture(request, writerToken, claimId)
          expect(await listClaimLines(request, writerToken, claimId), 'owned lines should be deleted').toEqual([])
        },
        async () => {
          if (!recordLockSettingsBefore) return
          const restored = await apiRequest(bootstrapRequest, 'POST', '/api/record_locks/settings', {
            token: bootstrapToken, data: recordLockSettingsBefore,
          })
          expect(restored.status()).toBe(200)
          expect(await readJsonSafe(restored)).toEqual({ settings: recordLockSettingsBefore })
        },
        ...userIds.reverse().map((userId) => async () => { await deleteOwnedUser(bootstrapRequest, bootstrapToken, userId) }),
        async () => {
          if (!organizationId) return
          const response = await apiRequest(bootstrapRequest, 'DELETE', '/api/directory/organizations', {
            token: bootstrapToken, data: { id: organizationId },
          })
          expect(response.status(), 'delete owned organization').toBe(200)
        },
      ]) {
        try { await cleanup() } catch (error) { failures.push(error) }
      }
      if (failures.length) throw new AggregateError(failures, 'WC8579 fixture cleanup failed')
    }
  },
})
