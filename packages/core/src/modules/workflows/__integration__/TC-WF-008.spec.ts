import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteWorkflowDefinitionIfExists,
  cancelWorkflowInstanceIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

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

async function createMinimalDefinitionViaUi(
  page: Page,
  workflowId: string,
  workflowName: string,
): Promise<void> {
  await page.goto('/backend/definitions/create')
  await expect(page).toHaveURL(/\/backend\/definitions\/create/)

  await fillText(page, page.getByPlaceholder('checkout_workflow'), workflowId)
  await fillText(page, page.getByPlaceholder('Enter a descriptive workflow name'), workflowName)

  const addStepBtn = page.getByRole('button', { name: /^add step$/i })
  await addStepBtn.click()
  await fillText(page, page.locator('#step-0-id'), 'start')
  await fillText(page, page.locator('#step-0-name'), 'Start')
  // Radix Select helpers
  const pickRadix = async (triggerId: string, optionLabel: string | RegExp) => {
    await page.locator(`#${triggerId}`).click()
    const opt = typeof optionLabel === 'string'
      ? page.getByRole('option', { name: optionLabel, exact: true })
      : page.getByRole('option', { name: optionLabel })
    await opt.first().click()
  }
  await pickRadix('step-0-type', 'Start')

  await addStepBtn.click()
  await fillText(page, page.locator('#step-1-id'), 'end')
  await fillText(page, page.locator('#step-1-name'), 'End')
  await pickRadix('step-1-type', 'End')

  await page.getByRole('button', { name: /^add transition$/i }).click()
  await fillText(page, page.locator('#transition-0-id'), 'start-to-end')
  await fillText(page, page.locator('#transition-0-name'), 'Auto advance')
  await pickRadix('transition-0-from', /^start$/i)
  await pickRadix('transition-0-to', /^end$/i)

  await page.getByRole('button', { name: /^create workflow$/i }).first().click()
  await expect(page).toHaveURL(/\/backend\/definitions(\?|$|\/)/, { timeout: 15_000 })
}

async function openDefinitionDetailViaRowAction(page: Page, workflowId: string): Promise<void> {
  const searchBox = page.getByPlaceholder(/search/i).first()
  if (await searchBox.isVisible().catch(() => false)) {
    await fillText(page, searchBox, workflowId)
    await searchBox.press('Enter').catch(() => undefined)
  }

  const row = page.getByRole('row').filter({ hasText: workflowId })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.getByRole('button', { name: /open actions/i }).hover()
  await page.getByRole('menuitem', { name: /^edit$/i }).first().click()
  await expect(page).toHaveURL(/\/backend\/definitions\/[0-9a-f-]{36}/i, { timeout: 15_000 })
}

async function addEventTriggerViaUi(page: Page, triggerName: string, eventPattern: string): Promise<void> {
  await page.getByRole('button', { name: /^add trigger$/i }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await fillText(page, dialog.locator('#trigger-name'), triggerName)
  const patternInput = dialog.getByPlaceholder('sales.orders.updated')
  await fillText(page, patternInput, eventPattern)
  // EventPatternInput only commits via blur/Enter; press Tab to trigger confirmSelection
  await patternInput.press('Tab')

  await expect(dialog.getByRole('button', { name: /^create$/i })).toBeEnabled({ timeout: 5_000 })
  await dialog.getByRole('button', { name: /^create$/i }).click()
  await expect(dialog).toBeHidden({ timeout: 5_000 })

  // Trigger card now lists the pattern inline
  await expect(page.getByText(eventPattern, { exact: true }).first()).toBeVisible()
}

/**
 * TC-WF-008: End-to-end workflow execution fully driven from the admin UI.
 *
 * The admin UI does not expose a direct "Start Instance" button, so we route the
 * execution path through an event trigger (`customers.person.created`) — which is
 * still the most UI-real way to exercise a workflow end-to-end:
 *   1. Create a START → END definition via the Create form
 *   2. Open it via the list row action
 *   3. Add a `customers.person.created` trigger through the triggers dialog
 *   4. Submit the edit form to persist the trigger
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

      await login(page, 'admin')
      await createMinimalDefinitionViaUi(page, workflowId, workflowName)
      await openDefinitionDetailViaRowAction(page, workflowId)

      await addEventTriggerViaUi(page, triggerName, 'customers.person.created')

      // Persist the trigger by submitting the definition edit form
      await page.getByRole('button', { name: /^update workflow$/i }).first().click()
      await expect(page).toHaveURL(/\/backend\/definitions(\?|$|\/)/, { timeout: 15_000 })

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

      // Look for the auto-started instance and wait for it to reach COMPLETED.
      // Trigger evaluation is async (subscriber → queue), so poll the instances
      // list until the row appears AND its status cell reads "Completed". The
      // list renders status as title-case i18n ("Completed"); the detail page
      // also contains COMPLETED uppercase inside hidden React Flow nodes,
      // so asserting on the list row is more robust.
      const instanceRow = page.getByRole('row').filter({ hasText: workflowId }).first()
      await expect(async () => {
        await page.goto('/backend/instances')
        await expect(instanceRow).toBeVisible({ timeout: 2_000 })
        await expect(instanceRow).toContainText('Completed', { timeout: 2_000 })
      }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] })

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
