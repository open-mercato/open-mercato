import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createFeatureToggleFixture, deleteFeatureToggleIfExists } from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { expectOperation, redoOk, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import type { FeatureToggleOverrideResponse } from '../data/validators'
import { changeOverrideState, uniqueToggleIdentifier } from './featureToggleTestHelpers'

async function readOverride(request: APIRequestContext, token: string, toggleId: string) {
  const response = await apiRequest(request, 'GET', `/api/feature_toggles/global/${toggleId}/override`, { token })
  expect(response.status()).toBe(200)
  const override = await readJsonSafe<FeatureToggleOverrideResponse>(response)
  expect(override).toBeTruthy()
  return override!
}

async function expectResolvedValue(request: APIRequestContext, token: string, type: string, identifier: string, value: unknown) {
  const response = await apiRequest(request, 'GET', `/api/feature_toggles/check/${type}?identifier=${encodeURIComponent(identifier)}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ value: unknown }>(response)
  expect(body?.value).toEqual(value)
}

test.describe('TC-UNDO-001: Override creation redo preserves identity (#7665)', () => {
  test.beforeAll(skipIfUndoTestsDisabled)

  const cases = [
    { type: 'boolean', defaultValue: true, value: false },
    { type: 'number', defaultValue: 10, value: 0 },
    { type: 'string', defaultValue: 'default', value: 'original override' },
    { type: 'json', defaultValue: { enabled: true }, value: { enabled: false, limit: 0, nested: { tiers: ['alpha', 'beta'] } } },
  ]

  for (const toggleCase of cases) {
    test(`${toggleCase.type} override keeps its ID and value through repeated undo and redo`, async ({ request }) => {
      const superadminToken = await getAuthToken(request, 'superadmin')
      const adminToken = await getAuthToken(request, 'admin')
      const identifier = uniqueToggleIdentifier(`redo_identity_${toggleCase.type}`)
      let toggleId: string | null = null

      try {
        toggleId = await createFeatureToggleFixture(request, superadminToken, {
          identifier,
          name: 'Override redo identity',
          type: toggleCase.type,
          defaultValue: toggleCase.defaultValue,
        })
        const inherited = await readOverride(request, adminToken, toggleId)
        await expectResolvedValue(request, adminToken, toggleCase.type, identifier, toggleCase.defaultValue)

        if (toggleCase.type === 'boolean') {
          const clearResponse = await changeOverrideState(request, adminToken, { toggleId, isOverride: false })
          expect(clearResponse.status()).toBe(200)
          const clearOperation = expectOperation(clearResponse, 'clear inherited override')
          const clearLogId = await undoOk(request, adminToken, clearOperation.undoToken, 'clear inherited override')
          await redoOk(request, adminToken, clearLogId, 'clear inherited override')
          expect(await readOverride(request, adminToken, toggleId)).toEqual(inherited)
        }

        const response = await changeOverrideState(request, adminToken, { toggleId, isOverride: true, overrideValue: toggleCase.value })
        expect(response.status()).toBe(200)
        const operation = expectOperation(response, 'override creation')
        const created = await readOverride(request, adminToken, toggleId)
        expect(created.id).toEqual(expect.any(String))
        expect(created.id).not.toBe('')
        expect(created.value).toEqual(toggleCase.value)
        await expectResolvedValue(request, adminToken, toggleCase.type, identifier, toggleCase.value)

        let undoToken = operation.undoToken
        let previousVersion = created.updatedAt
        for (let cycle = 0; cycle < 2; cycle += 1) {
          const logId = await undoOk(request, adminToken, undoToken, 'override creation')
          expect(await readOverride(request, adminToken, toggleId)).toEqual(inherited)
          await expectResolvedValue(request, adminToken, toggleCase.type, identifier, toggleCase.defaultValue)

          const redoneOperation = await redoOk(request, adminToken, logId, 'override creation')
          const redone = await readOverride(request, adminToken, toggleId)
          expect(redone).toEqual({ ...created, updatedAt: redone.updatedAt })
          expect(typeof redone.updatedAt).toBe('string')
          expect(Date.parse(redone.updatedAt!)).toBeGreaterThan(Date.parse(previousVersion!))
          await expectResolvedValue(request, adminToken, toggleCase.type, identifier, toggleCase.value)
          expect(redoneOperation.undoToken).toEqual(expect.any(String))
          undoToken = redoneOperation.undoToken!
          previousVersion = redone.updatedAt
        }
      } finally {
        try {
          if (toggleId) {
            await changeOverrideState(request, adminToken, { toggleId, isOverride: false })
          }
        } finally {
          await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
        }
      }
    })
  }
})
