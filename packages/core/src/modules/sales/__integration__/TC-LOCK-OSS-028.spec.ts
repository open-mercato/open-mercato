import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  expectNoConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-028 (browser UI) — sales-channel manual cases SAL-11 / SAL-12
 * (Alina's original blocker).
 *
 * Browser-driven proof that the sales-channel edit CrudForm
 * (`/backend/sales/channels/<channelId>/edit`, `ChannelOfferForm`) enforces the
 * unified optimistic lock:
 *  - SAL-11: a stale channel edit surfaces the "Record changed" conflict bar
 *    (`data-testid="record-conflict-banner"`) instead of silently overwriting.
 *  - SAL-12: a stale channel delete is refused with the same conflict bar, and
 *    the channel is NOT removed — so opening it can never land on the original
 *    broken state (an empty edit form with errors / a deleted record lingering
 *    in lists). We assert the conflict bar AND that the record still resolves
 *    via the API after the refused delete.
 *  - A clean single-tab save must not raise a false-positive conflict bar.
 *
 * Pattern: create the channel via API (unique via an epoch-millis stamp) →
 * load the edit page (the CrudForm captures `updated_at` via
 * `optimisticLockUpdatedAt`) → advance `updated_at` out-of-band with a
 * header-less API PUT (additive path, always succeeds) → edit/save or delete in
 * the browser so the now-stale `x-om-ext-optimistic-lock-expected-updated-at`
 * header triggers the 409 → conflict bar. See
 * `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`.
 *
 * The sales-channels update command requires both `id` and `code`, so the
 * out-of-band bump PUT carries them alongside `name`.
 */

const CHANNELS_API_BASE = '/api/sales/channels'

async function createChannelFixture(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  stamp: number,
  suffix: string,
): Promise<{ id: string; code: string }> {
  const code = `qa-lock-028-${suffix}-${stamp}`
  const response = await apiRequest(request, 'POST', CHANNELS_API_BASE, {
    token,
    data: { name: `QA Lock 028 ${suffix} ${stamp}`, code },
  })
  const body = (await response.json().catch(() => null)) as { id?: string; channelId?: string } | null
  expect(response.ok(), `POST ${CHANNELS_API_BASE} should succeed, got ${response.status()}`).toBeTruthy()
  const id = body?.id ?? body?.channelId ?? null
  expect(id, 'channel create response should include an id').toBeTruthy()
  return { id: id as string, code }
}

async function deleteChannelIfExists(
  request: Parameters<typeof apiRequest>[0],
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `${CHANNELS_API_BASE}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // best-effort cleanup
  }
}

async function channelStillExists(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  id: string,
): Promise<boolean> {
  const response = await apiRequest(request, 'GET', `${CHANNELS_API_BASE}?id=${encodeURIComponent(id)}&pageSize=1`, {
    token,
  })
  if (!response.ok()) return false
  const body = (await response.json().catch(() => null)) as { items?: Array<{ id?: string }> } | null
  const items = Array.isArray(body?.items) ? body!.items! : []
  return items.some((item) => item?.id === id)
}

test.describe('TC-LOCK-OSS-028: sales channel edit + broken-state delete conflict bar', () => {
  test('SAL-11: stale channel edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let channelId: string | null = null
    try {
      const created = await createChannelFixture(page.request, token, stamp, 'edit')
      channelId = created.id

      await login(page, 'admin')
      await page.goto(`/backend/sales/channels/${channelId}/edit`)

      // Form is loaded (its optimistic-lock token is captured at load time).
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 15_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, CHANNELS_API_BASE, {
        id: channelId,
        code: created.code,
        name: `QA Lock 028 edit bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 028 edit stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteChannelIfExists(page.request, token, channelId)
    }
  })

  test('SAL-12: stale channel delete is refused (conflict bar) and the channel is not removed', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let channelId: string | null = null
    try {
      const created = await createChannelFixture(page.request, token, stamp, 'del')
      channelId = created.id

      await login(page, 'admin')
      await page.goto(`/backend/sales/channels/${channelId}/edit`)

      // Wait for the form so its optimistic-lock token is captured at load time.
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 15_000 })

      // Advance updated_at out-of-band → the loaded form now holds a stale token.
      await bumpRecordViaApi(page.request, token, CHANNELS_API_BASE, {
        id: channelId,
        code: created.code,
        name: `QA Lock 028 del bumped ${stamp}`,
      })

      // Trigger delete from the form → confirm dialog → stale DELETE header → 409.
      await page.getByRole('button', { name: /delete/i }).first().click()
      const confirmDialog = page.getByRole('alertdialog')
      await expect(confirmDialog).toBeVisible({ timeout: 10_000 })
      await confirmDialog.getByRole('button', { name: /confirm|delete/i }).first().click()

      await expectConflictBanner(page)

      // SAL-12 guard: the stale delete was refused, so the channel must still
      // resolve — the broken "deleted record lingering / empty form" state
      // cannot occur.
      expect(
        await channelStillExists(page.request, token, channelId),
        'a refused stale delete must leave the channel intact',
      ).toBe(true)
    } finally {
      await deleteChannelIfExists(page.request, token, channelId)
    }
  })

  test('clean single-tab channel save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let channelId: string | null = null
    try {
      const created = await createChannelFixture(page.request, token, stamp, 'clean')
      channelId = created.id

      await login(page, 'admin')
      await page.goto(`/backend/sales/channels/${channelId}/edit`)

      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 15_000 })

      const putPromise = page.waitForResponse(
        (response) => response.request().method() === 'PUT' && response.url().includes(CHANNELS_API_BASE),
        { timeout: 15_000 },
      )
      await fillControlledInput(nameInput, `QA Lock 028 clean saved ${stamp}`)
      await nameInput.press('Control+Enter')
      const settled = await putPromise
      expect(settled.status(), 'clean save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteChannelIfExists(page.request, token, channelId)
    }
  })
})
