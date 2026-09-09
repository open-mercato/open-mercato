import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  bumpRecordViaApi,
  clickConflictRefresh,
  expectConflictBanner,
  expectConflictBody,
  expectNoConflictBanner,
  putWithLock,
  readUpdatedAt,
  resolveApiUrl,
} from '@open-mercato/core/helpers/integration/optimisticLockUi'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

const TODOS_API = '/api/example/todos'

/**
 * Milestone B coverage for the shared form and its complete optimistic-locking contract.
 *
 * `components/TodoForm.tsx` is one component behind two routes — create and edit — so the
 * interesting property is not that either works but that the shared form carries the lock
 * header on the edit path and cannot on the create path, where there is no version to send.
 * The three assertions below are the ones a regression would break independently: the API's
 * 409 body, the browser's conflict surface for a stale save, and a stale delete, which is the
 * case a naive implementation forgets because the form sends no field values with it.
 */
test.describe('TC-EXAMPLE-011: the shared todo form round-trips and refuses stale writes', () => {
  test('creates, edits and clears an optional value through both routes of the shared form', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const title = `TC-EXAMPLE-011 ${suffix}`
    let todoId: string | null = null

    try {
      await login(page, 'admin')
      await page.goto('/backend/todos/create', { waitUntil: 'commit' })

      const titleInput = page.locator('[data-crud-field-id="title"] input').first()
      await expect(titleInput).toBeVisible()
      // The example injection widget mounts into this form asynchronously and is tall enough to
      // move everything below it. Opening the severity select before it lands lets Radix anchor
      // the listbox to a trigger position the late mount then shifts, stranding the portal
      // outside the viewport: the option resolves and reports visible/enabled/stable, so
      // Playwright retries the click for the whole 60s budget instead of failing on anything
      // diagnosable. Let the form settle first, exactly as TC-EXAMPLE-017 does on this host.
      await expect(page.getByText('Example Injection Widget')).toBeVisible({ timeout: 20_000 })
      const priorityInput = page.locator('[data-crud-field-id="cf_priority"] input[type="number"]').first()
      await priorityInput.fill('3')
      const severitySelect = page.locator('[data-crud-field-id="cf_severity"]').getByRole('combobox').first()
      await severitySelect.click()
      const severityOption = page.getByRole('option', { name: 'Medium' })
      // Bounded, and it names the real problem: if the listbox is ever stranded again this fails
      // in seconds with "not in viewport" rather than hanging until the test timeout.
      await expect(severityOption).toBeInViewport({ timeout: 10_000 })
      await severityOption.click()
      await titleInput.fill(title)
      await expect(titleInput).toHaveValue(title)

      const form = titleInput.locator('xpath=ancestor::form').first()
      await form.locator('button[type="submit"]').first().click()
      await expect(page).toHaveURL(/\/backend\/todos(?:\?.*)?$/)
      await expectNoConflictBanner(page)

      const list = await apiRequest(request, 'GET', `${TODOS_API}?page=1&pageSize=100&sortField=createdAt&sortDir=desc`, { token })
      expect(list.ok()).toBeTruthy()
      const listed = ((await list.json()) as { items?: Array<{ id?: string; title?: string }> }).items ?? []
      todoId = listed.find((item) => item.title === title)?.id ?? null
      expect(todoId, 'the created todo must be listed').toBeTruthy()

      // The same component on the edit route hydrates the record and saves cleanly, which is
      // the single-tab path that must never produce a false-positive conflict.
      await page.goto(`/backend/todos/${encodeURIComponent(todoId!)}/edit`, { waitUntil: 'commit' })
      const editTitle = page.locator('[data-crud-field-id="title"] input').first()
      await expect(editTitle).toHaveValue(title)
      await editTitle.fill(`${title} edited`)
      await page.locator('[data-crud-field-id="title"]').first()
        .locator('xpath=ancestor::form').first()
        .locator('button[type="submit"]').first()
        .click()
      await expect(page).toHaveURL(/\/backend\/todos(?:\?.*)?$/)
      await expectNoConflictBanner(page)

      const reread = await apiRequest(request, 'GET', `${TODOS_API}?ids=${encodeURIComponent(todoId!)}&page=1&pageSize=1`, { token })
      const rereadBody = (await reread.json()) as { items?: Array<{ title?: string }> }
      expect(rereadBody.items?.[0]?.title).toBe(`${title} edited`)
    } finally {
      await deleteEntityIfExists(request, token, TODOS_API, todoId)
    }
  })

  test('refuses a stale update and a stale delete with the documented conflict body', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const title = `TC-EXAMPLE-011 lock ${suffix}`
    let todoId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', TODOS_API, {
        token,
        data: { title, cf_priority: 2, cf_severity: 'low' },
      })
      expect(created.ok(), `create todo failed: ${created.status()}`).toBeTruthy()
      todoId = (await created.json() as { id?: string }).id ?? null
      expect(todoId).toBeTruthy()

      const staleVersion = await readUpdatedAt(request, token, TODOS_API, todoId!)
      await bumpRecordViaApi(request, token, TODOS_API, { id: todoId, title: `${title} bumped` })
      const freshVersion = await readUpdatedAt(request, token, TODOS_API, todoId!)
      expect(freshVersion).not.toBe(staleVersion)

      const staleUpdate = await putWithLock(
        request,
        token,
        TODOS_API,
        { id: todoId, title: `${title} stale` },
        staleVersion,
      )
      const conflict = await expectConflictBody(staleUpdate)
      expect(conflict.currentUpdatedAt).toBeTruthy()

      // The write must not have landed: a refused save that still mutated would be worse than
      // no locking at all.
      const afterConflict = await apiRequest(request, 'GET', `${TODOS_API}?ids=${encodeURIComponent(todoId!)}&page=1&pageSize=1`, { token })
      const afterBody = (await afterConflict.json()) as { items?: Array<{ title?: string }> }
      expect(afterBody.items?.[0]?.title).toBe(`${title} bumped`)

      // Delete carries the same header and the same refusal. This is the branch a form-only
      // implementation misses, because a delete submits no field values.
      const staleDelete = await request.fetch(
        resolveApiUrl(TODOS_API),
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            [OPTIMISTIC_LOCK_HEADER_NAME]: staleVersion,
          },
          data: { id: todoId },
        },
      )
      expect(staleDelete.status(), 'a stale delete must be refused like a stale update').toBe(409)

      const stillThere = await apiRequest(request, 'GET', `${TODOS_API}?ids=${encodeURIComponent(todoId!)}&page=1&pageSize=1`, { token })
      const stillBody = (await stillThere.json()) as { items?: Array<unknown> }
      expect(stillBody.items?.length, 'a refused delete must leave the record in place').toBe(1)
    } finally {
      await deleteEntityIfExists(request, token, TODOS_API, todoId)
    }
  })

  test('surfaces a conflict in the browser when the record moved under an open edit form', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const title = `TC-EXAMPLE-011 ui ${suffix}`
    let todoId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', TODOS_API, {
        token,
        data: { title, cf_priority: 2, cf_severity: 'low' },
      })
      expect(created.ok()).toBeTruthy()
      todoId = (await created.json() as { id?: string }).id ?? null
      expect(todoId).toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/todos/${encodeURIComponent(todoId!)}/edit`, { waitUntil: 'commit' })
      const titleInput = page.locator('[data-crud-field-id="title"] input').first()
      await expect(titleInput).toHaveValue(title)

      // The form now holds a version that is about to go stale.
      await bumpRecordViaApi(request, token, TODOS_API, { id: todoId, title: `${title} moved` })

      await titleInput.fill(`${title} from the browser`)
      await page.locator('[data-crud-field-id="title"]').first()
        .locator('xpath=ancestor::form').first()
        .locator('button[type="submit"]').first()
        .click()

      await expectConflictBanner(page)
      // The refused save must leave the out-of-band value in place.
      const reread = await apiRequest(request, 'GET', `${TODOS_API}?ids=${encodeURIComponent(todoId!)}&page=1&pageSize=1`, { token })
      const rereadBody = (await reread.json()) as { items?: Array<{ title?: string }> }
      expect(rereadBody.items?.[0]?.title).toBe(`${title} moved`)

      const enterpriseDialog = page.getByTestId('record-lock-conflict-dialog')
      if (await enterpriseDialog.isVisible().catch(() => false)) {
        await enterpriseDialog.getByRole('button', { name: /accept incoming/i }).click()
      } else {
        await clickConflictRefresh(page)
      }
      await expect(titleInput).toHaveValue(`${title} moved`, { timeout: 20_000 })

      const retriedTitle = `${title} retried`
      await titleInput.fill(retriedTitle)
      await titleInput.locator('xpath=ancestor::form').first().locator('button[type="submit"]').first().click()
      await expect(page).toHaveURL(/\/backend\/todos(?:\?.*)?$/)
      await expectNoConflictBanner(page)

      const afterRetry = await apiRequest(request, 'GET', `${TODOS_API}?ids=${encodeURIComponent(todoId!)}&page=1&pageSize=1`, { token })
      const afterRetryBody = (await afterRetry.json()) as { items?: Array<{ title?: string }> }
      expect(afterRetryBody.items?.[0]?.title).toBe(retriedTitle)
    } finally {
      await deleteEntityIfExists(request, token, TODOS_API, todoId)
    }
  })
})
