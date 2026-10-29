import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteFormIfExists,
  uniqueFormKey,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-UI-002: creating a form through the Studio's create page persists it.
 *
 * The create page is a `CrudForm` whose `onSubmit` reshapes the values before
 * posting — it trims the key and name and splits the comma-separated
 * `supportedLocales` text field into an array. That transform is real logic
 * between the browser and `POST /api/forms`, and a regression in it would produce
 * a form whose `supportedLocales` is the literal string `"en, pl"` rather than
 * `['en','pl']`. So this asserts the persisted shape, not just that a row
 * appeared.
 *
 * The `key` input is located by its placeholder (`patient-intake`) per the house
 * convention. `Name` and `Supported locales` have neither a placeholder nor an
 * accessible name — `CrudForm` renders its `<label>` without `htmlFor` and the
 * input without a matching `id`, so `getByLabel` cannot see them (worth fixing
 * for screen-reader users, but out of scope here). They are therefore located
 * through `data-crud-field-id`, which `CrudForm` emits on every field wrapper
 * specifically as a stable hook, rather than through incidental class names.
 *
 * Every field goes through `fillControlledInput`, not a bare `fill`. These are
 * React-controlled inputs: a fill that lands before hydration writes the DOM and
 * the hydration render then restores the initial state, so the field empties
 * again a few dozen milliseconds later. A plain `fill` plus an immediate
 * `toHaveValue` reads the window before that happens and reports success on a
 * value the app is about to discard — which is exactly how the first draft of
 * this spec submitted a blank form and timed out waiting for a redirect that
 * could never come.
 */
test.describe('TC-FORMS-UI-002: create a form through the UI', () => {
  test('submits the create form and persists the reshaped payload', async ({ page, request }) => {
    test.slow()

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const key = uniqueFormKey('qa_ui002')
    const name = `QA UI002 ${stamp}`

    let adminToken: string | null = null
    let formId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      await login(page, 'admin')
      await page.goto('/backend/forms/create', { waitUntil: 'domcontentloaded' })

      const keyInput = page.getByPlaceholder('patient-intake')
      await expect(keyInput, 'the create form renders the key field').toBeVisible({ timeout: 30_000 })

      const nameInput = page.locator('[data-crud-field-id="name"] input')
      const localesInput = page.locator('[data-crud-field-id="supportedLocales"] input')

      // Fill the autofocus target last. The CI trace showed the mount-time
      // autofocus/hydration pass resetting only that first field; filling the
      // two ordinary controlled fields first guarantees that pass has settled.
      await fillControlledInput(nameInput, name)
      // Overwrite the prefilled 'en' so the comma-splitting transform is exercised.
      await fillControlledInput(localesInput, 'en, pl')
      await fillControlledInput(keyInput, key)

      // Re-read every field after the last fill: the settle window inside
      // `fillControlledInput` guards each field individually, but a late
      // hydration pass could still have reset an earlier one.
      await expect(keyInput, 'the key survived hydration').toHaveValue(key)
      await expect(nameInput, 'the name survived hydration').toHaveValue(name)
      await expect(localesInput, 'the locale list survived hydration').toHaveValue('en, pl')

      // `CrudForm` renders its submit control twice (an in-form button plus a
      // portalled footer one that targets the form by id), so the role locator is
      // ambiguous by design — take the first.
      await page.getByRole('button', { name: 'Create form' }).first().click()

      // A successful create redirects to the Studio for the new form, which is
      // where the new id first becomes visible to the test.
      await page.waitForURL(/\/backend\/forms\/[0-9a-f-]{36}/, { timeout: 30_000 })
      const match = /\/backend\/forms\/([0-9a-f-]{36})/.exec(page.url())
      expect(match?.[1], 'the redirect carries the new form id').toBeTruthy()
      formId = match![1]

      const detailRes = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token: adminToken })
      expect(
        detailRes.status(),
        `the created form should be readable over the API (got ${detailRes.status()})`,
      ).toBe(200)
      const detail = await readJsonSafe<{
        key?: string
        name?: string
        status?: string
        defaultLocale?: string
        supportedLocales?: string[]
      }>(detailRes)
      expect(detail?.key, 'the key typed in the browser is the key stored').toBe(key)
      expect(detail?.name, 'the name typed in the browser is the name stored').toBe(name)
      expect(detail?.status, 'a form created through the UI starts as a draft').toBe('draft')
      expect(detail?.defaultLocale, 'the prefilled default locale is used').toBe('en')
      expect(
        detail?.supportedLocales,
        'the comma-separated locale text is split into an array, not stored verbatim',
      ).toEqual(['en', 'pl'])

      // And it shows up in the list the operator returns to.
      const listRes = await apiRequest(
        request,
        'GET',
        `/api/forms?q=${encodeURIComponent(key)}&pageSize=100`,
        { token: adminToken },
      )
      const list = await readJsonSafe<{ items?: Array<{ id: string }> }>(listRes)
      expect(
        (list?.items ?? []).map((item) => item.id),
        'the new form is discoverable through the list route',
      ).toContain(formId)
    } finally {
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
