import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  cancelWorkflowInstanceIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'
import {
  openWorkflowTriggersDialog,
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
 * the triggers editor is opened from the START node's trigger cap.
 */
async function openDefinitionInStudioViaRowAction(
  page: Page,
  workflowId: string,
  workflowName: string,
): Promise<void> {
  await page.goto('/backend/definitions')
  const searchBox = page.getByPlaceholder(/search/i).first()
  if (await searchBox.isVisible().catch(() => false)) {
    await fillText(page, searchBox, workflowId)
    await searchBox.press('Enter').catch(() => undefined)
  }

  // The list's "Workflow ID" column is gone — the id now lives in a portaled
  // hover tooltip on the name, so it is never inside the row element. The
  // search above still narrows by id, so the name identifies our row alone.
  const row = page.getByRole('row').filter({ hasText: workflowName })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.getByRole('button', { name: /open actions/i }).hover()
  await page.getByRole('menuitem', { name: /^edit$/i }).first().click()
  await expect(page).toHaveURL(/\/backend\/definitions\/visual-editor\?id=[0-9a-f-]{36}/i, { timeout: 15_000 })
  await expect(workflowStepNodes(page).first()).toBeVisible({ timeout: 15_000 })
}

/**
 * Add one event trigger through the focused Triggers modal.
 *
 * Triggers are no longer a section of the definition drawer: the Studio routes
 * them through `TriggersDialog`, opened from the START node's trigger cap, and
 * the modal hosts the inline `TriggersEditor` — "Add Trigger" appends a row and
 * expands it in place, so there is no nested create dialog and no `Create`
 * button. The row's field ids are minted at runtime, hence the row-scoped
 * locators.
 *
 * The event field is the declared-event picker (`EventPatternInput`, TC-WF-001's
 * subject): a `role="combobox"` that carries no id and commits on selection /
 * Enter / blur rather than per keystroke, so the typed pattern is confirmed
 * with Enter before the editor's working copy holds it.
 */
async function addEventTriggerViaUi(page: Page, triggerName: string, eventPattern: string): Promise<void> {
  await openWorkflowTriggersDialog(page)

  const dialog = page.getByTestId('workflow-triggers-dialog')
  await dialog.getByRole('button', { name: /^add trigger$/i }).click()

  const row = dialog.getByTestId('trigger-row').last()
  await expect(row).toBeVisible({ timeout: 5_000 })
  await fillText(page, row.locator('input[id$="-name"]'), triggerName)

  const patternInput = row.getByRole('combobox')
  await fillText(page, patternInput, eventPattern)
  await patternInput.press('Enter')

  // The row's collapsed header echoes both values from the editor's committed
  // state, so seeing them there proves `onChange` reached the dialog's working
  // copy before Save reads it.
  await expect(row.getByText(triggerName, { exact: true }).first()).toBeVisible({ timeout: 5_000 })
  await expect(row.locator('code', { hasText: eventPattern }).first()).toBeVisible({ timeout: 5_000 })

  await dialog.getByRole('button', { name: /^save triggers$/i }).click()
  await expect(dialog).toBeHidden({ timeout: 5_000 })
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
      await openDefinitionInStudioViaRowAction(page, workflowId, workflowName)

      await addEventTriggerViaUi(page, triggerName, 'customers.person.created')

      // Persist the trigger with the Studio's Save. The editor stays on the
      // canvas after saving, so the confirmation is the success flash rather
      // than a redirect; the server-side assertion below is what actually
      // proves the PUT landed before we fire the event. The Triggers modal has
      // closed by now, so the header's Update is the only one on the page.
      await page.getByRole('button', { name: 'Update', exact: true }).click()
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
      //
      // The run detail is Flow / Timeline / Context / Raw now (spec §8.3) and
      // lands on Flow, so the Context panel is not mounted until its tab is
      // selected — the id is genuinely absent from the landing view, not late.
      await page.getByRole('tab', { name: /^context$/i }).click()
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
