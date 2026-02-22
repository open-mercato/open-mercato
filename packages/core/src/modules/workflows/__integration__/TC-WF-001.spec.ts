import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

/**
 * TC-WF-001: Event Pattern Autocomplete in Trigger Editor
 *
 * Verifies that the EventPatternInput component in the "Create Event Trigger"
 * dialog shows autocomplete suggestions for declared events, that filtering by
 * partial text works, that selecting a suggestion stores the event ID (not the
 * display label), and that custom wildcard patterns are also accepted.
 */
test.describe('TC-WF-001: Event Pattern Autocomplete', () => {
  test('should suggest events, filter them, and store the event ID on selection', async ({
    page,
    request,
  }) => {
    let token: string | null = null
    let definitionId: string | null = null
    const timestamp = Date.now()

    try {
      token = await getAuthToken(request)

      // --- Fixture: create a minimal workflow definition ---
      const createRes = await apiRequest(request, 'POST', '/api/workflows/definitions', {
        token,
        data: {
          workflowId: `qa-wf-001-${timestamp}`,
          workflowName: `QA TC-WF-001 ${timestamp}`,
          version: 1,
          definition: {
            steps: [
              { stepId: 'start', stepName: 'Start', stepType: 'START' },
              { stepId: 'end', stepName: 'End', stepType: 'END' },
            ],
            transitions: [
              {
                transitionId: 'start-to-end',
                fromStepId: 'start',
                toStepId: 'end',
                trigger: 'auto',
              },
            ],
          },
        },
      })
      expect(createRes.status()).toBe(201)
      const createBody = await createRes.json()
      definitionId = createBody.data?.id
      expect(definitionId, 'Workflow definition ID should be present after creation').toBeTruthy()

      // --- Navigate to the workflow definition edit page ---
      await login(page, 'admin')
      await page.goto(`/backend/definitions/${definitionId}`)

      // --- Open the Create Event Trigger dialog ---
      await page.getByRole('button', { name: 'Add Trigger' }).click()
      const dialog = page.getByRole('dialog', { name: 'Create Event Trigger' })
      await expect(dialog).toBeVisible()

      // --- Event Pattern autocomplete: suggestions appear on focus ---
      const patternInput = dialog.getByPlaceholder('sales.orders.updated')
      await patternInput.click()

      // At least one event suggestion should appear in the dropdown
      const firstSuggestion = dialog.getByRole('button').filter({ hasText: /Created|Updated|Deleted/i }).first()
      await expect(firstSuggestion).toBeVisible()

      // --- Filtering: typing narrows suggestions ---
      await patternInput.fill('customers')
      const customerSuggestion = dialog.getByRole('button').filter({ hasText: /Customer/i }).first()
      await expect(customerSuggestion).toBeVisible()

      // Note the description (event ID) shown beneath the suggestion label
      const suggestionDescription = customerSuggestion.locator('span').last()
      const eventId = await suggestionDescription.textContent()
      expect(eventId).toMatch(/^customers\..+/)

      // --- Selection: clicking a suggestion sets the input to its label ---
      await customerSuggestion.click()
      // The displayed value is the human-readable label, not the raw ID
      await expect(patternInput).not.toHaveValue('')
      await expect(patternInput).not.toHaveValue('customers')

      // --- Submit the trigger with the selected event ---
      await dialog.getByLabel('Name').fill(`QA Trigger ${timestamp}`)
      await dialog.getByRole('button', { name: 'Create' }).click()
      await expect(dialog).toBeHidden()

      // The created trigger should appear in the list with the correct event ID
      // (EventTriggersEditor renders the event pattern in a <code> element)
      await expect(page.getByText(eventId!)).toBeVisible()

      // --- Custom wildcard: verify free-text pattern is accepted ---
      await page.getByRole('button', { name: 'Add Trigger' }).click()
      await expect(dialog).toBeVisible()

      const wildcardInput = dialog.getByPlaceholder('sales.orders.updated')
      await wildcardInput.fill('sales.orders.*')
      // Close the dropdown via Escape so the value is committed
      await wildcardInput.press('Escape')
      await expect(wildcardInput).toHaveValue('sales.orders.*')

      // Cancel without saving
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
    } finally {
      await deleteEntityIfExists(request, token, '/api/workflows/definitions', definitionId)
    }
  })
})
