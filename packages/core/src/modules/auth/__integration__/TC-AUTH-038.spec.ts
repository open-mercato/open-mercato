import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

type Variant = { id: string; name: string }

/**
 * TC-AUTH-038: Sidebar customization "Add new variant" dialog flow.
 * Validates the user-facing UX for creating a variant from the dedicated dialog
 * (post-refactor: '+' button no longer creates the variant directly; it opens a
 * dialog with a name input). The dialog closes on success, the new variant
 * appears selected in the picker, and a success flash is shown.
 */
test.describe('TC-AUTH-038: Sidebar customization Add-new dialog', () => {
  test('opens dialog, creates a named variant and selects it', async ({ page, request }) => {
    const variantName = `qa-dialog-${Date.now()}`
    let token: string | null = null
    let createdId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      await login(page, 'admin')
      await page.goto('/backend/sidebar-customization', { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
      await expect(page.getByRole('heading', { name: /sidebar customization/i })).toBeVisible({ timeout: 10_000 })

      // Open the dialog via the "Create new" button.
      await page.getByRole('button', { name: /create new/i }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 5_000 })
      await expect(dialog.getByText(/add new variant/i)).toBeVisible()

      // Type a unique name and submit via the dialog's primary action.
      const nameInput = dialog.getByPlaceholder(/my preferences/i)
      await nameInput.fill(variantName)
      await expect(nameInput).toHaveValue(variantName)
      await dialog.getByRole('button', { name: /create variant/i }).click()

      // Dialog closes on success.
      await expect(dialog).toBeHidden({ timeout: 10_000 })

      // Variant becomes selected — its name appears in the variant-name input.
      await expect(page.locator(`input[value="${variantName}"]`).first()).toBeVisible({ timeout: 5_000 })

      // Confirm creation server-side and capture id for cleanup.
      const listResponse = await apiRequest(request, 'GET', '/api/auth/sidebar/variants', { token })
      expect(listResponse.ok()).toBeTruthy()
      const listBody = (await listResponse.json()) as { variants?: Variant[] }
      const created = (listBody.variants ?? []).find((v) => v.name === variantName)
      expect(created).toBeTruthy()
      createdId = created!.id
    } finally {
      if (token && createdId) {
        await apiRequest(request, 'DELETE', `/api/auth/sidebar/variants/${encodeURIComponent(createdId)}`, { token }).catch(() => {})
      }
    }
  })
})
