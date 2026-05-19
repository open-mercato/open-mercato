import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteWorkflowDefinitionIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-010: Code-Based Workflow Definitions — UI Customize / Reset-to-code
 *
 * Browser smoke test of the customize and reset-to-code flows through the
 * admin UI. Complements the API-level coverage in TC-WF-009 and guards
 * against regressions in the page.tsx wiring (e.g. the Customize button
 * reused PUT with the full form payload and was silently broken).
 */

const CODE_WORKFLOW_ID = 'sales.order-approval'
const CODE_WORKFLOW_API_ID = `code:${CODE_WORKFLOW_ID}`

type DetailResponse = {
  data?: { id?: string; workflowId?: string; workflowName?: string; description?: string | null; source?: string }
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

test.describe('TC-WF-010: Code-Based Workflow Definitions — UI', () => {
  test('admin can Customize a code workflow and Reset it back to code from the UI', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    let overrideId: string | null = null

    try {
      await login(page, 'admin')

      // Pre-clean: make sure no override from a previous failed run exists.
      const stale = await findOverrideIdByWorkflowId(request, apiToken, CODE_WORKFLOW_ID)
      if (stale) await deleteWorkflowDefinitionIfExists(request, apiToken, stale)

      // Step 1: open the code-defined workflow detail directly.
      await page.goto(`/backend/definitions/${encodeURIComponent(CODE_WORKFLOW_API_ID)}`)
      await expect(
        page.getByText('This workflow is defined in code. Customize it to make changes.'),
      ).toBeVisible()
      const customizeButton = page.getByRole('button', { name: 'Customize', exact: true })
      await expect(customizeButton).toBeVisible()

      // Step 2: click Customize — should create a DB override and redirect to it.
      await Promise.all([
        page.waitForURL(/\/backend\/definitions\/[0-9a-f-]{36}(?:\?.*)?$/i, { timeout: 15_000 }),
        customizeButton.click(),
      ])

      const urlMatch = page.url().match(/\/backend\/definitions\/([0-9a-f-]{36})/i)
      overrideId = urlMatch?.[1] ?? null
      expect(overrideId, 'Customize should redirect to a UUID detail URL').toBeTruthy()

      // Step 3: verify banner flipped to the customized variant + Reset button appears.
      await expect(
        page.getByText('This workflow has been customized from its code-defined version.'),
      ).toBeVisible()
      const resetButton = page.getByRole('button', { name: 'Reset to code version', exact: true })
      await expect(resetButton).toBeVisible()

      // Step 4: verify the API agrees the row is now a code_override.
      const detail = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(overrideId!)}`,
        { token: apiToken },
      )
      expect(detail.status()).toBe(200)
      const detailBody = await readJsonSafe<DetailResponse>(detail)
      expect(detailBody?.data?.source).toBe('code_override')

      // Step 5: click Reset to code version → confirm dialog → redirect back to code: id.
      await resetButton.click()
      const confirmDialog = page.getByRole('alertdialog')
      await expect(confirmDialog).toBeVisible()
      await Promise.all([
        page.waitForURL(/\/backend\/definitions\/code(?::|%3A)/i, { timeout: 15_000 }),
        confirmDialog.getByRole('button', { name: 'Reset to code version' }).click(),
      ])

      // Step 6: banner should be back to code-defined, Customize is available again.
      await expect(
        page.getByText('This workflow is defined in code. Customize it to make changes.'),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Customize', exact: true })).toBeVisible()

      // Override is gone — no cleanup needed.
      overrideId = null
    } finally {
      if (overrideId) {
        await deleteWorkflowDefinitionIfExists(request, apiToken, overrideId)
      }
    }
  })

  test('list page source badge flips from Code-defined to Customized', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    let overrideId: string | null = null

    try {
      await login(page, 'admin')

      const stale = await findOverrideIdByWorkflowId(request, apiToken, CODE_WORKFLOW_ID)
      if (stale) await deleteWorkflowDefinitionIfExists(request, apiToken, stale)

      // Step 1: list page shows the row with the "Code-defined" badge.
      // sales.order-approval is the only purely code-defined workflow in the
      // current seed set (other code workflows are shadowed by JSON seed rows).
      await page.goto('/backend/definitions')
      const codeRow = page
        .getByRole('row')
        .filter({ hasText: 'Sales Order Approval' })
        .filter({ hasText: 'Code-defined' })
      await expect(codeRow).toHaveCount(1)
      await expect(codeRow.getByText('Customized', { exact: true })).toHaveCount(0)

      // Step 2: customize via API (this flow is exercised through the UI in the first test).
      const customizeResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/definitions/${encodeURIComponent(CODE_WORKFLOW_API_ID)}/customize`,
        { token: apiToken },
      )
      expect(customizeResponse.status()).toBe(200)
      const customizeBody = await readJsonSafe<DetailResponse>(customizeResponse)
      overrideId = customizeBody?.data?.id ?? null
      expect(overrideId).toBeTruthy()

      // Step 3: reload list and verify the badge flipped.
      await page.goto('/backend/definitions')
      const customizedRow = page
        .getByRole('row')
        .filter({ hasText: 'Sales Order Approval' })
        .filter({ hasText: 'Customized' })
      await expect(customizedRow).toHaveCount(1)
      // No row for this workflow should show Code-defined anymore
      // (the code entry is replaced by the DB override in the merged list).
      await expect(
        page
          .getByRole('row')
          .filter({ hasText: 'sales.order-approval' })
          .filter({ hasText: 'Code-defined' }),
      ).toHaveCount(0)
    } finally {
      await deleteWorkflowDefinitionIfExists(request, apiToken, overrideId)
    }
  })

  test('admin can edit a customized workflow and the change persists', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    let overrideId: string | null = null

    try {
      await login(page, 'admin')

      const stale = await findOverrideIdByWorkflowId(request, apiToken, CODE_WORKFLOW_ID)
      if (stale) await deleteWorkflowDefinitionIfExists(request, apiToken, stale)

      // Customize via API to skip the flow covered by the first test.
      const customizeResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/definitions/${encodeURIComponent(CODE_WORKFLOW_API_ID)}/customize`,
        { token: apiToken },
      )
      expect(customizeResponse.status()).toBe(200)
      const customizeBody = await readJsonSafe<DetailResponse>(customizeResponse)
      overrideId = customizeBody?.data?.id ?? null
      expect(overrideId).toBeTruthy()

      // Open the edit page for the override.
      await page.goto(`/backend/definitions/${encodeURIComponent(overrideId!)}`)
      await expect(
        page.getByText('This workflow has been customized from its code-defined version.'),
      ).toBeVisible()

      // Edit the description and submit the full form — this is the real
      // CrudForm submission that previously tripped the strict update validator.
      const newDescription = `QA edit ${Date.now()}`
      // The form and the Steps editor both render a "Description" label, so we
      // scope by placeholder, which is unique to the top-level workflow description.
      const descriptionField = page
        .getByPlaceholder('Optional: Describe the purpose of this workflow')
        .first()
      await expect(descriptionField).toBeEditable()
      await descriptionField.fill(newDescription)

      // CrudForm renders the submit in both the sticky header and the form footer;
      // target the footer (in-form) button, which fires the native submit.
      const updateButton = page
        .locator('button[type="submit"]', { hasText: 'Update Workflow' })
        .first()
      await expect(updateButton).toBeVisible()
      await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/api/workflows/definitions/${overrideId}`) &&
            res.request().method() === 'PUT',
          { timeout: 15_000 },
        ),
        updateButton.click(),
      ])

      // Verify via API that the edit persisted and the row is still a code_override.
      const after = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(overrideId!)}`,
        { token: apiToken },
      )
      expect(after.status()).toBe(200)
      const afterBody = await readJsonSafe<DetailResponse>(after)
      expect(afterBody?.data?.description).toBe(newDescription)
      expect(afterBody?.data?.source).toBe('code_override')
    } finally {
      await deleteWorkflowDefinitionIfExists(request, apiToken, overrideId)
    }
  })

  test('code-defined detail form is read-only (no Update Workflow button)', async ({ page }) => {
    await login(page, 'admin')

    await page.goto(`/backend/definitions/${encodeURIComponent(CODE_WORKFLOW_API_ID)}`)

    await expect(
      page.getByText('This workflow is defined in code. Customize it to make changes.'),
    ).toBeVisible()

    // The CrudForm suppresses its submit button in readOnly mode.
    await expect(page.getByRole('button', { name: 'Update Workflow', exact: true })).toHaveCount(0)

    // Customize is the only action available.
    await expect(page.getByRole('button', { name: 'Customize', exact: true })).toBeVisible()
  })
})
