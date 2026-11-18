import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import type { FlashRaceHarness } from './flash-race/harnessApp'
import {
  startFlashRaceHarnessServer,
  type FlashRaceHarnessServer,
} from './flash-race/startFlashRaceHarnessServer'

declare global {
  interface Window {
    __flashRaceHarness?: FlashRaceHarness
  }
}

async function runLateSecondaryRace(
  page: Page,
  message: string,
  keepValue: string,
): Promise<void> {
  await page.evaluate(
    ({ message: flashMessage, keepValue: keep }) => {
      const url = new URL(window.location.href)
      url.search = ''
      url.hash = ''
      url.searchParams.set('flash', flashMessage)
      url.searchParams.set('type', 'success')
      url.searchParams.set('keep', keep)
      window.__flashRaceHarness!.navigate(`${url.pathname}?${url.searchParams.toString()}#frag-${keep}`)
      // Mounting the secondary host in the same synchronous turn as the URL
      // update reproduces the race from #8471/#8709: the secondary's own
      // mount-time effect observes the just-written URL before the primary
      // host's deferred navigation-observer effect (scheduled off the
      // monkey-patched `pushState`) has had a chance to run.
      window.__flashRaceHarness!.mountSecondary()
    },
    { message, keepValue },
  )
}

/**
 * TC-UI-FLASH-001: regression for #8471/#8685, automated per #8709.
 *
 * #8685 fixed a swallowed-toast bug by gating FlashMessages' URL-reading
 * effect on `isPrimaryHost`, so only the first-mounted host ever consumes
 * `?flash=`. The existing jsdom/RTL regression in `FlashMessages.test.tsx`
 * covers that fix at the unit level. This spec automates the same
 * late-secondary-mount race in a real browser, as requested in the
 * #8685 follow-up QA comment and tracked by #8709.
 *
 * The two-host harness mounts the real `FlashMessages` component (not a
 * stand-in) via a throwaway esbuild bundle served outside both
 * `apps/mercato` and this package's shipped `src/`/`dist` output — see
 * `flash-race/startFlashRaceHarnessServer.ts`.
 */
test.describe('TC-UI-FLASH-001: FlashMessages late-secondary URL flash race (browser)', () => {
  let harness: FlashRaceHarnessServer

  test.beforeAll(async () => {
    harness = await startFlashRaceHarnessServer()
  })

  test.afterAll(async () => {
    await harness.close()
  })

  test('shows exactly one toast via the primary host across ten late-secondary races, then expires after 3s', async ({ page }) => {
    test.slow()

    await page.goto(harness.url)
    await page.waitForFunction(() => Boolean(window.__flashRaceHarness))

    const attempts = 10
    let lastMessage = ''

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const message = `Race flash ${attempt}`
      const keep = `k${attempt}`
      lastMessage = message

      await runLateSecondaryRace(page, message, keep)

      const toasts = page.locator('[data-slot="alert"]')
      await expect(toasts).toHaveCount(1)
      await expect(toasts.first()).toContainText(message)

      // The toast only renders after the same effect that strips `flash`/
      // `type` and rewrites the URL, so by this point the rewrite is done.
      const currentUrl = page.url()
      expect(currentUrl).not.toContain('flash=')
      expect(currentUrl).not.toContain('type=')
      expect(currentUrl).toContain(`keep=${keep}`)
      expect(currentUrl.endsWith(`#frag-${keep}`)).toBe(true)

      // Unmount the secondary before the next iteration so the following
      // race exercises a genuinely fresh "late" mount, not a no-op update.
      await page.evaluate(() => window.__flashRaceHarness!.unmountSecondary())
    }

    // Verify the real 3-second auto-dismiss on the last delivered toast —
    // checked once (not on every attempt) to keep the spec's wall-clock
    // cost bounded.
    await page.waitForTimeout(3_100)
    await expect(page.getByText(lastMessage)).toHaveCount(0)
  })
})

/**
 * TC-UI-FLASH-002: companion to TC-UI-FLASH-001 — exercises the same
 * primary-host flash delivery through a real tenant-bound record and the
 * product's actual production CrudForm save redirect, per #8709's
 * acceptance criteria, rather than the synthetic harness above.
 */
test.describe('TC-UI-FLASH-002: FlashMessages real production save redirect', () => {
  test('shows exactly one "Todo saved" toast and strips the URL after a real edit/save redirect', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const title = `QA flash redirect ${Date.now()}`
    let todoId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', '/api/example/todos', {
        token,
        // `cf_priority`/`cf_severity` are required custom fields on the Todo
        // entity (apps/mercato/src/modules/example/ce.ts) — the API does not
        // backfill their `defaultValue` on create, so omitting them here
        // leaves the edit form's required-field validation blocking every
        // save silently (no navigation, no error toast).
        data: { title, cf_priority: 3, cf_severity: 'medium' },
      })
      expect(created.ok(), `Failed to create todo fixture: ${created.status()}`).toBeTruthy()
      const createdBody = (await created.json()) as { id?: string }
      todoId = createdBody.id ?? null
      expect(todoId).toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/todos/${encodeURIComponent(todoId!)}/edit`, { waitUntil: 'commit' })

      const titleInput = page.locator('[data-crud-field-id="title"] input').first()
      await expect(titleInput).toHaveValue(title)
      await titleInput.fill(`${title} edited`)

      const saveForm = page.locator('[data-crud-field-id="title"]').first().locator('xpath=ancestor::form').first()
      await saveForm.locator('button[type="submit"]').first().click()

      await expect(page).toHaveURL(/\/backend\/todos(?:\?.*)?$/)

      const toasts = page.locator('[data-slot="alert"]')
      await expect(toasts).toHaveCount(1)
      await expect(toasts.first()).toContainText('Todo saved')

      const currentUrl = page.url()
      expect(currentUrl).not.toContain('flash=')
      expect(currentUrl).not.toContain('type=')
    } finally {
      await deleteEntityIfExists(request, token, '/api/example/todos', todoId)
    }
  })
})
