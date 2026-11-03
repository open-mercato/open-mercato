import { expect, test, type Page } from '@playwright/test'
import { openWorkflowDetailsDrawer } from '@open-mercato/core/helpers/integration/workflowsUi'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildMinimalDefinitionPayload,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-038: silent-save regression guard — the #4232 killer test.
 *
 * Spec 2026-07-26-workflows-ux-redesign.md section 4.7 kills #4232
 * structurally, and the Integration Coverage list names this path first:
 * "failed save ⇒ Problems entries + banner + dirty state retained". The success
 * metric is a silent-failure rate of **0**.
 *
 * Both failure modes are covered, because they fail differently:
 *   1. the editor refuses the save itself (validation errors) — the Problems
 *      panel opens with a row per issue, an error message names the count, and
 *      no request is sent at all;
 *   2. the server refuses the save — the server's own diagnostic is surfaced
 *      verbatim rather than swallowed.
 *
 * In both cases the author's edit must still be on screen afterwards, and the
 * stored definition must be unchanged. An edit that disappears without a
 * message is the exact defect this guards.
 *
 * Self-contained: the definition is created via the API in setup and deleted in
 * `finally`; nothing relies on seeded or demo data.
 */

type DefinitionRecord = { description?: string | null; definition?: { steps?: Array<{ stepId?: string }> } }

async function openStudio(page: Page, definitionId: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/backend/definitions/visual-editor?id=${encodeURIComponent(definitionId)}`, {
    waitUntil: 'domcontentloaded',
  })
  await expect(page.locator('.react-flow__node[data-id="start"]')).toBeVisible({ timeout: 30_000 })
}

async function addDisconnectedStep(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  const search = page.getByPlaceholder('Search commands…')
  await expect(search).toBeVisible({ timeout: 15_000 })
  await search.fill('Add step: AUTOMATED')
  await expect(page.getByRole('option', { name: 'Add step: AUTOMATED', exact: true })).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Enter')
  await expect(page.locator('.react-flow__node[data-id^="automated_"]')).toHaveCount(1, { timeout: 15_000 })
}

test.describe('TC-WF-038: a failed save is never silent (#4232)', () => {
  test.describe.configure({ timeout: 120_000 })

  test('validation errors open Problems, block the request, and keep the edit', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    const payload = buildMinimalDefinitionPayload(Date.now(), '-silentsave')
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, apiToken, { ...payload, enabled: false })
      await login(page, 'admin')
      await openStudio(page, definitionId)

      // A step with no routes is a hard graph error, so the editor must refuse
      // the save — loudly.
      await addDisconnectedStep(page)

      let explicitSaveRequests = 0
      await page.route(`**/api/workflows/definitions/${definitionId}`, async (route) => {
        if (route.request().method() === 'PUT') explicitSaveRequests += 1
        await route.continue()
      })

      await page.getByRole('button', { name: 'Update', exact: true }).click()

      // 1. The error is stated, with a count — not a generic failure.
      await expect(page.getByText(/Cannot save: \d+ validation error\(s\) found/).first()).toBeVisible({
        timeout: 15_000,
      })

      // 2. The Problems panel is opened and expanded, with a row per issue.
      const problemsToggle = page.getByRole('button', { name: /^Problems/ })
      await expect(problemsToggle).toBeVisible({ timeout: 15_000 })
      await expect(problemsToggle).toHaveAttribute('aria-expanded', 'true')
      await expect(problemsToggle).toContainText('error(s)')
      await expect(page.getByRole('button', { name: /is disconnected/ })).toBeVisible()

      // 3. The edit is still on the canvas — nothing was reset or discarded.
      await expect(page.locator('.react-flow__node[data-id^="automated_"]')).toHaveCount(1)

      // 4. Nothing was persisted, and the refusal happened before the network.
      expect(explicitSaveRequests, 'a blocked save must not reach the API').toBe(0)
      const detail = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token: apiToken },
      )
      const body = await readJsonSafe<{ data?: DefinitionRecord }>(detail)
      expect(
        (body?.data?.definition?.steps ?? []).map((step) => step.stepId),
        'the stored definition is untouched by a blocked save',
      ).toEqual(['start', 'end'])
    } finally {
      await deleteWorkflowDefinitionIfExists(request, apiToken, definitionId)
    }
  })

  test('a server-rejected save surfaces the server diagnostic and keeps the edit', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    const payload = buildMinimalDefinitionPayload(Date.now() + 1, '-serverreject')
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, apiToken, { ...payload, enabled: false })
      await login(page, 'admin')
      await openStudio(page, definitionId)

      // Force the failure the editor cannot cause on its own: a server refusal
      // carrying the structured `{ error, details }` body the API contract
      // defines. Without the interception this branch is unreachable from a
      // valid definition, and it is the branch that used to swallow errors.
      await page.route(`**/api/workflows/definitions/${definitionId}`, async (route) => {
        if (route.request().method() !== 'PUT') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Validation failed',
            details: [{ path: ['definition', 'steps'], code: 'custom', message: 'server refused this definition' }],
          }),
        })
      })

      // Definition metadata lives in the details Drawer, which starts closed.
      const editedDescription = `QA WF-038 edit ${Date.now()}`
      const drawer = await openWorkflowDetailsDrawer(page)
      const descriptionField = drawer.locator('#description')
      await expect(descriptionField).toBeEditable()
      await descriptionField.fill(editedDescription)

      // Scoped to the drawer: with it open, the header Update and the drawer
      // footer Update share an accessible name.
      await drawer.getByRole('button', { name: 'Update', exact: true }).click()

      // The server's own diagnostic reaches the author, path included.
      await expect(page.getByText('definition.steps - server refused this definition').first()).toBeVisible({
        timeout: 15_000,
      })

      // The edit survives the failure — retrying is possible without retyping.
      await expect(descriptionField).toHaveValue(editedDescription)
      await expect(drawer.getByRole('button', { name: 'Update', exact: true })).toBeEnabled()

      const detail = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token: apiToken },
      )
      const body = await readJsonSafe<{ data?: DefinitionRecord }>(detail)
      expect(body?.data?.description, 'a refused save persists nothing').toBe(payload.description)
    } finally {
      await deleteWorkflowDefinitionIfExists(request, apiToken, definitionId)
    }
  })
})
