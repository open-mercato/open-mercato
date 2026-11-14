import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createPlaybookOrFail,
  createRule,
  deletePlaybookIfExists,
  listRules,
  OPTIMISTIC_LOCK_HEADER,
  RULES_PATH,
  uniqueCode,
} from './helpers/reviewPlaybookFixtures'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

test.describe('TC-DOC-PLAY-004: review playbook admin rules table', () => {
  test('edits a rule inline and surfaces an optimistic lock conflict', async ({ page, request }) => {
    test.slow()
    let adminToken: string | null = null
    let playbookId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const name = `TC-DOC-PLAY-004 ${Date.now()}`
      playbookId = await createPlaybookOrFail(request, adminToken, { code: uniqueCode('nda'), name })
      const created = await createRule(request, adminToken, playbookId, {
        code: 'NDA-3.1',
        title: 'Confidentiality term',
        position: 'Confidentiality lasts at most two years.',
        severity: 'blocking',
      })
      expect(created.response.status()).toBe(201)

      await login(page, 'admin')
      await page.goto('/backend/documents/review-playbooks')
      await page.getByRole('link', { name }).click()
      await expect(page).toHaveURL(new RegExp(`/backend/documents/review-playbooks/${playbookId}`))
      const rules = page.getByTestId('documents-review-rules')
      await expect(rules.getByTestId('documents-review-rule-NDA-3.1')).toContainText('Confidentiality term')

      await rules.getByRole('button', { name: 'Edit rule NDA-3.1' }).click()
      const editor = rules.getByTestId('documents-review-rule-editor')
      await expect(editor).toBeVisible()
      const titleInput = editor.getByLabel('Title')
      await titleInput.fill('Confidentiality period')
      const saveResponse = page.waitForResponse((response) => (
        response.request().method() === 'PUT' && new URL(response.url()).pathname === RULES_PATH
      ))
      await titleInput.press('ControlOrMeta+Enter')
      expect((await saveResponse).status(), 'inline rule save should return 200').toBe(200)
      await expect(rules.getByTestId('documents-review-rule-NDA-3.1')).toContainText('Confidentiality period')
      await expect(page.getByTestId('documents-review-playbook-version')).toContainText('3')

      const [current] = await listRules(request, adminToken, playbookId)
      await rules.getByRole('button', { name: 'Edit rule NDA-3.1' }).click()
      await expect(editor).toBeVisible()
      const concurrent = await apiRequest(request, 'PUT', RULES_PATH, {
        token: adminToken,
        data: { id: current?.id, title: 'Changed in another tab' },
        headers: { [OPTIMISTIC_LOCK_HEADER]: current?.updatedAt ?? '' },
      })
      expect(concurrent.status(), 'concurrent API update should succeed').toBe(200)

      await editor.getByLabel('Title').fill('Stale edit')
      const staleResponse = page.waitForResponse((response) => (
        response.request().method() === 'PUT' && new URL(response.url()).pathname === RULES_PATH
      ))
      await editor.getByTestId('documents-review-rule-save').click()
      expect((await staleResponse).status(), 'stale inline save should conflict').toBe(409)
      await expect(page.getByTestId('record-conflict-banner')).toBeVisible()
      const [afterConflict] = await listRules(request, adminToken, playbookId)
      expect(afterConflict?.title).toBe('Changed in another tab')

      await editor.getByLabel('Title').press('Escape')
      await expect(editor).toHaveCount(0)
    } finally {
      await deletePlaybookIfExists(request, adminToken, playbookId)
    }
  })
})
