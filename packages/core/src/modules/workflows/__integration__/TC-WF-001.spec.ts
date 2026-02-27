import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

/**
 * TC-WF-001: Event Pattern Autocomplete in Trigger Editor
 *
 * Verifies that the EventPatternInput component in the "Create Event Trigger"
 * dialog shows autocomplete suggestions for declared events, that filtering by
 * partial text works, that selecting a suggestion displays the human-readable
 * label (not the raw event ID), and that custom wildcard patterns are also
 * accepted without being reset.
 *
 * Note: trigger creation (POST /api/workflows/triggers) is not tested here —
 * that API route is a separate concern outside the scope of issue #544, which
 * added the EventPatternInput autocomplete UI component.
 */
test.describe('TC-WF-001: Event Pattern Autocomplete', () => {
  test('should suggest events, filter them, and display the label on selection', async ({
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

      // The description span shows the raw event ID beneath the human-readable label
      const suggestionDescription = customerSuggestion.locator('span').last()
      const eventId = await suggestionDescription.textContent()
      expect(eventId).toMatch(/^customers\..+/)

      // --- Selection: use keyboard navigation to avoid the onBlur 200ms race condition.
      // Mouse click can trigger onBlur before React re-renders from the click handler,
      // causing confirmSelection() to fire with the stale typed value 'customers'.
      // ArrowDown + Enter selects directly from the keydown handler with no blur involved. ---
      await patternInput.press('ArrowDown')
      await patternInput.press('Enter')

      // Dropdown should close and input should show the human-readable label
      await expect(customerSuggestion).not.toBeVisible()
      const selectedLabel = await patternInput.inputValue()
      // The label is displayed in the input, not the typed query or the raw event ID
      expect(selectedLabel).not.toBe('')
      expect(selectedLabel).not.toBe('customers')
      expect(selectedLabel).not.toBe(eventId)

      // --- Custom wildcard: free-text pattern is committed without being reset ---
      await patternInput.fill('sales.orders.*')
      // Escape closes the dropdown and commits the typed value
      await patternInput.press('Escape')
      await expect(patternInput).toHaveValue('sales.orders.*')

      // Cancel without saving — trigger creation API is out of scope for this test
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
    } finally {
      await deleteEntityIfExists(request, token, '/api/workflows/definitions', definitionId)
    }
  })
})
