import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { expectConflictBanner } from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'

/**
 * TC-LOCK-OSS-047: Saved table Views (perspectives) — a stale save surfaces the
 * unified conflict bar WITHOUT leaking the raw `record_modified` token into the
 * Views panel (issue #11 / PR #2055).
 *
 * The `PerspectiveSidebar` catch blocks used to `setError(err.message)` on a
 * failed save. For an OSS optimistic-lock 409 the thrown error's `message` is
 * the raw server token `record_modified` (normalized from the body `error`
 * field), which then rendered as visible text inside the panel — in addition to
 * the correct unified `record-conflict-banner`. The fix routes the 409 through
 * `surfaceRecordConflict` so only the unified bar shows and the raw token is
 * never rendered.
 *
 * Deterministic conflict without two tabs: create a personal view in the UI
 * (the panel now holds its fresh `updatedAt`), advance the view's `updatedAt`
 * out-of-band via a direct API POST, then rename the view in the UI. The panel's
 * now-stale lock header triggers the 409.
 *
 * Requires `OM_OPTIMISTIC_LOCK=all` (CI default).
 */

const PERSPECTIVES_TABLE_ID = 'customers.people.list'
const RAW_CONFLICT_TOKEN = 'record_modified'

type PerspectiveDto = { id: string; name: string; settings?: unknown; updatedAt?: string }
type PerspectivesState = { perspectives?: PerspectiveDto[] }

async function loadPersonalView(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  name: string,
): Promise<PerspectiveDto> {
  const res = await apiRequest(request, 'GET', `/api/perspectives/${PERSPECTIVES_TABLE_ID}`, { token })
  expect(res.status(), 'GET perspectives should return 200').toBe(200)
  const body = (await res.json()) as PerspectivesState
  const view = (body.perspectives ?? []).find((p) => p.name.trim() === name)
  expect(view, `created view "${name}" should be returned by the perspectives API`).toBeTruthy()
  return view as PerspectiveDto
}

test.describe('TC-LOCK-OSS-047: saved Views conflict bar does not leak record_modified', () => {
  test('stale rename surfaces the unified conflict bar and never renders the raw token', async ({ page, request }) => {
    test.slow()

    const stamp = Date.now()
    const viewName = `QA Lock 047 ${stamp}`
    const token = await getAuthToken(request, 'admin')
    let createdViewId: string | null = null

    try {
      await login(page, 'admin')
      await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' })
      await page
        .getByText('Loading table', { exact: false })
        .waitFor({ state: 'hidden', timeout: 10_000 })
        .catch(() => {})

      // Open the Views panel.
      const openViews = page.getByTestId('data-table-open-views-sidebar').first()
      await expect(openViews).toBeVisible()
      await openViews.click()
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible()

      // Create a personal saved view.
      await page.getByRole('button', { name: 'New', exact: true }).click()
      await page.getByPlaceholder('View name...').fill(viewName)
      await page.getByRole('button', { name: 'Create view' }).click()

      // The new chip should appear; the panel now holds the view's fresh updatedAt.
      const viewChipButton = page.getByRole('button', { name: viewName, exact: true })
      await expect(viewChipButton).toBeVisible({ timeout: 10_000 })

      // Advance the view's updatedAt out-of-band so the panel's loaded header is stale.
      const view = await loadPersonalView(request, token, viewName)
      createdViewId = view.id
      const bump = await apiRequest(request, 'POST', `/api/perspectives/${PERSPECTIVES_TABLE_ID}`, {
        token,
        data: {
          perspectiveId: view.id,
          name: viewName,
          settings: view.settings ?? {},
          isDefault: false,
          applyToRoles: [],
          setRoleDefault: false,
        },
      })
      expect(bump.status(), 'out-of-band POST should bump updatedAt').toBeLessThan(300)

      // Rename the view in the UI — this is the save that now carries a stale lock header.
      await viewChipButton.hover()
      await page
        .locator('div')
        .filter({ has: viewChipButton })
        .first()
        .getByRole('button')
        .last()
        .click()
      await page.getByRole('menuitem', { name: /rename/i }).click()

      const renameInput = page.locator('input[value="' + viewName + '"]')
      await expect(renameInput).toBeVisible()
      await renameInput.fill(`${viewName} edited`)
      await page.getByRole('button', { name: 'Confirm rename' }).click()

      // The unified conflict bar must appear.
      await expectConflictBanner(page)

      // The raw token must NOT leak as visible text anywhere on the page (issue #11).
      await expect(
        page.getByText(RAW_CONFLICT_TOKEN, { exact: false }),
        'the raw "record_modified" token must never be rendered to the user',
      ).toHaveCount(0)
    } finally {
      if (createdViewId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/perspectives/${PERSPECTIVES_TABLE_ID}/${createdViewId}`,
          { token },
        ).catch(() => undefined)
      }
    }
  })
})
