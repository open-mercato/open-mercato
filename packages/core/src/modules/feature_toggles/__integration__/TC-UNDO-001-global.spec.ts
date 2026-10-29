import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createFeatureToggleFixture } from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { expectOperation, extractOperation, redoOk, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { changeOverrideState, readToggleDeletionStateInDb } from './featureToggleTestHelpers'
import {
  cleanupToggle,
  expectConsumedToken,
  expectToggleAbsent,
  expectVersionAdvanced,
  GLOBAL_PATH,
  overrideFields,
  readOverride,
  readToggle,
  toggleScalars,
  uniqueUndoIdentifier,
} from './undoTestHelpers'

/** Source: .ai/qa/scenarios/TC-UNDO-001-undo-redo-all-commands.md */
test.describe('TC-UNDO-001: Global feature toggle command snapshots', () => {
  test.beforeAll(skipIfUndoTestsDisabled)

  test('create undo removes the toggle and redo restores the same id and every scalar', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const payload = {
      identifier: uniqueUndoIdentifier('global_create'),
      name: 'Undo global create',
      description: 'Complete global create snapshot',
      category: 'undo-global-create',
      type: 'json',
      defaultValue: { enabled: false, limit: 0, groups: ['alpha', 'beta'] },
    }
    let toggleId: string | null = null

    try {
      const response = await apiRequest(request, 'POST', GLOBAL_PATH, { token: superadminToken, data: payload })
      expect(response.status()).toBe(201)
      toggleId = expectId((await readJsonSafe<{ id: string }>(response))?.id, 'Global create returns an id')
      const operation = expectOperation(response, 'feature_toggles.global.create')
      expect(operation.commandId).toBe('feature_toggles.global.create')
      const created = await readToggle(request, superadminToken, toggleId)
      expect(toggleScalars(created)).toEqual({ id: toggleId, ...payload })

      const logId = await undoOk(request, superadminToken, operation.undoToken, 'global create')
      await expectToggleAbsent(request, superadminToken, toggleId, payload.identifier)
      await expectConsumedToken(request, superadminToken, operation.undoToken)

      await redoOk(request, superadminToken, logId, 'global create')
      const redone = await readToggle(request, superadminToken, toggleId)
      expect(toggleScalars(redone)).toEqual(toggleScalars(created))
      expectVersionAdvanced(redone.updatedAt, created.updatedAt, 'global create redo')
    } finally {
      await cleanupToggle(request, superadminToken, adminToken, toggleId)
    }
  })

  test('update undo and redo restore every scalar and advance the version each time', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier: uniqueUndoIdentifier('global_before'),
        name: 'Before global update',
        description: 'Original description',
        category: 'undo-original',
        type: 'number',
        defaultValue: 0,
      })
      const before = await readToggle(request, superadminToken, toggleId)
      const update = {
        id: toggleId,
        identifier: uniqueUndoIdentifier('global_after'),
        name: 'After global update',
        description: 'Updated description',
        category: 'undo-updated',
        type: 'json',
        defaultValue: { enabled: false, threshold: 0, nested: { text: 'changed' }, groups: ['gamma'] },
      }
      const response = await apiRequest(request, 'PUT', GLOBAL_PATH, { token: superadminToken, data: update })
      expect(response.status()).toBe(200)
      const operation = expectOperation(response, 'feature_toggles.global.update')
      expect(operation.commandId).toBe('feature_toggles.global.update')
      const after = await readToggle(request, superadminToken, toggleId)
      expect(toggleScalars(after)).toEqual(update)
      expect(after.createdAt).toBe(before.createdAt)
      expectVersionAdvanced(after.updatedAt, before.updatedAt, 'global update')

      const logId = await undoOk(request, superadminToken, operation.undoToken, 'global update')
      const undone = await readToggle(request, superadminToken, toggleId)
      expect(toggleScalars(undone)).toEqual(toggleScalars(before))
      expect(undone.createdAt).toBe(before.createdAt)
      expectVersionAdvanced(undone.updatedAt, after.updatedAt, 'global update undo')
      await expectConsumedToken(request, superadminToken, operation.undoToken)

      await redoOk(request, superadminToken, logId, 'global update')
      const redone = await readToggle(request, superadminToken, toggleId)
      expect(toggleScalars(redone)).toEqual(toggleScalars(after))
      expect(redone.createdAt).toBe(before.createdAt)
      expectVersionAdvanced(redone.updatedAt, undone.updatedAt, 'global update redo')
    } finally {
      await cleanupToggle(request, superadminToken, adminToken, toggleId)
    }
  })

  test('delete undo and redo preserve the related override id and value', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    let toggleId: string | null = null
    let restoreToken: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier: uniqueUndoIdentifier('global_delete'),
        name: 'Global delete snapshot',
        description: 'Delete preserves this description',
        category: 'undo-global-delete',
        type: 'json',
        defaultValue: { enabled: true, tiers: ['default'] },
      })
      const before = await readToggle(request, superadminToken, toggleId)
      const overrideValue = { enabled: false, limit: 0, tiers: ['override'] }
      const setResponse = await changeOverrideState(request, adminToken, { toggleId, isOverride: true, overrideValue })
      expect(setResponse.status()).toBe(200)
      const override = await readOverride(request, adminToken, before, overrideValue, 'override')

      const response = await apiRequest(request, 'DELETE', `${GLOBAL_PATH}?id=${encodeURIComponent(toggleId)}`, { token: superadminToken })
      expect(response.status()).toBe(200)
      const operation = expectOperation(response, 'feature_toggles.global.delete')
      expect(operation.commandId).toBe('feature_toggles.global.delete')
      restoreToken = operation.undoToken
      await expectToggleAbsent(request, superadminToken, toggleId, before.identifier)
      const deletedRow = await readToggleDeletionStateInDb(toggleId)
      expect(deletedRow?.deletedAt, 'Delete retains the original row as soft-deleted').toBeInstanceOf(Date)
      const hiddenOverride = await apiRequest(request, 'GET', `${GLOBAL_PATH}/${encodeURIComponent(toggleId)}/override`, { token: adminToken })
      expect(hiddenOverride.status()).toBe(404)

      const logId = await undoOk(request, superadminToken, operation.undoToken, 'global delete')
      restoreToken = null
      const restored = await readToggle(request, superadminToken, toggleId)
      expect(await readToggleDeletionStateInDb(toggleId)).toEqual({ deletedAt: null })
      expect(toggleScalars(restored)).toEqual(toggleScalars(before))
      expect(restored.createdAt).toBe(before.createdAt)
      expectVersionAdvanced(restored.updatedAt, before.updatedAt, 'global delete undo')
      const restoredOverride = await readOverride(request, adminToken, restored, overrideValue, 'override')
      expect(overrideFields(restoredOverride)).toEqual(overrideFields(override))
      expect(restoredOverride.updatedAt).toBe(override.updatedAt)
      await expectConsumedToken(request, superadminToken, operation.undoToken)

      const redone = await redoOk(request, superadminToken, logId, 'global delete')
      restoreToken = redone.undoToken
      await expectToggleAbsent(request, superadminToken, toggleId, before.identifier)
      expect((await readToggleDeletionStateInDb(toggleId))?.deletedAt).toBeInstanceOf(Date)
      expect(restoreToken, 'Redone delete remains undoable for fixture cleanup').toBeTruthy()
      await undoOk(request, superadminToken, restoreToken as string, 'redone global delete')
      restoreToken = null
      const restoredAgain = await readToggle(request, superadminToken, toggleId)
      expect(toggleScalars(restoredAgain)).toEqual(toggleScalars(before))
      expect(overrideFields(await readOverride(request, adminToken, restoredAgain, overrideValue, 'override'))).toEqual(overrideFields(override))
    } finally {
      await cleanupToggle(request, superadminToken, adminToken, toggleId, restoreToken)
    }
  })

  test('rejected admin global writes expose no undo operation', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier: uniqueUndoIdentifier('admin_denied_fixture'),
        name: 'Protected global toggle',
        type: 'boolean',
        defaultValue: false,
      })
      const before = await readToggle(request, superadminToken, toggleId)
      const deniedWrites = [
        { method: 'POST', path: GLOBAL_PATH, data: { identifier: uniqueUndoIdentifier('admin_denied_create'), name: 'Denied create', type: 'boolean', defaultValue: true } },
        { method: 'PUT', path: GLOBAL_PATH, data: { id: toggleId, name: 'Denied update' } },
        { method: 'DELETE', path: `${GLOBAL_PATH}?id=${encodeURIComponent(toggleId)}`, data: undefined },
      ]
      for (const write of deniedWrites) {
        const response = await apiRequest(request, write.method, write.path, { token: adminToken, data: write.data })
        expect(response.status(), `${write.method} global requires superadmin`).toBe(403)
        expect(response.headers()['x-om-operation']).toBeUndefined()
        expect(extractOperation(response)).toBeNull()
      }
      expect(await readToggle(request, superadminToken, toggleId)).toEqual(before)
    } finally {
      await cleanupToggle(request, superadminToken, adminToken, toggleId)
    }
  })

  test.fixme('global create undo retains a row with deleted_at set (https://github.com/open-mercato/open-mercato/issues/7664)', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    let toggleId: string | null = null

    try {
      const response = await apiRequest(request, 'POST', GLOBAL_PATH, {
        token: superadminToken,
        data: { identifier: uniqueUndoIdentifier('create_soft_delete'), name: 'Create undo soft deletion', type: 'boolean', defaultValue: false },
      })
      expect(response.status()).toBe(201)
      toggleId = expectId((await readJsonSafe<{ id: string }>(response))?.id, 'Global create returns an id')
      const operation = expectOperation(response, 'global create physical soft deletion')
      await undoOk(request, superadminToken, operation.undoToken, 'global create physical soft deletion')
      const row = await readToggleDeletionStateInDb(toggleId)
      expect(row, 'Create undo preserves the original row as soft-deleted').not.toBeNull()
      expect(row?.deletedAt).not.toBeNull()
      expect(row?.deletedAt).toBeInstanceOf(Date)
    } finally {
      await cleanupToggle(request, superadminToken, adminToken, toggleId)
    }
  })
})
