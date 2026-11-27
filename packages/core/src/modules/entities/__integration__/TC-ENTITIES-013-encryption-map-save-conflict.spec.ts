import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  CONFLICT_BANNER_TESTID,
  clickConflictRefresh,
  expectConflictBanner,
} from '@open-mercato/core/helpers/integration/optimisticLockUi'
import {
  createCustomEntity,
  deleteCustomEntityIfExists,
  saveFieldDefinitions,
  uniqueEntityId,
} from './helpers/entitiesApi'

export const integrationMeta = { dependsOnModules: ['entities'] }

const ENCRYPTION_API = '/api/entities/encryption'
const SECRET_FIELD = 'secret_note'

type EncryptionMap = { isActive?: boolean; updatedAt?: string | null }

async function readMap(request: APIRequestContext, token: string, entityId: string): Promise<EncryptionMap> {
  const response = await apiRequest(request, 'GET', `${ENCRYPTION_API}?entityId=${encodeURIComponent(entityId)}`, { token })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<EncryptionMap>(response)) ?? {}
}

async function saveMapWithoutVersion(
  request: APIRequestContext,
  token: string,
  entityId: string,
  isActive: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'POST', ENCRYPTION_API, {
    token,
    data: { entityId, fields: [{ field: SECRET_FIELD }], isActive },
  })
  expect(response.status(), 'a header-less map write must succeed').toBe(200)
}

function recordSavePosts(page: Page): number[] {
  const statuses: number[] = []
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && new URL(response.url()).pathname === ENCRYPTION_API) {
      statuses.push(response.status())
    }
  })
  return statuses
}

async function openEntityMap(page: Page, entityLabel: string): Promise<void> {
  await page.goto('/backend/config/encryption', { waitUntil: 'load' })
  const entityPicker = page.getByRole('combobox').first()
  await expect(entityPicker).toBeEnabled({ timeout: 15_000 })
  await entityPicker.click()
  await page.getByRole('option', { name: new RegExp(entityLabel) }).click()
  await expect(entityPicker).toContainText(entityLabel)
  await expect(page.getByRole('table').getByText(SECRET_FIELD)).toBeVisible({ timeout: 15_000 })
}

/**
 * TC-ENTITIES-013 — Encryption settings save must not raise a false conflict for the
 * user's own double-click, and a real 409 must show only the translated conflict bar
 * (never the raw `record_modified` code). Fixture: a throwaway custom entity with its
 * own encryption map, so no shared entity's encryption is toggled mid-suite.
 */
test.describe('TC-ENTITIES-013: encryption map save conflicts', () => {
  test('a same-tick double save sends one POST and a stale save shows only the conflict bar', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const entityId = uniqueEntityId('secret_box')
    const entityLabel = `QA Encryption ${Date.now()}`

    try {
      expect((await createCustomEntity(request, token, { entityId, label: entityLabel })).ok()).toBe(true)
      expect((await saveFieldDefinitions(request, token, entityId, [{ key: SECRET_FIELD, kind: 'text' }])).ok()).toBe(true)
      await saveMapWithoutVersion(request, token, entityId, true)

      await login(page, 'admin')
      const postStatuses = recordSavePosts(page)
      await openEntityMap(page, entityLabel)

      const activeToggle = page.getByRole('checkbox', { name: 'Encryption enabled for this entity' })
      const saveButton = page.getByRole('button', { name: 'Save encryption map' })
      await expect(activeToggle).toBeChecked()
      await activeToggle.click()
      await expect(activeToggle).not.toBeChecked()

      await saveButton.evaluate((button: HTMLButtonElement) => {
        button.click()
        button.click()
      })
      await expect.poll(() => postStatuses.length, { timeout: 10_000 }).toBeGreaterThan(0)
      await expect(saveButton).toBeEnabled({ timeout: 10_000 })
      await page.waitForTimeout(1_000)
      expect(postStatuses, 'the second click of a double save must not send a request').toEqual([200])
      await expect(page.getByTestId(CONFLICT_BANNER_TESTID)).toHaveCount(0)
      await expect(page.getByText('Encryption map saved')).toBeVisible()
      expect((await readMap(request, token, entityId)).isActive).toBe(false)

      await saveMapWithoutVersion(request, token, entityId, true)
      await activeToggle.click()
      await expect(activeToggle).toBeChecked()
      const staleSave = page.waitForResponse(
        (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === ENCRYPTION_API,
      )
      await saveButton.click()
      expect((await staleSave).status()).toBe(409)

      await expectConflictBanner(page)
      await expect(page.getByTestId(CONFLICT_BANNER_TESTID)).toContainText('This record was modified by someone else')
      await expect(page.getByText('record_modified', { exact: true })).toHaveCount(0)

      await clickConflictRefresh(page)
      await expect(page.getByTestId(CONFLICT_BANNER_TESTID)).toHaveCount(0, { timeout: 10_000 })
      await expect(page.getByRole('combobox').first()).toContainText(entityLabel)
      await expect(activeToggle).toBeChecked()
    } finally {
      await withClient((client) => client.query('delete from encryption_maps where entity_id = $1', [entityId])).catch(() => undefined)
      await deleteCustomEntityIfExists(request, token, entityId)
    }
  })
})
