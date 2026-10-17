import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import {
  expectOperation,
  expectTokenConsumed,
  redoOk,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'
import { changeOverrideState, uniqueToggleIdentifier } from './featureToggleTestHelpers'

type ResolvedState = { value: boolean | undefined; source: string | undefined; overrideId: string | undefined }

async function readResolvedState(
  request: APIRequestContext,
  token: string,
  toggleId: string,
  identifier: string,
): Promise<ResolvedState> {
  const checkResponse = await apiRequest(
    request,
    'GET',
    `/api/feature_toggles/check/boolean?identifier=${encodeURIComponent(identifier)}`,
    { token },
  )
  expect(checkResponse.status()).toBe(200)
  const check = await readJsonSafe<{ value?: boolean; resolution?: { source?: string } }>(checkResponse)

  const detailResponse = await apiRequest(
    request,
    'GET',
    `/api/feature_toggles/global/${encodeURIComponent(toggleId)}/override`,
    { token },
  )
  expect(detailResponse.status()).toBe(200)
  const detail = await readJsonSafe<{ id?: string; value?: boolean }>(detailResponse)
  expect(detail?.value).toBe(check?.value)

  return { value: check?.value, source: check?.resolution?.source, overrideId: detail?.id }
}

test.describe('TC-FT-011: Undo and redo of override state changes restore the previous override', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('undo of an override value change restores the previous value and redo reapplies it', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const identifier = uniqueToggleIdentifier('qa_override_undo_value')
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier,
        name: 'QA Override Undo Value',
        type: 'boolean',
        defaultValue: true,
      })

      const firstResponse = await changeOverrideState(request, adminToken, {
        toggleId,
        isOverride: true,
        overrideValue: false,
      })
      expect(firstResponse.status()).toBe(200)
      const initial = await readResolvedState(request, adminToken, toggleId, identifier)
      expect(initial).toMatchObject({ value: false, source: 'override' })
      expect(initial.overrideId).toBeTruthy()

      const changeResponse = await changeOverrideState(request, adminToken, {
        toggleId,
        isOverride: true,
        overrideValue: true,
      })
      expect(changeResponse.status()).toBe(200)
      const changeOperation = expectOperation(changeResponse, 'override value change')
      expect(await readResolvedState(request, adminToken, toggleId, identifier)).toMatchObject({
        value: true,
        source: 'override',
        overrideId: initial.overrideId,
      })

      const undoLogId = await undoOk(request, adminToken, changeOperation.undoToken, 'override value change')
      expect(await readResolvedState(request, adminToken, toggleId, identifier)).toEqual(initial)
      await expectTokenConsumed(request, adminToken, changeOperation.undoToken, 'override value change')

      await redoOk(request, adminToken, undoLogId, 'override value change')
      expect(await readResolvedState(request, adminToken, toggleId, identifier)).toMatchObject({
        value: true,
        source: 'override',
        overrideId: initial.overrideId,
      })
    } finally {
      await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
    }
  })

  test('undo of clearing an override recreates it with the previous value', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const identifier = uniqueToggleIdentifier('qa_override_undo_clear')
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier,
        name: 'QA Override Undo Clear',
        type: 'boolean',
        defaultValue: true,
      })

      const setResponse = await changeOverrideState(request, adminToken, {
        toggleId,
        isOverride: true,
        overrideValue: false,
      })
      expect(setResponse.status()).toBe(200)
      const initial = await readResolvedState(request, adminToken, toggleId, identifier)
      expect(initial).toMatchObject({ value: false, source: 'override' })
      expect(initial.overrideId).toBeTruthy()

      const clearResponse = await changeOverrideState(request, adminToken, { toggleId, isOverride: false })
      expect(clearResponse.status()).toBe(200)
      const clearOperation = expectOperation(clearResponse, 'override clear')
      expect(await readResolvedState(request, adminToken, toggleId, identifier)).toMatchObject({
        value: true,
        source: 'default',
        overrideId: '',
      })

      await undoOk(request, adminToken, clearOperation.undoToken, 'override clear')
      expect(await readResolvedState(request, adminToken, toggleId, identifier)).toEqual(initial)
    } finally {
      await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
    }
  })

  test('undo of creating an override returns the toggle to its default', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const identifier = uniqueToggleIdentifier('qa_override_undo_create')
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier,
        name: 'QA Override Undo Create',
        type: 'boolean',
        defaultValue: true,
      })

      const createResponse = await changeOverrideState(request, adminToken, {
        toggleId,
        isOverride: true,
        overrideValue: false,
      })
      expect(createResponse.status()).toBe(200)
      const createOperation = expectOperation(createResponse, 'override create')
      expect(await readResolvedState(request, adminToken, toggleId, identifier)).toMatchObject({
        value: false,
        source: 'override',
      })

      await undoOk(request, adminToken, createOperation.undoToken, 'override create')
      expect(await readResolvedState(request, adminToken, toggleId, identifier)).toMatchObject({
        value: true,
        source: 'default',
        overrideId: '',
      })
    } finally {
      await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
    }
  })
})
