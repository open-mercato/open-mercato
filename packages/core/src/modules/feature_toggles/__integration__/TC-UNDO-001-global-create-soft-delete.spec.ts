import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteFeatureToggleIfExists } from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, redoOk, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { changeOverrideState, countOverridesForToggleInDb, readToggleDeletionStateInDb, uniqueToggleIdentifier } from './featureToggleTestHelpers'

const GLOBAL_PATH = '/api/feature_toggles/global'

type ToggleSnapshot = {
  id: string
  identifier: string
  name: string
  description: string | null
  category: string | null
  type: 'boolean'
  defaultValue: boolean
  createdAt: string
  updatedAt: string
}

type OverrideSnapshot = {
  id: string
  value: boolean
  tenantId: string
  tenantName: string
  toggleType: 'boolean'
  updatedAt: string
}

async function readSnapshot<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status()).toBe(200)
  const snapshot = await readJsonSafe<T>(response)
  expect(snapshot).not.toBeNull()
  return snapshot as T
}

test.describe('TC-UNDO-001: Global create undo soft deletion (#7664)', () => {
  test.beforeAll(skipIfUndoTestsDisabled)

  test('retains the original row and overrides through repeated create undo and redo', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const payload = {
      identifier: uniqueToggleIdentifier('qa_create_soft_delete'),
      name: 'Create undo soft deletion',
      description: 'Original creation snapshot',
      category: 'undo-soft-delete',
      type: 'boolean',
      defaultValue: false,
    }
    let toggleId: string | null = null
    let pendingRedoLogId: string | null = null

    try {
      const response = await apiRequest(request, 'POST', GLOBAL_PATH, { token: superadminToken, data: payload })
      expect(response.status()).toBe(201)
      toggleId = expectId((await readJsonSafe<{ id: string }>(response))?.id, 'Global create returns an id')
      let undoToken = expectOperation(response, 'global create soft deletion').undoToken
      const detailPath = `${GLOBAL_PATH}/${encodeURIComponent(toggleId)}`
      const overridePath = `${detailPath}/override`
      const checkPath = `/api/feature_toggles/check/boolean?identifier=${encodeURIComponent(payload.identifier)}`
      const listPath = `${GLOBAL_PATH}?identifier=${encodeURIComponent(payload.identifier)}&pageSize=100`
      const created = await readSnapshot<ToggleSnapshot>(request, superadminToken, detailPath)
      expect(created).toMatchObject({ id: toggleId, ...payload })
      const overrideResponse = await changeOverrideState(request, adminToken, { toggleId, isOverride: true, overrideValue: true })
      expect(overrideResponse.status()).toBe(200)
      const override = await readSnapshot<OverrideSnapshot>(request, adminToken, overridePath)
      expect(override.id).toBeTruthy()
      expect(override.value).toBe(true)
      let previousVersion = created.updatedAt

      for (let cycle = 0; cycle < 2; cycle += 1) {
        expect(await readSnapshot(request, adminToken, checkPath)).toMatchObject({ value: true, resolution: { source: 'override' } })
        const visible = await readSnapshot<{ items: Array<{ id: string }> }>(request, superadminToken, listPath)
        expect(visible.items.map((item) => item.id)).toContain(toggleId)

        pendingRedoLogId = await undoOk(request, superadminToken, undoToken, 'global create soft deletion')
        const deleted = await readToggleDeletionStateInDb(toggleId)
        expect(deleted, 'Create undo retains the original database row').not.toBeNull()
        expect(deleted?.deletedAt).toBeInstanceOf(Date)
        expect(await countOverridesForToggleInDb(toggleId)).toBe(1)
        for (const path of [detailPath, overridePath, checkPath]) {
          const hidden = await apiRequest(request, 'GET', path, { token: adminToken })
          expect(hidden.status(), 'Deleted parent and retained override remain hidden').toBe(404)
        }
        const hiddenList = await readSnapshot<{ items: Array<{ id: string }> }>(request, superadminToken, listPath)
        expect(hiddenList.items.map((item) => item.id)).not.toContain(toggleId)

        const redone = await redoOk(request, superadminToken, pendingRedoLogId, 'global create soft deletion')
        pendingRedoLogId = null
        const restored = await readSnapshot<ToggleSnapshot>(request, superadminToken, detailPath)
        expect({ ...restored, updatedAt: created.updatedAt }).toEqual(created)
        expect(Date.parse(restored.updatedAt)).toBeGreaterThan(Date.parse(previousVersion))
        previousVersion = restored.updatedAt
        expect(await readToggleDeletionStateInDb(toggleId)).toEqual({ deletedAt: null })
        expect(await readSnapshot<OverrideSnapshot>(request, adminToken, overridePath)).toEqual(override)
        expect(await readSnapshot(request, adminToken, checkPath)).toMatchObject({ value: true, resolution: { source: 'override' } })
        undoToken = expectId(redone.undoToken, 'Redone creation remains undoable')
      }
    } finally {
      if (pendingRedoLogId) await redoOk(request, superadminToken, pendingRedoLogId, 'restore fixture for cleanup')
      if (toggleId) await changeOverrideState(request, adminToken, { toggleId, isOverride: false })
      await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
    }
  })
})
