import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createFeatureToggleFixture } from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { expectOperation, redoOk, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { changeOverrideState } from './featureToggleTestHelpers'
import {
  cleanupToggle,
  expectConsumedToken,
  expectVersionAdvanced,
  overrideFields,
  readOverride,
  readToggle,
  uniqueUndoIdentifier,
  type ToggleType,
} from './undoTestHelpers'

const TYPED_CASES: Array<{ type: ToggleType; defaultValue: unknown; initialValue: unknown; changedValue: unknown }> = [
  { type: 'boolean', defaultValue: true, initialValue: false, changedValue: true },
  { type: 'number', defaultValue: 10, initialValue: 0, changedValue: 42 },
  { type: 'string', defaultValue: 'default', initialValue: 'original override', changedValue: 'edited override' },
  {
    type: 'json',
    defaultValue: { enabled: true, tiers: ['default'] },
    initialValue: { enabled: false, limit: 0, nested: { label: 'original' }, tiers: ['alpha', 'beta'] },
    changedValue: { enabled: true, limit: 99, nested: { label: 'edited' }, tiers: ['gamma'] },
  },
]

/** Source: .ai/qa/scenarios/TC-UNDO-001-undo-redo-all-commands.md */
test.describe('TC-UNDO-001: Tenant feature toggle override snapshots', () => {
  test.beforeAll(skipIfUndoTestsDisabled)

  for (const toggleCase of TYPED_CASES) {
    test(`${toggleCase.type} override creation and clearing survive undo and redo`, async ({ request }) => {
      const superadminToken = await getAuthToken(request, 'superadmin')
      const adminToken = await getAuthToken(request, 'admin')
      let toggleId: string | null = null

      try {
        toggleId = await createFeatureToggleFixture(request, superadminToken, {
          identifier: uniqueUndoIdentifier(`override_${toggleCase.type}`),
          name: `Undo ${toggleCase.type} override`,
          description: 'Typed override command snapshots',
          category: 'undo-overrides',
          type: toggleCase.type,
          defaultValue: toggleCase.defaultValue,
        })
        const toggle = await readToggle(request, superadminToken, toggleId)
        const inherited = await readOverride(request, adminToken, toggle, toggleCase.defaultValue, 'default')

        const createResponse = await changeOverrideState(request, adminToken, { toggleId, isOverride: true, overrideValue: toggleCase.initialValue })
        expect(createResponse.status()).toBe(200)
        const createOperation = expectOperation(createResponse, `${toggleCase.type} override create`)
        expect(createOperation.commandId).toBe('feature_toggles.overrides.changeState')
        const created = await readOverride(request, adminToken, toggle, toggleCase.initialValue, 'override')
        const createLogId = await undoOk(request, adminToken, createOperation.undoToken, `${toggleCase.type} override create`)
        expect(overrideFields(await readOverride(request, adminToken, toggle, toggleCase.defaultValue, 'default'))).toEqual(overrideFields(inherited))
        await expectConsumedToken(request, adminToken, createOperation.undoToken)

        await redoOk(request, adminToken, createLogId, `${toggleCase.type} override create`)
        const recreated = await readOverride(request, adminToken, toggle, toggleCase.initialValue, 'override')
        expect(recreated.value).toEqual(created.value)
        expect(recreated).toMatchObject({
          tenantName: created.tenantName,
          tenantId: created.tenantId,
          toggleType: created.toggleType,
        })
        expectVersionAdvanced(recreated.updatedAt, created.updatedAt, `${toggleCase.type} override create redo`)

        const clearResponse = await changeOverrideState(request, adminToken, { toggleId, isOverride: false })
        expect(clearResponse.status()).toBe(200)
        const clearOperation = expectOperation(clearResponse, `${toggleCase.type} override clear`)
        expect(overrideFields(await readOverride(request, adminToken, toggle, toggleCase.defaultValue, 'default'))).toEqual(overrideFields(inherited))

        const clearLogId = await undoOk(request, adminToken, clearOperation.undoToken, `${toggleCase.type} override clear`)
        const clearUndone = await readOverride(request, adminToken, toggle, toggleCase.initialValue, 'override')
        expect(overrideFields(clearUndone)).toEqual(overrideFields(recreated))
        expectVersionAdvanced(clearUndone.updatedAt, recreated.updatedAt, `${toggleCase.type} override clear undo`)
        await expectConsumedToken(request, adminToken, clearOperation.undoToken)

        await redoOk(request, adminToken, clearLogId, `${toggleCase.type} override clear`)
        expect(overrideFields(await readOverride(request, adminToken, toggle, toggleCase.defaultValue, 'default'))).toEqual(overrideFields(inherited))
      } finally {
        await cleanupToggle(request, superadminToken, adminToken, toggleId)
      }
    })
  }

  for (const toggleCase of TYPED_CASES) {
    test(`${toggleCase.type} override value changes restore every field and advance the version`, async ({ request }) => {
      const superadminToken = await getAuthToken(request, 'superadmin')
      const adminToken = await getAuthToken(request, 'admin')
      let toggleId: string | null = null

      try {
        toggleId = await createFeatureToggleFixture(request, superadminToken, {
          identifier: uniqueUndoIdentifier(`override_change_${toggleCase.type}`),
          name: `Undo ${toggleCase.type} override change`,
          type: toggleCase.type,
          defaultValue: toggleCase.defaultValue,
        })
        const toggle = await readToggle(request, superadminToken, toggleId)
        const initialResponse = await changeOverrideState(request, adminToken, { toggleId, isOverride: true, overrideValue: toggleCase.initialValue })
        expect(initialResponse.status()).toBe(200)
        const initial = await readOverride(request, adminToken, toggle, toggleCase.initialValue, 'override')

        const changeResponse = await changeOverrideState(request, adminToken, { toggleId, isOverride: true, overrideValue: toggleCase.changedValue })
        expect(changeResponse.status()).toBe(200)
        const operation = expectOperation(changeResponse, `${toggleCase.type} override change`)
        expect(operation.commandId).toBe('feature_toggles.overrides.changeState')
        const changed = await readOverride(request, adminToken, toggle, toggleCase.changedValue, 'override')
        expect(changed.id).toBe(initial.id)
        expectVersionAdvanced(changed.updatedAt, initial.updatedAt, `${toggleCase.type} override change`)

        const logId = await undoOk(request, adminToken, operation.undoToken, `${toggleCase.type} override change`)
        const undone = await readOverride(request, adminToken, toggle, toggleCase.initialValue, 'override')
        expect(overrideFields(undone)).toEqual(overrideFields(initial))
        expectVersionAdvanced(undone.updatedAt, changed.updatedAt, `${toggleCase.type} override change undo`)
        await expectConsumedToken(request, adminToken, operation.undoToken)

        await redoOk(request, adminToken, logId, `${toggleCase.type} override change`)
        const redone = await readOverride(request, adminToken, toggle, toggleCase.changedValue, 'override')
        expect(overrideFields(redone)).toEqual(overrideFields(changed))
        expectVersionAdvanced(redone.updatedAt, undone.updatedAt, `${toggleCase.type} override change redo`)
      } finally {
        await cleanupToggle(request, superadminToken, adminToken, toggleId)
      }
    })
  }

  test.fixme('override creation redo restores the original override id (https://github.com/open-mercato/open-mercato/issues/7665)', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier: uniqueUndoIdentifier('override_same_id'),
        name: 'Override redo identity',
        type: 'boolean',
        defaultValue: true,
      })
      const toggle = await readToggle(request, superadminToken, toggleId)
      const response = await changeOverrideState(request, adminToken, { toggleId, isOverride: true, overrideValue: false })
      expect(response.status()).toBe(200)
      const operation = expectOperation(response, 'override creation same-id redo')
      const created = await readOverride(request, adminToken, toggle, false, 'override')
      const logId = await undoOk(request, adminToken, operation.undoToken, 'override creation same-id redo')
      await redoOk(request, adminToken, logId, 'override creation same-id redo')
      const redone = await readOverride(request, adminToken, toggle, false, 'override')
      expect(redone.id).toBe(created.id)
    } finally {
      await cleanupToggle(request, superadminToken, adminToken, toggleId)
    }
  })
})
