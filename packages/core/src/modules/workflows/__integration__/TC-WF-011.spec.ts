import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteWorkflowDefinitionIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-011: Code-Based Workflows — Customize / Reset matrix across all 4 UI surfaces
 *
 * Verifies the customize and reset (uncustomize) flows on every UI surface
 * a user can reach a workflow definition from:
 *   - List page (badge flips both ways)
 *   - Detail "view" page (read-only Customize button on `code:` id)
 *   - Edit page (override UUID with editable form + Reset button)
 *   - Visual Editor (Save on `code:` id creates override; Save on UUID updates)
 *
 * Each save path is asserted via the network response status (not just the
 * toast) so a 500 from the server fails the test loudly. This guards the
 * persistAndFlush regression class that surfaced after the MikroORM v7
 * migration on `PUT /api/workflows/definitions/code:...`.
 */

const CODE_WORKFLOW_ID = 'sales.order-approval'
const CODE_WORKFLOW_API_ID = `code:${CODE_WORKFLOW_ID}`

type DetailResponse = {
  data?: { id?: string; workflowId?: string; description?: string | null; source?: string }
}
type ListResponse = {
  data?: Array<{ id: string; workflowId: string; source?: string }>
}

async function findOverrideIdByWorkflowId(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  workflowId: string,
): Promise<string | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/workflows/definitions?workflowId=${encodeURIComponent(workflowId)}`,
    { token },
  )
  const body = await readJsonSafe<ListResponse>(response)
  const row = body?.data?.find((d) => d.workflowId === workflowId && d.source === 'code_override')
  return row?.id ?? null
}

async function customizeViaApi(
  request: Parameters<typeof apiRequest>[0],
  token: string,
): Promise<string> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/workflows/definitions/${encodeURIComponent(CODE_WORKFLOW_API_ID)}/customize`,
    { token },
  )
  expect(response.status(), 'API customize should succeed').toBe(200)
  const body = await readJsonSafe<DetailResponse>(response)
  const id = body?.data?.id
  expect(id, 'customize response should include override id').toBeTruthy()
  return id as string
}

async function ensureCleanState(
  request: Parameters<typeof apiRequest>[0],
  token: string,
): Promise<void> {
  const stale = await findOverrideIdByWorkflowId(request, token, CODE_WORKFLOW_ID)
  if (stale) await deleteWorkflowDefinitionIfExists(request, token, stale)
}

test.describe('TC-WF-011: Code workflows — Customize / Reset matrix', () => {
  test.describe.configure({ timeout: 90_000 })

  test('list view — badge flips Code-defined → Customized → Code-defined', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')

    try {
      await login(page, 'admin')
      await ensureCleanState(request, apiToken)

      // Initial: Code-defined badge present, no Customized for this workflow.
      await page.goto('/backend/definitions')
      const codeRow = page
        .getByRole('row')
        .filter({ hasText: 'Sales Order Approval' })
        .filter({ hasText: 'Code-defined' })
      await expect(codeRow).toHaveCount(1)
      await expect(
        page.getByRole('row').filter({ hasText: 'Sales Order Approval' }).filter({ hasText: 'Customized' }),
      ).toHaveCount(0)

      // Customize via API → list shows Customized badge.
      const overrideId = await customizeViaApi(request, apiToken)
      await page.goto('/backend/definitions')
      await expect(
        page.getByRole('row').filter({ hasText: 'Sales Order Approval' }).filter({ hasText: 'Customized' }),
      ).toHaveCount(1)
      await expect(
        page
          .getByRole('row')
          .filter({ hasText: 'sales.order-approval' })
          .filter({ hasText: 'Code-defined' }),
      ).toHaveCount(0)

      // Reset (uncustomize) via API → badge flips back.
      await deleteWorkflowDefinitionIfExists(request, apiToken, overrideId)
      await page.goto('/backend/definitions')
      await expect(
        page.getByRole('row').filter({ hasText: 'Sales Order Approval' }).filter({ hasText: 'Code-defined' }),
      ).toHaveCount(1)
      await expect(
        page.getByRole('row').filter({ hasText: 'Sales Order Approval' }).filter({ hasText: 'Customized' }),
      ).toHaveCount(0)
    } finally {
      await ensureCleanState(request, apiToken)
    }
  })

  test('detail view — Customize button on `code:` id creates override and lands on UUID', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    let overrideId: string | null = null

    try {
      await login(page, 'admin')
      await ensureCleanState(request, apiToken)

      await page.goto(`/backend/definitions/${encodeURIComponent(CODE_WORKFLOW_API_ID)}`)
      await expect(
        page.getByText('This workflow is defined in code. Customize it to make changes.'),
      ).toBeVisible()
      const customizeButton = page.getByRole('button', { name: 'Customize', exact: true })
      await expect(customizeButton).toBeVisible()

      const [customizeResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/api/workflows/definitions/${encodeURIComponent(CODE_WORKFLOW_API_ID)}/customize`) &&
            res.request().method() === 'POST',
          { timeout: 30_000 },
        ),
        customizeButton.click(),
      ])
      expect(customizeResponse.status(), 'POST /customize should succeed').toBe(200)

      await page.waitForURL(/\/backend\/definitions\/[0-9a-f-]{36}(?:\?.*)?$/i, { timeout: 30_000 })
      overrideId = page.url().match(/\/backend\/definitions\/([0-9a-f-]{36})/i)?.[1] ?? null
      expect(overrideId).toBeTruthy()

      await expect(
        page.getByText('This workflow has been customized from its code-defined version.'),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reset to code version', exact: true })).toBeVisible()
    } finally {
      if (overrideId) await deleteWorkflowDefinitionIfExists(request, apiToken, overrideId)
      await ensureCleanState(request, apiToken)
    }
  })

  test('edit view — modify description persists, Reset to code returns to `code:`', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    let overrideId: string | null = null

    try {
      await login(page, 'admin')
      await ensureCleanState(request, apiToken)

      overrideId = await customizeViaApi(request, apiToken)

      await page.goto(`/backend/definitions/${encodeURIComponent(overrideId)}`)
      await expect(
        page.getByText('This workflow has been customized from its code-defined version.'),
      ).toBeVisible()

      // Edit description through the CrudForm (full payload PUT on UUID).
      const newDescription = `QA WF-011 edit ${Date.now()}`
      const descriptionField = page
        .getByPlaceholder('Optional: Describe the purpose of this workflow')
        .first()
      await expect(descriptionField).toBeEditable()
      await descriptionField.fill(newDescription)

      const updateButton = page
        .locator('button[type="submit"]', { hasText: 'Update Workflow' })
        .first()
      await expect(updateButton).toBeVisible()
      const [putResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/api/workflows/definitions/${overrideId}`) &&
            res.request().method() === 'PUT',
          { timeout: 30_000 },
        ),
        updateButton.click(),
      ])
      expect(putResponse.status(), 'PUT on UUID override should succeed').toBe(200)

      const after = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(overrideId)}`,
        { token: apiToken },
      )
      const afterBody = await readJsonSafe<DetailResponse>(after)
      expect(afterBody?.data?.description).toBe(newDescription)

      // Reset (uncustomize) from the edit page → confirm dialog → URL flips back to `code:`.
      await page.goto(`/backend/definitions/${encodeURIComponent(overrideId)}`)
      const resetButton = page.getByRole('button', { name: 'Reset to code version', exact: true })
      await expect(resetButton).toBeVisible()
      await resetButton.click()

      const confirmDialog = page.getByRole('alertdialog')
      await expect(confirmDialog).toBeVisible()
      await Promise.all([
        page.waitForURL(/\/backend\/definitions\/code(?::|%3A)/i, { timeout: 30_000 }),
        confirmDialog.getByRole('button', { name: 'Reset to code version' }).click(),
      ])
      await expect(
        page.getByText('This workflow is defined in code. Customize it to make changes.'),
      ).toBeVisible()

      // Override is gone — skip cleanup.
      overrideId = null
    } finally {
      if (overrideId) await deleteWorkflowDefinitionIfExists(request, apiToken, overrideId)
      await ensureCleanState(request, apiToken)
    }
  })

  test('visual editor — code workflow is read-only with Customize action', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    let overrideId: string | null = null

    try {
      await login(page, 'admin')
      await ensureCleanState(request, apiToken)

      await page.goto(
        `/backend/definitions/visual-editor?id=${encodeURIComponent(CODE_WORKFLOW_API_ID)}`,
      )

      const workflowIdInput = page.locator('#workflowId')
      await expect(workflowIdInput).toHaveValue(CODE_WORKFLOW_ID, { timeout: 30_000 })

      // Source banner is shown and Save/Update is replaced by Customize.
      await expect(
        page.getByText('This workflow is defined in code. Customize it to make changes.'),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: /^(Update|Save)$/ })).toHaveCount(0)
      const customizeButton = page.getByRole('button', { name: 'Customize', exact: true })
      await expect(customizeButton).toBeVisible()

      // Metadata fields are disabled (the form is wrapped in a `<fieldset disabled>`).
      await expect(page.locator('#workflowName')).toBeDisabled()
      await expect(page.locator('#description')).toBeDisabled()

      // Step palette is hidden in read-only mode (no way to add nodes).
      await expect(page.getByRole('heading', { name: 'Step Palette' })).toHaveCount(0)

      // Clicking a node MUST NOT open the node edit dialog.
      const firstNode = page.locator('.react-flow__node').first()
      await expect(firstNode).toBeVisible({ timeout: 10_000 })
      await firstNode.click()
      // The node edit dialog (NodeEditDialog/CrudForm) renders as a modal
      // dialog. In read-only mode it must not appear.
      await expect(page.getByRole('dialog')).toHaveCount(0)

      // Click Customize → POST /customize → redirect back to the visual editor
      // pointed at the new override UUID.
      const [customizeResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/api/workflows/definitions/${CODE_WORKFLOW_API_ID}/customize`) &&
            res.request().method() === 'POST',
          { timeout: 30_000 },
        ),
        customizeButton.click(),
      ])
      expect(customizeResponse.status(), 'POST /customize should succeed').toBe(200)

      await page.waitForURL(
        /\/backend\/definitions\/visual-editor\?id=[0-9a-f-]{36}/i,
        { timeout: 30_000 },
      )
      overrideId = page.url().match(/id=([0-9a-f-]{36})/i)?.[1] ?? null
      expect(overrideId, 'should land on visual editor URL with override UUID').toBeTruthy()

      // Now editable: Save/Update is back, fields are enabled, banner is the
      // "customized" variant with a Reset button.
      await expect(page.locator('#workflowName')).toBeEnabled({ timeout: 15_000 })
      await expect(page.getByRole('button', { name: /^(Update|Save)$/ })).toBeVisible()
      await expect(
        page.getByText('This workflow has been customized from its code-defined version.'),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reset to code version', exact: true })).toBeVisible()

      const detail = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(overrideId!)}`,
        { token: apiToken },
      )
      const detailBody = await readJsonSafe<DetailResponse>(detail)
      expect(detailBody?.data?.source).toBe('code_override')
      expect(detailBody?.data?.workflowId).toBe(CODE_WORKFLOW_ID)
    } finally {
      if (overrideId) await deleteWorkflowDefinitionIfExists(request, apiToken, overrideId)
      await ensureCleanState(request, apiToken)
    }
  })

  test('visual editor — Save on existing override UUID updates in place', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    let overrideId: string | null = null

    try {
      await login(page, 'admin')
      await ensureCleanState(request, apiToken)

      overrideId = await customizeViaApi(request, apiToken)

      await page.goto(`/backend/definitions/visual-editor?id=${encodeURIComponent(overrideId)}`)

      const workflowIdInput = page.locator('#workflowId')
      await expect(workflowIdInput).toHaveValue(CODE_WORKFLOW_ID, { timeout: 30_000 })

      // Edit a metadata field — the visual editor's PUT used to send only
      // `{definition, enabled}`, silently dropping every other change. Asserting
      // the description round-trips guards that regression.
      const newDescription = `QA WF-011 visual edit ${Date.now()}`
      const descriptionField = page.locator('#description')
      await expect(descriptionField).toBeEditable()
      await descriptionField.fill(newDescription)

      const saveButton = page.getByRole('button', { name: /^(Update|Save)$/ })
      await expect(saveButton).toBeVisible({ timeout: 30_000 })

      const [putResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/api/workflows/definitions/${overrideId}`) &&
            res.request().method() === 'PUT',
          { timeout: 30_000 },
        ),
        saveButton.click(),
      ])
      expect(putResponse.status(), 'PUT on UUID override should succeed').toBe(200)
      await expect(page.getByText('Workflow updated successfully!').first()).toBeVisible({ timeout: 10_000 })

      const detail = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(overrideId)}`,
        { token: apiToken },
      )
      const detailBody = await readJsonSafe<DetailResponse>(detail)
      expect(detailBody?.data?.source).toBe('code_override')
      expect(detailBody?.data?.description, 'visual editor metadata edit must persist').toBe(newDescription)
    } finally {
      if (overrideId) await deleteWorkflowDefinitionIfExists(request, apiToken, overrideId)
      await ensureCleanState(request, apiToken)
    }
  })
})
