import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import {
  putWithLock,
  expectConflictBody,
  expectConflictBanner,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-043 — webhooks + inbox settings + data-sync schedule
 * optimistic-lock conflict contract (WHK-01, INB-01, SYNC-01).
 *
 * All three surfaces guard writes with `enforceCommandOptimisticLock` inside
 * pure command/API routes — none expose a dedicated `data-crud-field-id`
 * CrudForm edit page for the locked record, so the conflict contract is proven
 * at the API level: capture the record's `updated_at`, advance it out-of-band
 * via a header-less write (the strictly-additive path always succeeds and bumps
 * `updated_at`), then replay the now-stale write with the original
 * expected-version header → 409 `optimistic_lock_conflict`.
 *
 *  - WHK-01: `PUT /api/webhooks/<id>` and `DELETE /api/webhooks/<id>`
 *    (`packages/webhooks/src/modules/webhooks/api/webhooks/[id]/route.ts`,
 *    `resourceKind: 'webhooks.endpoint'`).
 *  - INB-01: `PATCH /api/inbox_ops/settings`
 *    (`packages/core/src/modules/inbox_ops/api/settings/route.ts`,
 *    `resourceKind: 'inbox_ops.settings'`). The settings row is a per-tenant
 *    singleton, so the test bumps + restores `workingLanguage` instead of
 *    creating/deleting a fixture.
 *  - SYNC-01: `POST /api/data_sync/schedules`
 *    (`packages/core/src/modules/data_sync/api/schedules/route.ts` →
 *    `SyncScheduleService.saveSchedule`, `resourceKind: 'data_sync.schedule'`).
 *    The collection POST reads the expected-version header; the service enforces
 *    the lock when a row with the same (integrationId, entityType, direction)
 *    key already exists.
 */

const WEBHOOKS_API = '/api/webhooks'
const INBOX_SETTINGS_API = '/api/inbox_ops/settings'
const SCHEDULES_API = '/api/data_sync/schedules'

type InboxSettings = { id: string; workingLanguage: string; updatedAt: string }

async function createWebhook(
  request: APIRequestContext,
  token: string,
  stamp: number,
): Promise<{ id: string; updatedAt: string }> {
  const created = await apiRequest(request, 'POST', WEBHOOKS_API, {
    token,
    data: {
      name: `QA Lock 043 ${stamp}`,
      url: `https://example.com/qa-lock-043-${stamp}`,
      subscribedEvents: ['qa.lock.test'],
    },
  })
  expect(created.status(), 'POST webhook should be 201').toBe(201)
  const body = (await created.json()) as { id?: string }
  expect(typeof body.id, 'webhook creation should return an id').toBe('string')
  const detail = await apiRequest(request, 'GET', `${WEBHOOKS_API}/${body.id}`, { token })
  expect(detail.status(), 'GET webhook detail should be 200').toBe(200)
  const detailBody = (await detail.json()) as { updatedAt?: string }
  expect(typeof detailBody.updatedAt, 'webhook should expose updatedAt').toBe('string')
  return { id: body.id as string, updatedAt: detailBody.updatedAt as string }
}

async function readWebhookUpdatedAt(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<string> {
  const detail = await apiRequest(request, 'GET', `${WEBHOOKS_API}/${id}`, { token })
  expect(detail.status(), 'GET webhook detail should be 200').toBe(200)
  const body = (await detail.json()) as { updatedAt?: string }
  return body.updatedAt as string
}

async function deleteWebhook(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<void> {
  const current = await readWebhookUpdatedAt(request, token, id).catch(() => undefined)
  await request
    .fetch(resolveApiUrl(`${WEBHOOKS_API}/${id}`), {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(current ? { [OPTIMISTIC_LOCK_HEADER_NAME]: current } : {}),
      },
    })
    .catch(() => undefined)
}

async function patchInboxSettings(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
  lockValue?: string,
) {
  return request.fetch(resolveApiUrl(INBOX_SETTINGS_API), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(lockValue !== undefined ? { [OPTIMISTIC_LOCK_HEADER_NAME]: lockValue } : {}),
    },
    data: body,
  })
}

async function readInboxSettings(
  request: APIRequestContext,
  token: string,
): Promise<InboxSettings> {
  const response = await apiRequest(request, 'GET', INBOX_SETTINGS_API, { token })
  expect(response.status(), 'GET inbox settings should be 200').toBe(200)
  const body = (await response.json()) as { settings?: InboxSettings | null }
  expect(body.settings, 'tenant inbox settings singleton should exist').toBeTruthy()
  return body.settings as InboxSettings
}

async function postSchedule(
  request: APIRequestContext,
  token: string,
  scheduleValue: string,
  integrationId: string,
  lockValue?: string,
) {
  return request.fetch(resolveApiUrl(SCHEDULES_API), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(lockValue !== undefined ? { [OPTIMISTIC_LOCK_HEADER_NAME]: lockValue } : {}),
    },
    data: {
      integrationId,
      entityType: 'products',
      direction: 'import',
      scheduleType: 'cron',
      scheduleValue,
      timezone: 'UTC',
      fullSync: false,
      isEnabled: true,
    },
  })
}

test.describe('TC-LOCK-OSS-043: webhooks + inbox settings + data-sync schedule optimistic lock', () => {
  test('WHK-01 stale webhook PUT is refused with a 409 conflict', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let webhookId: string | null = null
    try {
      const webhook = await createWebhook(page.request, token, stamp)
      webhookId = webhook.id
      const staleUpdatedAt = webhook.updatedAt

      // Advance updated_at out-of-band via a header-less PUT.
      const bump = await apiRequest(page.request, 'PUT', `${WEBHOOKS_API}/${webhookId}`, {
        token,
        data: { name: `QA Lock 043 bumped ${stamp}` },
      })
      expect(bump.status(), 'out-of-band webhook PUT should succeed').toBeLessThan(300)

      // Replay the now-stale write → 409.
      const conflict = await putWithLock(
        page.request,
        token,
        `${WEBHOOKS_API}/${webhookId}`,
        { name: `QA Lock 043 stale ${stamp}` },
        staleUpdatedAt,
      )
      await expectConflictBody(conflict)
    } finally {
      if (webhookId) await deleteWebhook(page.request, token, webhookId)
    }
  })

  test('WHK-01 stale webhook DELETE is refused with a 409 conflict', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let webhookId: string | null = null
    try {
      const webhook = await createWebhook(page.request, token, stamp)
      webhookId = webhook.id
      const staleUpdatedAt = webhook.updatedAt

      const bump = await apiRequest(page.request, 'PUT', `${WEBHOOKS_API}/${webhookId}`, {
        token,
        data: { name: `QA Lock 043 bumped ${stamp}` },
      })
      expect(bump.status(), 'out-of-band webhook PUT should succeed').toBeLessThan(300)

      const conflict = await page.request.fetch(resolveApiUrl(`${WEBHOOKS_API}/${webhookId}`), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: staleUpdatedAt,
        },
      })
      await expectConflictBody(conflict)
    } finally {
      if (webhookId) await deleteWebhook(page.request, token, webhookId)
    }
  })

  // WHK-01 (browser UI): now ACTIVE. The product fix is committed/verified — the webhooks
  // server DELETE returns the structured 409 (proven by the active "WHK-01 stale webhook
  // DELETE is refused with a 409" API test) and the list page sends the lock header
  // (`buildOptimisticLockHeader(row.updatedAt)`) + routes the resulting 409 through
  // surfaceRecordConflict. The RowActions menu opens on CLICK of the "Open actions" kebab and
  // renders the items in a portal on document.body (role="menuitem"); the confirm dialog is a
  // role="alertdialog" with a "Confirm" button. We drive that choreography robustly here:
  // wait for the filtered list GET to settle, open the kebab, click Delete, confirm, then
  // assert the unified conflict bar (never the success toast).
  test('WHK-01 stale webhook DELETE in the list surfaces the conflict bar', async ({ page }) => {
    // Heavy browser flow (login + list load + portalled RowActions menu) routinely
    // exceeds Playwright's 20s default on a loaded ephemeral shard; opt into the
    // sanctioned per-test budget (see TC-LOCK-OSS-029). Global bump is disallowed.
    test.setTimeout(60_000)
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let webhookId: string | null = null
    try {
      const webhook = await createWebhook(page.request, token, stamp)
      webhookId = webhook.id

      await login(page, 'admin')
      await page.goto('/backend/webhooks')
      // Wait for the list GET to settle before interacting. The list reflects the
      // freshly created fixture immediately (newest-first), so a unique name makes
      // the row unambiguous.
      await page
        .waitForResponse(
          (response) =>
            response.url().includes('/api/webhooks') &&
            response.request().method() === 'GET' &&
            response.ok(),
          { timeout: 20_000 },
        )
        .catch(() => undefined)

      // The out-of-band PUT below renames the fixture to "QA Lock 043 bumped <stamp>";
      // tolerate both names so a mid-test list re-render cannot orphan the row locator.
      const row = page
        .getByRole('row', { name: new RegExp(`QA Lock 043 (?:bumped )?${stamp}\\b`) })
        .first()
      await expect(row, 'created webhook should appear in the list').toBeVisible({ timeout: 20_000 })

      // Advance updated_at out-of-band → the in-page row token is now stale.
      // NOTE: bump description (not name) so the row locator stays valid even if
      // the list re-fetches after the PUT.
      const bump = await apiRequest(page.request, 'PUT', `${WEBHOOKS_API}/${webhookId}`, {
        token,
        data: { description: `bumped-${stamp}` },
      })
      expect(bump.status(), 'out-of-band webhook PUT should succeed').toBeLessThan(300)

      // Open the row's RowActions kebab (opens on click) and trigger Delete. The
      // menu renders in a portal on document.body, so query it at the page level.
      // The list re-renders as data settles, so the menu can detach between "open"
      // and "click" — retry (re)open-menu + click-Delete atomically (same fix as
      // TC-LOCK-OSS-029); the confirm dialog gates the DELETE, so a repeated
      // click is safe.
      const kebab = row.getByRole('button', { name: /open actions/i })
      const deleteItem = page.getByRole('menuitem', { name: /^delete$/i })
      await expect(async () => {
        if (!(await deleteItem.isVisible().catch(() => false))) {
          await kebab.click({ timeout: 2_000 }).catch(() => {})
          await expect(deleteItem).toBeVisible({ timeout: 1_500 })
        }
        await deleteItem.click({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })

      // Confirm the destructive alertdialog (the row still holds the stale
      // updated_at captured at render time, so the DELETE 409s).
      const dialog = page.getByRole('alertdialog')
      await expect(dialog, 'confirm dialog should open').toBeVisible({ timeout: 10_000 })
      await dialog.getByRole('button', { name: /^(confirm|delete)$/i }).click()

      // The client must route the 409 to the unified conflict bar, never the
      // success toast. This list-row flow (portalled RowActions + confirm dialog +
      // guarded-mutation conflict pipeline) renders the bar more slowly under a
      // loaded CI shard than an in-form save, so allow a larger surfacing budget
      // than the 10s default to remove the historic flake.
      await expectConflictBanner(page, { timeout: 20_000 })
    } finally {
      if (webhookId) await deleteWebhook(page.request, token, webhookId)
    }
  })

  test('INB-01 stale inbox-settings PATCH is refused with a 409 conflict', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const before = await readInboxSettings(page.request, token)
    const originalLanguage = before.workingLanguage
    const staleUpdatedAt = before.updatedAt
    const bumpLanguage = originalLanguage === 'de' ? 'en' : 'de'
    const staleLanguage = originalLanguage === 'es' ? 'pl' : 'es'
    try {
      // Advance updated_at out-of-band via a header-less PATCH.
      const bump = await patchInboxSettings(page.request, token, { workingLanguage: bumpLanguage })
      expect(bump.status(), 'out-of-band inbox PATCH should succeed').toBeLessThan(300)

      // Replay the now-stale write with the original expected-version → 409.
      const conflict = await patchInboxSettings(
        page.request,
        token,
        { workingLanguage: staleLanguage },
        staleUpdatedAt,
      )
      await expectConflictBody(conflict)
    } finally {
      // Restore the original working language with a fresh lock token.
      const current = await readInboxSettings(page.request, token).catch(() => null)
      if (current) {
        await patchInboxSettings(
          page.request,
          token,
          { workingLanguage: originalLanguage },
          current.updatedAt,
        ).catch(() => undefined)
      }
    }
  })

  test('SYNC-01 stale data-sync schedule save is refused with a 409 conflict', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const integrationId = `qa-lock-043-${stamp}`
    let scheduleId: string | null = null
    try {
      const created = await postSchedule(page.request, token, '0 * * * *', integrationId)
      expect(created.status(), 'POST schedule should be 201').toBe(201)
      const createdBody = (await created.json()) as { id?: string; updatedAt?: string }
      scheduleId = createdBody.id ?? null
      const staleUpdatedAt = createdBody.updatedAt
      expect(typeof scheduleId, 'schedule creation should return an id').toBe('string')
      expect(typeof staleUpdatedAt, 'schedule should expose updatedAt').toBe('string')

      // Advance updated_at out-of-band via the header-less [id] PUT route.
      const bump = await apiRequest(page.request, 'PUT', `${SCHEDULES_API}/${scheduleId}`, {
        token,
        data: { scheduleValue: '5 * * * *' },
      })
      expect(bump.status(), 'out-of-band schedule PUT should succeed').toBeLessThan(300)

      // Replay the save for the same (integrationId, entityType, direction) key
      // with the now-stale expected-version → 409.
      const conflict = await postSchedule(
        page.request,
        token,
        '9 * * * *',
        integrationId,
        staleUpdatedAt as string,
      )
      await expectConflictBody(conflict)
    } finally {
      if (scheduleId) {
        await apiRequest(page.request, 'DELETE', `${SCHEDULES_API}/${scheduleId}`, { token }).catch(
          () => undefined,
        )
      }
    }
  })
})
