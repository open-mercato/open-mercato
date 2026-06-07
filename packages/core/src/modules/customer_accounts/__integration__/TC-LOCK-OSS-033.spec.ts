import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
// `expectConflictBanner` asserts the conflict bar surfaced by the now-active
// browser edit case below.
import {
  expectConflictBanner,
  expectConflictBody,
  putWithLock,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-033 (browser UI + API fallback) — manual case AUTH-07.
 *
 * OSS optimistic locking on the customer_accounts portal-role ADMIN routes
 * (PR #2055). `/api/customer_accounts/admin/roles/[id]` is a CUSTOM route (id in
 * the URL path, not a `makeCrudRoute`). PUT and DELETE both call
 * `enforceCommandOptimisticLock` and bump `updated_at` on every write, so two
 * admins editing the same portal role in parallel cannot silently clobber each
 * other.
 *
 * The edit page `/backend/customer_accounts/roles/<id>` is a `CrudForm`
 * (`optimisticLockUpdatedAt={data.updatedAt}`, field id `name`); SAVE is
 * Control+Enter. DELETE on the page goes through the form's `onDelete`
 * (header-scoped DELETE).
 *
 * This spec proves:
 *   - API: a stale DELETE/PUT returns the structured 409 conflict body, and a
 *     fresh-header DELETE succeeds — the server-side guard is real (matching the
 *     command-route fallback pattern in TC-LOCK-OSS-043 / TC-LOCK-OSS-013).
 *
 * UI surface (now FIXED — server enforcement was always correct):
 * The browser edit case below is ACTIVE. The server enforces the lock (the API
 * DELETE/PUT cases get a real 409, never a silent 200), and the edit page
 * `backend/customer_accounts/roles/[id]/page.tsx` now routes that 409 to the
 * unified conflict bar. Its `handleSubmit` calls
 * `surfaceRecordConflict({ status: roleCall.status, body: roleCall.result }, t)`
 * on a non-ok `roleCall` (fix from commit bae74923e), so
 * `data-testid="record-conflict-banner"` appears when the in-form
 * optimistic-lock token is stale. Previously the page downgraded the 409 to a
 * generic toast; that bug is gone.
 *
 * Deterministic pattern (no two real tabs / sleeps): create a role via API,
 * establish a non-null `updated_at` with one header-less PUT, load the edit page
 * (the form captures that token), advance `updated_at` out-of-band via another
 * header-less PUT, then edit + Control+Enter so the now-stale header → 409 → bar.
 *
 * Requires `OM_OPTIMISTIC_LOCK=all` (CI default).
 */

const ROLES_API = '/api/customer_accounts/admin/roles'

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function createRole(
  request: APIRequestContext,
  token: string,
  stamp: number,
): Promise<string> {
  const res = await request.fetch(resolveApiUrl(ROLES_API), {
    method: 'POST',
    headers: authHeaders(token),
    data: {
      name: `QA Lock 033 ${stamp}`,
      slug: `qa-lock-033-${stamp}`,
      description: 'AUTH-07 portal role lock fixture',
    },
  })
  expect(res.status(), 'portal role should be created').toBe(201)
  const id = ((await res.json()) as { role?: { id?: string } }).role?.id ?? null
  expect(id, 'created role id should be returned').toBeTruthy()
  return id as string
}

/**
 * Path-based header-less PUT (the strictly-additive path always succeeds and
 * bumps `updated_at`). The admin roles route takes the id in the URL, so the
 * shared `bumpRecordViaApi` (id-in-body, list-route) does not apply here.
 * Returns the new ISO `updatedAt` read back from the detail GET.
 */
async function bumpRole(
  request: APIRequestContext,
  token: string,
  id: string,
  name: string,
): Promise<string> {
  const put = await request.fetch(resolveApiUrl(`${ROLES_API}/${id}`), {
    method: 'PUT',
    headers: authHeaders(token),
    data: { name },
  })
  expect(put.status(), 'header-less PUT should succeed (additive path)').toBeLessThan(300)
  const get = await request.fetch(resolveApiUrl(`${ROLES_API}/${id}`), {
    method: 'GET',
    headers: authHeaders(token),
  })
  expect(get.status(), 'GET role detail should be 200').toBe(200)
  const body = (await get.json()) as Record<string, unknown>
  const raw = (body.updatedAt ?? body.updated_at) as string | undefined
  expect(typeof raw, 'role detail should expose updatedAt').toBe('string')
  return new Date(Date.parse(raw as string)).toISOString()
}

async function deleteRole(
  request: APIRequestContext,
  token: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await request
    .fetch(resolveApiUrl(`${ROLES_API}/${id}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    .catch(() => undefined)
}

test.describe('TC-LOCK-OSS-033: customer_accounts portal role edit + delete optimistic-lock guard', () => {
  // The edit page (backend/customer_accounts/roles/[id]/page.tsx) now routes the
  // server's 409 to `surfaceRecordConflict` in `handleSubmit` (fix bae74923e),
  // so CrudForm renders the `record-conflict-banner` on a stale-token save.
  // The server-side guard itself was always correct — see the active API case below.
  test('AUTH-07 stale portal-role edit surfaces the conflict bar in the browser', async ({ page }) => {
    test.setTimeout(120_000)

    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let roleId: string | null = null
    try {
      roleId = await createRole(page.request, token, stamp)
      // Establish a non-null updated_at so the loaded form captures a real token.
      await bumpRole(page.request, token, roleId, `QA Lock 033 v1 ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/customer_accounts/roles/${roleId}`)

      // Form is loaded; its optimistic-lock token is captured at load time.
      const nameInput = page.locator('main').getByRole('textbox').first()
      await expect(nameInput).toBeVisible({ timeout: 15_000 })
      await expect(nameInput).toHaveValue(`QA Lock 033 v1 ${stamp}`)

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRole(page.request, token, roleId, `QA Lock 033 bumped ${stamp}`)

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 033 stale ${stamp}`)
      const staleSave = page.waitForResponse((response) => (
        response.url().includes(`/api/customer_accounts/admin/roles/${roleId}`)
        && response.request().method() === 'PUT'
      ), { timeout: 15_000 })
      await Promise.all([
        staleSave,
        nameInput.press('Control+Enter'),
      ])
      expect((await staleSave).status(), 'stale browser save should return 409').toBe(409)

      await expectConflictBanner(page)
    } finally {
      await deleteRole(page.request, token, roleId)
    }
  })

  test('AUTH-07 stale portal-role delete returns the 409 conflict body (command route)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let roleId: string | null = null
    try {
      roleId = await createRole(request, token, stamp)
      // t0 is the token captured before an out-of-band write.
      const t0 = await bumpRole(request, token, roleId, `QA Lock 033 del v1 ${stamp}`)
      // Advance updated_at out-of-band → t0 is now stale.
      const t1 = await bumpRole(request, token, roleId, `QA Lock 033 del bumped ${stamp}`)
      expect(t1, 'updatedAt should advance after the out-of-band write').not.toBe(t0)

      // Stale DELETE (path-based, id-in-body unused) → 409 with the structured body.
      const staleDelete = await request.fetch(resolveApiUrl(`${ROLES_API}/${roleId}`), {
        method: 'DELETE',
        headers: {
          ...authHeaders(token),
          'x-om-ext-optimistic-lock-expected-updated-at': t0,
        },
      })
      await expectConflictBody(staleDelete)

      // A stale PUT through the shared helper hits the same guard (defense in depth).
      const stalePut = await putWithLock(request, token, `${ROLES_API}/${roleId}`, { name: `QA Lock 033 stale put ${stamp}` }, t0)
      await expectConflictBody(stalePut)

      // A fresh-header DELETE succeeds and removes the fixture.
      const freshDelete = await request.fetch(resolveApiUrl(`${ROLES_API}/${roleId}`), {
        method: 'DELETE',
        headers: {
          ...authHeaders(token),
          'x-om-ext-optimistic-lock-expected-updated-at': t1,
        },
      })
      expect(freshDelete.status(), 'DELETE with fresh header should succeed').toBeLessThan(300)
      roleId = null
    } finally {
      await deleteRole(request, token, roleId)
    }
  })
})
