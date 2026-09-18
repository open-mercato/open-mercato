import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import {
  openWorkflowStudio,
  openWorkflowTriggersDialog,
} from '@open-mercato/core/helpers/integration/workflowsUi'

/**
 * Open the Studio and reveal the triggers editor.
 *
 * "Add Trigger" is NOT in the definition drawer: the Studio routes triggers
 * through the focused `TriggersDialog`, opened from the START node's trigger
 * cap on the canvas. The old `/backend/definitions/<id>` + immediate probe
 * could never converge, and neither could opening the drawer — the retry and
 * `Something went wrong` scaffolding went with the retired form editor.
 */
async function openTriggersEditor(page: Page, definitionId: string): Promise<void> {
  await openWorkflowStudio(page, definitionId)
  await openWorkflowTriggersDialog(page)
}

/**
 * TC-WF-001: Event Pattern Autocomplete in Trigger Editor
 *
 * Verifies that the EventPatternInput component on a trigger's event field
 * shows autocomplete suggestions for declared events, that filtering by
 * partial text works, that selecting a suggestion displays the human-readable
 * label (not the raw event ID), and that custom wildcard patterns are also
 * accepted without being reset.
 *
 * The field moved but the contract did not: there is no nested "Create Event
 * Trigger" dialog any more. `TriggersDialog` hosts the inline `TriggersEditor`,
 * where "Add Trigger" appends a row and expands it IN PLACE, so the pattern
 * field is reached through the row rather than through a second dialog.
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
    // Login + Studio boot + canvas paint before the first assertion — the same
    // walk the sibling Studio journeys (TC-WF-006/007) budget for; it does not
    // fit the shared 20s default.
    test.setTimeout(90_000)
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
      if (!definitionId) {
        throw new Error('Workflow definition ID should be present after creation')
      }

      // --- Navigate to the Studio and reveal the triggers editor ---
      await login(page, 'admin')
      await openTriggersEditor(page, definitionId)

      // --- Add a trigger row; it expands inline, no nested dialog ---
      const dialog = page.getByTestId('workflow-triggers-dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: /^add trigger$/i }).click()

      const row = dialog.getByTestId('trigger-row').last()
      await expect(row).toBeVisible({ timeout: 5_000 })

      // --- Event Pattern autocomplete: suggestions appear on focus ---
      // `EventPatternInput` renders a `role="combobox"` input; it takes no `id`,
      // so the row's field ids do not address it.
      const patternInput = row.getByRole('combobox')
      await expect(patternInput).toHaveAttribute('placeholder', 'sales.orders.updated')
      await patternInput.click()

      // At least one event suggestion should appear in the dropdown. The list is
      // portaled to <body>, so it is a sibling of the dialog rather than a descendant —
      // query it from `page`.
      const firstSuggestion = page.getByRole('option').filter({ hasText: /Created|Updated|Deleted/i }).first()
      await expect(firstSuggestion).toBeVisible()

      // --- Filtering: typing narrows suggestions ---
      await patternInput.fill('customers')
      const customerSuggestion = page.getByRole('option').filter({ hasText: /Customer/i }).first()
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

      // Cancel without saving — the dialog edits a working copy, so dismissing
      // it discards the row. Trigger persistence is TC-WF-008's subject.
      await dialog.getByRole('button', { name: /^cancel$/i }).click()
      await expect(dialog).toBeHidden({ timeout: 5_000 })
    } finally {
      await deleteEntityIfExists(request, token, '/api/workflows/definitions', definitionId)
    }
  })
})
