import { expect, test, type ConsoleMessage } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-056: Confirm-dialog stability — Discard prompt reopens after Keep
 * editing/X (#1804) and Company Name with JSON-like content does not crash
 * the page with a `useInsertionEffect must not schedule updates` warning
 * (#1810).
 *
 * Spec: .ai/specs/2026-05-06-crm-fixes-3.md (Cluster A — Step 6).
 *
 * Hypothesised root causes (also documented in the spec):
 *   - #1810: `processQueue` in `useConfirmDialog.tsx` called `setOptions(...)` and
 *     `setOpen(true)` synchronously while a parent Radix Dialog's
 *     `useInsertionEffect` commit phase was still running. React 18/19 forbids
 *     state updates during that phase.
 *   - #1804: when the dialog was cancelled, the queue's open-lock (`openRef`)
 *     was not always reset before the next `confirm(...)` call evaluated its
 *     guard, which dropped the second open request and left the parent dialog
 *     unable to react to subsequent close attempts.
 *
 * The fix in `useConfirmDialog.tsx` defers state writes via `queueMicrotask`
 * and resets the open-lock before scheduling queue work.
 *
 * This file ships two narrowly-scoped scenarios (one per issue) so a failure
 * in one path does not starve the other under a shared Playwright timeout.
 */
test.describe('TC-CRM-056: Confirm-dialog stability (#1804, #1810)', () => {
  test('Schedule Activity discard prompt reopens after Keep editing (#1804)', async ({ page, request }) => {
    test.slow()
    test.setTimeout(120_000)

    let token: string | null = null
    let companyId: string | null = null
    const stamp = Date.now()
    const titleStub = `QA TC-CRM-056 #1804 ${stamp}`

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-056 Co ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, {
        waitUntil: 'domcontentloaded',
      })

      const activityTab = page.getByRole('tab', { name: /Activity log/i })
      await expect(activityTab).toBeVisible({ timeout: 30_000 })
      await activityTab.click()

      const addNewTrigger = page.getByRole('button', { name: /^Add new$/ })
      await expect(addNewTrigger).toBeVisible({ timeout: 30_000 })
      await addNewTrigger.click()

      // Schedule a Task — the dialog opens with the task tab pre-selected.
      const newTaskItem = page.getByRole('button', { name: /New task/i }).first()
      await expect(newTaskItem).toBeVisible({ timeout: 15_000 })
      await newTaskItem.click()

      // Scope to the Radix-rendered Schedule Activity dialog (named after the
      // selected activity type via VisuallyHidden DialogTitle) so we don't
      // accidentally fill the timeline's search input (which also has a
      // "title" substring in its placeholder).
      const scheduleDialog = page.getByRole('dialog', { name: /New task|Edit activity/i })
      await expect(scheduleDialog).toBeVisible({ timeout: 15_000 })

      // The schedule dialog renders the title via a plain <input> with the
      // localized "Activity title..." placeholder (or "Subject..." for emails).
      const titleInput = scheduleDialog
        .getByPlaceholder(/Activity title|Subject/i)
        .first()
      await expect(titleInput).toBeVisible({ timeout: 15_000 })

      // The dialog's "isDirty" snapshot tracker captures up to two formSnapshot
      // settles after mount (initial render + any default-value re-render).
      // Waiting a short moment before filling lets those settles complete so
      // our fill produces a snapshot that genuinely differs from the captured
      // initial — otherwise guardedClose() can short-circuit because isDirty
      // returns false and the discard alert never fires.
      await page.waitForTimeout(500)
      await titleInput.fill(titleStub)
      // Press Tab to blur so the input commits its value via onChange.
      await titleInput.press('Tab')
      await expect(titleInput).toHaveValue(titleStub)

      // Trigger the unsaved-changes confirm by clicking the bottom-row Cancel
      // button (data-slot="button" with text "Cancel"). This calls
      // guardedClose() which routes through the useConfirmDialog hook.
      // The dialog also has a top-right X with aria-label="Cancel"; we pick
      // the text button via locator filtering to keep the selector stable
      // across DS revisions to either control.
      const dialogCancelButton = scheduleDialog
        .locator('button[data-slot="button"]')
        .filter({ hasText: /^Cancel$/ })
        .first()
      await expect(dialogCancelButton).toBeVisible({ timeout: 10_000 })
      await dialogCancelButton.click()

      // The native <dialog role="alertdialog"> rendered by ConfirmDialog
      // toggles the `open` HTML attribute via showModal(); check that
      // attribute directly because Playwright's visibility heuristics can
      // miss native <dialog> elements when their backdrop is still
      // animating in.
      const discardDialog = page.locator('dialog[role="alertdialog"][open]')
      await expect(discardDialog).toHaveCount(1, { timeout: 10_000 })

      // Click "Keep editing" to dismiss the discard prompt without losing
      // the unsaved title. Before the fix the second confirm() never reopened.
      // The native <dialog> sits in the top-layer; Playwright's standard
      // click + force-click both intermittently fail to register here.
      // Calling `.click()` from inside the page evaluates element.click()
      // on the focused button which always fires the React click handler
      // (this is the same path the user takes when pressing Space/Enter
      // on the focused "Keep editing" button).
      await page.evaluate(() => {
        const dialog = document.querySelector('dialog[role="alertdialog"][open]')
        if (!dialog) throw new Error('Discard dialog not present in DOM')
        const buttons = Array.from(dialog.querySelectorAll('button')) as HTMLButtonElement[]
        const target = buttons.find((btn) => /keep editing/i.test(btn.textContent ?? ''))
        if (!target) throw new Error('"Keep editing" button not found inside discard dialog')
        target.click()
      })
      // Wait for the dialog's `open` attribute to be removed.
      await expect(page.locator('dialog[role="alertdialog"][open]')).toHaveCount(0, { timeout: 10_000 })

      // Title input MUST still hold our content (the dialog stayed open).
      await expect(titleInput).toHaveValue(titleStub)

      // Click Cancel again — the discard prompt MUST re-render. With the
      // freeze bug (#1804) present, the second confirm() call was dropped
      // because the queue's openRef was still set when processQueue ran.
      await dialogCancelButton.click()
      const discardDialog2 = page.locator('dialog[role="alertdialog"][open]')
      await expect(discardDialog2).toHaveCount(1, { timeout: 10_000 })

      // Confirm the discard this time. The schedule dialog MUST close.
      await page.evaluate(() => {
        const dialog = document.querySelector('dialog[role="alertdialog"][open]')
        if (!dialog) throw new Error('Second discard dialog not present in DOM')
        const buttons = Array.from(dialog.querySelectorAll('button')) as HTMLButtonElement[]
        const target = buttons.find((btn) => /^discard$/i.test((btn.textContent ?? '').trim()))
        if (!target) throw new Error('"Discard" button not found inside discard dialog')
        target.click()
      })

      // The Schedule Activity dialog should be unmounted.
      await expect(scheduleDialog).toBeHidden({ timeout: 10_000 })
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('Company create with JSON-like name does not throw useInsertionEffect warning (#1810)', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let createdCompanyId: string | null = null
    const stamp = Date.now()
    const jsonName = `{"a":1,"qa":${stamp}}`

    try {
      token = await getAuthToken(request, 'admin')

      // Collect React/console errors AND uncaught page errors. The bug in #1810
      // surfaces both as a console.error from React's hook lifecycle guard
      // and (depending on the path) as an uncaught exception that crashes
      // the page render.
      const consoleErrors: string[] = []
      const pageErrors: Error[] = []
      const onConsole = (msg: ConsoleMessage) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text())
      }
      const onPageError = (err: Error) => {
        pageErrors.push(err)
      }
      page.on('console', onConsole)
      page.on('pageerror', onPageError)

      try {
        await login(page, 'admin')
        await page.goto('/backend/customers/companies/create', {
          waitUntil: 'domcontentloaded',
        })

        // The CrudForm wraps each field in a [data-crud-field-id="<id>"]
        // container. We target the displayName field's input directly to
        // avoid coupling to an i18n label string.
        const nameInput = page
          .locator('[data-crud-field-id="displayName"] input')
          .first()
        await expect(nameInput).toBeVisible({ timeout: 30_000 })
        await nameInput.fill(jsonName)

        // CrudForm's submit label is configured via `submitLabel` — the
        // companies create page uses `customers.companies.form.submit` =
        // "Create Company". Match either that or a generic Save in case the
        // copy is changed later.
        const saveButton = page
          .getByRole('button', { name: /Create Company|Create company|^Save$/ })
          .first()
        await expect(saveButton).toBeVisible({ timeout: 15_000 })
        await saveButton.click()

        // Allow the create response to settle. The bug in #1810 surfaces
        // synchronously during the click handler / form submit, not minutes
        // later, so a short timeout is enough to capture errors.
        await page.waitForTimeout(2000)

        // Try to capture the created company id so we can clean it up. We
        // look it up by the JSON-like display name.
        const lookup = await page.request.get(
          `/api/customers/companies?search=${encodeURIComponent(jsonName)}&pageSize=5`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (lookup.ok()) {
          const body = await lookup.json().catch(() => null) as
            | { items?: Array<{ id?: string; displayName?: string }> }
            | null
          const match = (body?.items ?? []).find((row) => row?.displayName === jsonName)
          createdCompanyId = match?.id ?? null
        }

        const insertionEffectErrors = consoleErrors.filter((entry) =>
          entry.includes('useInsertionEffect must not schedule updates'),
        )
        expect(
          insertionEffectErrors,
          `Expected no React useInsertionEffect violations but got:\n${insertionEffectErrors.join('\n')}`,
        ).toHaveLength(0)

        const useConfirmDialogPageErrors = pageErrors.filter((err) =>
          (err.stack ?? err.message ?? '').includes('useConfirmDialog'),
        )
        expect(
          useConfirmDialogPageErrors.map((err) => err.message),
          `Expected no useConfirmDialog page errors but got:\n${useConfirmDialogPageErrors
            .map((err) => err.message)
            .join('\n')}`,
        ).toHaveLength(0)
      } finally {
        page.off('console', onConsole)
        page.off('pageerror', onPageError)
      }
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', createdCompanyId)
    }
  })
})
