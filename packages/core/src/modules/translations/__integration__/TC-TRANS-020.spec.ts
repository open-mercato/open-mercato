import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoByToken, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

type Translations = Record<string, Record<string, string | null>>

const ENTITY_TYPE = 'catalog:catalog_product'
const CONFLICT_CODE = 'translations.errors.undoConflict'
const CONFLICT_MESSAGE = 'These translations changed after the action you are undoing. Undo was refused.'
const CONFLICT_MESSAGE_PL = 'Te tłumaczenia zmieniły się po akcji, którą próbujesz cofnąć. Cofnięcie zostało odrzucone.'
const SECOND_PASSWORD = 'Valid1!Pass'

function translationPath(productId: string): string {
  return `/api/translations/${ENTITY_TYPE}/${productId}`
}

async function saveTranslations(
  request: APIRequestContext,
  token: string,
  productId: string,
  translations: Translations,
) {
  const response = await apiRequest(request, 'PUT', translationPath(productId), { token, data: translations })
  expect(response.status(), 'translation save should succeed').toBe(200)
  return expectOperation(response, `save translations for ${productId}`)
}

async function readTranslations(request: APIRequestContext, token: string, productId: string): Promise<Translations | null> {
  const response = await apiRequest(request, 'GET', translationPath(productId), { token })
  if (response.status() === 404) return null
  expect(response.status(), 'translation read should succeed').toBe(200)
  const body = await readJsonSafe<{ translations?: Translations }>(response)
  return body?.translations ?? null
}

async function expectUndoConflict(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const response = await undoByToken(request, token, undoToken)
  const body = await readJsonSafe<{ error?: string; code?: string }>(response)
  expect(response.status(), `stale undo should be refused, got ${JSON.stringify(body)}`).toBe(409)
  expect(body?.code).toBe(CONFLICT_CODE)
}

async function expectLocalizedUndoConflict(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
    token,
    data: { undoToken },
    headers: { 'Accept-Language': 'pl' },
  })
  const body = await readJsonSafe<{ error?: string; code?: string }>(response)
  expect(response.status(), `stale undo should be refused, got ${JSON.stringify(body)}`).toBe(409)
  expect(body?.code).toBe(CONFLICT_CODE)
  expect(body?.error, 'the refusal is localized').toBe(CONFLICT_MESSAGE_PL)
}

async function createSecondOperator(
  request: APIRequestContext,
  adminToken: string,
  label: string,
): Promise<{ userId: string; token: string }> {
  const email = `tc-trans-020-${label}-${Date.now()}@example.com`
  const userId = await createUserFixture(request, adminToken, {
    email,
    password: SECOND_PASSWORD,
    organizationId: getTokenScope(adminToken).organizationId,
    roles: ['admin'],
  })
  return { userId, token: await getAuthToken(request, email, SECOND_PASSWORD) }
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function selectTranslationRecord(page: Page, recordId: string): Promise<void> {
  const entityInput = page.getByPlaceholder('Select an entity')
  await expect(entityInput).toBeEnabled({ timeout: 10_000 })
  await entityInput.click()
  await page.getByRole('option', { name: new RegExp(`\\b${escapeForRegex(ENTITY_TYPE)}$`) }).click()
  const recordInput = page.getByPlaceholder('Search records...')
  await expect(recordInput).toBeEnabled({ timeout: 10_000 })
  await recordInput.fill(recordId)
  await recordInput.press('Enter')
}

async function firstTranslationField(root: Locator): Promise<Locator> {
  const fields = root.locator('table').locator('input, textarea')
  await expect.poll(async () => fields.count(), { timeout: 45_000 }).toBeGreaterThan(0)
  const field = fields.first()
  await expect(field).toBeEnabled()
  return field
}

/**
 * TC-TRANS-020: translation undo never discards a later edit by another operator.
 *
 * The undo route only offers each actor their own latest action, so operator A can still undo
 * an older translation save or delete after operator B changed the same record. That undo must
 * be refused with a translated 409 and keep B's translations; once B's change is undone, A's
 * token works again.
 */
test.describe('TC-TRANS-020: translation undo keeps later edits by another operator', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('refuses to undo a save that another operator saved over', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    let secondUserId: string | null = null
    try {
      productId = await createProductFixture(request, adminToken, { title: `QA TC-TRANS-020-1 ${stamp}`, sku: `QA-TRANS-020-1-${stamp}` })
      const second = await createSecondOperator(request, adminToken, 'save')
      secondUserId = second.userId

      await saveTranslations(request, adminToken, productId, { en: { title: 'Shoe' } })
      const firstUpdate = await saveTranslations(request, adminToken, productId, { en: { title: 'Sneaker' } })
      const secondSave = await saveTranslations(request, second.token, productId, {
        en: { title: 'Sneaker' },
        fr: { title: 'Baskets' },
      })

      await expectUndoConflict(request, adminToken, firstUpdate.undoToken)
      await expectLocalizedUndoConflict(request, adminToken, firstUpdate.undoToken)
      expect(await readTranslations(request, adminToken, productId)).toEqual({
        en: { title: 'Sneaker' },
        fr: { title: 'Baskets' },
      })

      await undoOk(request, second.token, secondSave.undoToken, 'second operator save')
      await undoOk(request, adminToken, firstUpdate.undoToken, 'first operator update after the newer save was undone')
      expect(await readTranslations(request, adminToken, productId)).toEqual({ en: { title: 'Shoe' } })
    } finally {
      await deleteTranslationIfExists(request, adminToken, ENTITY_TYPE, productId)
      await deleteUserIfExists(request, adminToken, secondUserId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('refuses to undo a delete after another operator saved new translations', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    let secondUserId: string | null = null
    try {
      productId = await createProductFixture(request, adminToken, { title: `QA TC-TRANS-020-2 ${stamp}`, sku: `QA-TRANS-020-2-${stamp}` })
      const second = await createSecondOperator(request, adminToken, 'delete')
      secondUserId = second.userId

      await saveTranslations(request, adminToken, productId, { en: { title: 'Shoe' } })
      const deleteResponse = await apiRequest(request, 'DELETE', translationPath(productId), { token: adminToken })
      expect(deleteResponse.status(), 'translation delete should succeed').toBe(204)
      const deleteOperation = expectOperation(deleteResponse, `delete translations for ${productId}`)
      const secondSave = await saveTranslations(request, second.token, productId, { de: { title: 'Schuh' } })

      await expectUndoConflict(request, adminToken, deleteOperation.undoToken)
      expect(await readTranslations(request, adminToken, productId)).toEqual({ de: { title: 'Schuh' } })

      await undoOk(request, second.token, secondSave.undoToken, 'second operator save')
      await undoOk(request, adminToken, deleteOperation.undoToken, 'first operator delete after the newer save was undone')
      expect(await readTranslations(request, adminToken, productId)).toEqual({ en: { title: 'Shoe' } })
    } finally {
      await deleteTranslationIfExists(request, adminToken, ENTITY_TYPE, productId)
      await deleteUserIfExists(request, adminToken, secondUserId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('shows the conflict when the undo banner would discard another operator edit', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const originalLocales = await getLocales(request, adminToken)
    const stamp = Date.now()
    let productId: string | null = null
    let secondUserId: string | null = null
    try {
      await setLocales(request, adminToken, [...new Set([...originalLocales, 'de'])])
      productId = await createProductFixture(request, adminToken, { title: `QA TC-TRANS-020-3 ${stamp}`, sku: `QA-TRANS-020-3-${stamp}` })
      const second = await createSecondOperator(request, adminToken, 'ui')
      secondUserId = second.userId

      await login(page, 'admin')
      await page.goto('/backend/config/translations')
      await selectTranslationRecord(page, productId)
      const managerCard = page.locator('.bg-card').filter({
        has: page.getByRole('button', { name: 'Save translations' }),
      })
      await managerCard.getByRole('tab', { name: 'DE' }).click()
      const field = await firstTranslationField(managerCard)
      await field.click()
      await page.keyboard.type('Deutscher Titel QA')
      await expect.poll(async () => field.inputValue()).toBe('Deutscher Titel QA')

      const encodedPath = `/api/translations/${encodeURIComponent(ENTITY_TYPE)}/${productId}`
      const saveResponse = page.waitForResponse((response) =>
        response.request().method() === 'PUT' && response.url().includes(encodedPath),
      )
      await page.getByRole('button', { name: 'Save translations' }).click()
      expect((await saveResponse).ok()).toBeTruthy()
      await expect(page.getByText('Translations saved').first()).toBeVisible()

      const saved = await readTranslations(request, adminToken, productId)
      expect(saved).toBeTruthy()
      const newer = { ...(saved as Translations), fr: { title: 'Titre QA' } }
      await saveTranslations(request, second.token, productId, newer)

      const undoButton = page.getByRole('button', { name: /^Undo(?: last action)?$/ })
      await expect(undoButton).toBeVisible()
      await undoButton.click()

      await expect(page.getByText(CONFLICT_MESSAGE).first()).toBeVisible()
      expect(await readTranslations(request, adminToken, productId)).toEqual(newer)
    } finally {
      await deleteTranslationIfExists(request, adminToken, ENTITY_TYPE, productId)
      await deleteUserIfExists(request, adminToken, secondUserId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })
})
