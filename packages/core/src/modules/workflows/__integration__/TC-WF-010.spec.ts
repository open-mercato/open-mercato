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

const CODE_WORKFLOW_ID = 'workflows.simple-approval'
const CODE_WORKFLOW_API_ID = `code:${CODE_WORKFLOW_ID}`

type DetailResponse = {
  data?: { id?: string; workflowId?: string; source?: string }
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
})
