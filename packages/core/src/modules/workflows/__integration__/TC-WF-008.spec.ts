import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  cancelWorkflowInstanceIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'
import {
  openWorkflowDetailsDrawer,
  workflowDetailsDrawer,
  workflowStepNodes,
} from '@open-mercato/core/helpers/integration/workflowsUi'

async function fillText(page: Page, locator: ReturnType<Page['locator']>, value: string): Promise<void> {
  await locator.fill('')
  await locator.fill(value)
}

async function findDefinitionIdByWorkflowId(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  workflowId: string,
): Promise<string | null> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/workflows/definitions?workflowId=${encodeURIComponent(workflowId)}&limit=1`,
    { token },
  ).catch(() => null)
  if (!res || res.status() !== 200) return null
  const body = await res.json().catch(() => null)
  return body?.data?.[0]?.id ?? null
}

async function findInstanceIdByWorkflowId(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  workflowId: string,
): Promise<string | null> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/workflows/instances?workflowId=${encodeURIComponent(workflowId)}&limit=1`,
    { token },
  ).catch(() => null)
  if (!res || res.status() !== 200) return null
  const body = await res.json().catch(() => null)
  return body?.data?.[0]?.id ?? null
}

/**
 * Open the definition in the Studio through the list's row action.
 *
 * The form editor is retired (spec section 10), so `Edit` is the single editor
 * entry and it lands on `/backend/definitions/visual-editor?id=<uuid>`, where
 * the triggers editor lives in the workflow-details panel.
 */
async function openDefinitionInStudioViaRowAction(page: Page, workflowId: string): Promise<void> {
  await page.goto('/backend/definitions')
  const searchBox = page.getByPlaceholder(/search/i).first()
  if (await searchBox.isVisible().catch(() => false)) {
    await fillText(page, searchBox, workflowId)
    await searchBox.press('Enter').catch(() => undefined)
  }

  const row = page.getByRole('row').filter({ hasText: workflowId })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.getByRole('button', { name: /open actions/i }).hover()
  await page.getByRole('menuitem', { name: /^edit$/i }).first().click()
  await expect(page).toHaveURL(/\/backend\/definitions\/visual-editor\?id=[0-9a-f-]{36}/i, { timeout: 15_000 })
  await expect(workflowStepNodes(page).first()).toBeVisible({ timeout: 15_000 })
}

/**
 * The triggers editor lives in the details Drawer's `inputs` section, so it has
 * to be opened first. That also means "the dialog" is ambiguous while the drawer
 * is open — the trigger dialog is scoped by its own accessible name.
 */
async function addEventTriggerViaUi(page: Page, triggerName: string, eventPattern: string): Promise<void> {
  await openWorkflowDetailsDrawer(page)
  await page.getByRole('button', { name: /^add trigger$/i }).click()

  const dialog = page.getByRole('dialog', { name: /create event trigger/i })
  await expect(dialog).toBeVisible()

  await fillText(page, dialog.locator('#trigger-name'), triggerName)

  // EventPatternInput wraps ComboboxInput, which keeps its own internal state
  // and only propagates to the parent when confirmSelection runs (synchronously
  // on Enter; via a 200ms setTimeout on blur). Playwright's fill() + Tab path
  // is racy against the blur timer in compiled production builds, so type the
  // value with real keystrokes, press Enter to attempt synchronous commit, and
  // then click another field to force a real blur — both paths are needed
  // because Enter alone can fire with a stale `input` closure when keystrokes
  // arrive faster than React can re-render handleKeyDown.
  const patternInput = dialog.getByPlaceholder('sales.orders.updated')
  await patternInput.click()
  await patternInput.pressSequentially(eventPattern, { delay: 20 })
  await patternInput.press('Enter')
  await dialog.locator('#trigger-name').click()

  const createButton = dialog.getByRole('button', { name: /^create$/i })
  await expect(createButton).toBeEnabled({ timeout: 5_000 })
  await createButton.click()
  await expect(dialog).toBeHidden({ timeout: 5_000 })

  // Wait for the trigger card itself (containing the unique triggerName) to
  // render. This guarantees the parent's onChange fired and the next page-
  // level Update Workflow submit will see the trigger in state — without it,
  // we race the React state update.
  await expect(page.getByText(triggerName, { exact: true }).first()).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('code', { hasText: eventPattern }).first()).toBeVisible({ timeout: 5_000 })
}

/**
 * TC-WF-008: End-to-end workflow execution fully driven from the admin UI.
 *
 * The admin UI does not expose a direct "Start Instance" button, so we route the
 * execution path through an event trigger (`customers.person.created`) — which is
 * still the most UI-real way to exercise a workflow end-to-end:
 *   1. Seed a START → END definition through the definitions API (fixture setup —
 *      the form editor that used to author it is retired, and the Studio's own
 *      authoring path is covered by TC-WF-007)
 *   2. Open it in the Studio via the list row action
 *   3. Add a `customers.person.created` trigger through the triggers dialog
 *   4. Save the definition to persist the trigger
 *   5. Create a Person via the CRM UI — this fires `customers.person.created`
 *   6. Navigate to `/backend/instances`, filter by our workflowId, and assert that
 *      the auto-started instance appears and reaches a terminal state.
 */
test.describe('TC-WF-008: Event-triggered workflow runs end-to-end via UI', () => {
  test('creates a triggered workflow, fires the event through CRM UI, and sees the instance execute', async ({
    page,
    request,
  }) => {
    // UI walkthrough + async trigger evaluation + instance completion polling
    // easily exceeds the 20s default.
    test.setTimeout(150_000)
    const timestamp = Date.now()
    const workflowId = `qa-wf-008-${timestamp}`
    const workflowName = `QA TC-WF-008 ${timestamp}`
    const triggerName = `QA Person Created Trigger ${timestamp}`
    const firstName = `QA${timestamp}`
    const lastName = 'WF008'
    let token: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      await createWorkflowDefinitionFixture(request, token, {
        workflowId,
        workflowName,
        description: 'Integration test: event-triggered workflow runs end-to-end',
        version: 1,
        enabled: true,
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            { transitionId: 'start_to_end', fromStepId: 'start', toStepId: 'end', trigger: 'auto', priority: 100 },
          ],
        },
      })

      await login(page, 'admin')
      await openDefinitionInStudioViaRowAction(page, workflowId)

      await addEventTriggerViaUi(page, triggerName, 'customers.person.created')

      // Persist the trigger with the Studio's Save. The editor stays on the
      // canvas after saving, so the confirmation is the success flash rather
      // than a redirect; the server-side assertion below is what actually
      // proves the PUT landed before we fire the event. Scoped to the drawer:
      // the header Update and the drawer footer Update share a name.
      await workflowDetailsDrawer(page).getByRole('button', { name: /^update$/i }).click()
      await expect(page.getByText(/workflow updated successfully/i).first())
        .toBeVisible({ timeout: 15_000 })

      // Verify the trigger actually persisted server-side before continuing.
      // Without this assertion the test races event-bus pickup vs. the slow
      // 60s instance-completion poll, which fails opaquely if the dialog
      // submit dropped the trigger in the compiled production bundle.
      await expect(async () => {
        const defId = await findDefinitionIdByWorkflowId(request, token!, workflowId)
        expect(defId, 'workflow definition should be discoverable by workflowId').toBeTruthy()
        const defRes = await apiRequest(request, 'GET', `/api/workflows/definitions/${defId}`, { token: token! })
        const defBody = await defRes.json().catch(() => null)
        const savedTriggers = defBody?.data?.definition?.triggers as Array<{ eventPattern?: string }> | undefined
        expect(savedTriggers?.length ?? 0, 'definition should have at least one trigger after Update Workflow').toBeGreaterThan(0)
        expect(savedTriggers?.[0]?.eventPattern).toBe('customers.person.created')
      }).toPass({ timeout: 10_000, intervals: [500, 1_000] })

      // Create a person via the CRM UI → fires customers.person.created → trigger runs
      await page.goto('/backend/customers/people/create')
      await expect(page).toHaveURL(/\/backend\/customers\/people\/create/)

      await page.locator('form').getByRole('textbox').first().fill(firstName)
      await page.locator('form').getByRole('textbox').nth(1).fill(lastName)
      await page.getByPlaceholder('name@example.com').fill(`qa.wf008.${timestamp}@example.com`)

      await page.getByRole('button', { name: /create person/i }).first().click()
      await expect(page).toHaveURL(/\/backend\/customers\/people-v2\/[0-9a-f-]{36}$/i, { timeout: 15_000 })

      // Capture the newly created person's entity id from the URL so we can
      // later prove the workflow instance we observe was triggered by THIS
      // specific person creation (not a stray prior instance).
      const personIdMatch = page.url().match(/\/backend\/customers\/people-v2\/([0-9a-f-]{36})/i)
      const personEntityId = personIdMatch?.[1]
      expect(personEntityId).toBeTruthy()

      // Wait for the auto-started instance to exist and complete via the API
      // first. Polling `/backend/instances` directly in a `toPass` loop burns
      // ~5–7s per attempt (full page navigation + two toBeVisible waits), so
      // a 60s budget only buys ~10 iterations and the trigger pipeline
      // (event emit → subscriber dispatch → instance create → instance
      // execute → list re-fetch) can legitimately need longer on a busy CI
      // ephemeral env. The API check is deterministic, has no UI churn, and
      // makes the failure mode observable: if it times out, the instance
      // genuinely was not created.
      await expect(async () => {
        const res = await apiRequest(
          request,
          'GET',
          `/api/workflows/instances?workflowId=${encodeURIComponent(workflowId)}&limit=1`,
          { token: token! },
        )
        expect(res.ok(), `GET /api/workflows/instances failed: ${res.status()}`).toBeTruthy()
        const body = (await res.json().catch(() => null)) as { data?: Array<{ status?: string }> } | null
        const status = body?.data?.[0]?.status
        expect(status, `instance for ${workflowId} should be discoverable`).toBeTruthy()
        expect(status, `instance status should reach COMPLETED (current: ${status})`).toBe('COMPLETED')
      }).toPass({ timeout: 90_000, intervals: [500, 1_000, 2_000] })

      // UI verification: load the instances list once and assert the row
      // renders with the localized "Completed" status. Now that the
      // server-side state is confirmed, this is a single page load instead
      // of a retry storm.
      await page.goto('/backend/instances')
      const instanceRow = page.getByRole('row').filter({ hasText: workflowId }).first()
      await expect(instanceRow).toBeVisible({ timeout: 15_000 })
      await expect(instanceRow).toContainText('Completed', { timeout: 10_000 })

      await instanceRow.getByRole('link').first().click()
      await expect(page).toHaveURL(/\/backend\/instances\/[0-9a-f-]{36}/i, { timeout: 10_000 })

      // Prove causation: the event-trigger service spreads the event payload
      // into the instance context, so the `customers.person.created` payload's
      // `entityId` is rendered in the Context JSON panel on the instance page.
      // Matching on that id ties this completed instance to our specific
      // person creation rather than any concurrent run.
      await expect(page.getByText(personEntityId!, { exact: false }).first())
        .toBeVisible({ timeout: 10_000 })
    } finally {
      if (token) {
        const instanceId = await findInstanceIdByWorkflowId(request, token, workflowId)
        await cancelWorkflowInstanceIfExists(request, token, instanceId)

        const leftoverId = await findDefinitionIdByWorkflowId(request, token, workflowId)
        await deleteWorkflowDefinitionIfExists(request, token, leftoverId)
      }
    }
  })
})
