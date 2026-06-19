import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  bumpRecordViaApi,
  putWithLock,
  expectConflictBody,
  expectConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-031 — auth role optimistic-lock conflict surfaces (#2055).
 *
 * Surfaces under test:
 *  - AUTH-01 (browser): the role-edit `CrudForm` (`/backend/roles/<id>/edit`,
 *    field `name`, PUT `/api/auth/roles`) captures the role's `updated_at` at
 *    load and replays it as the optimistic-lock header on save. A stale name
 *    edit must surface the unified "Record changed" conflict bar
 *    (`data-testid="record-conflict-banner"`) instead of silently clobbering.
 *  - AUTH-05 (browser): the same form's delete path replays the loaded
 *    `updated_at` on DELETE `/api/auth/roles`. A stale delete must surface the
 *    conflict bar instead of silently removing a concurrently-changed role.
 *  - AUTH-02 (API-level fallback): the role-ACL save (PUT `/api/auth/roles/acl`)
 *    guards writes with `enforceCommandOptimisticLock`. The ACL is edited inline
 *    in the role form's Access section (no dedicated `data-crud-field-id` edit
 *    page for the ACL row), so the clobber contract is proven at the API level:
 *    capture the ACL's `updatedAt`, advance it out-of-band via a header-less ACL
 *    PUT, then replay the now-stale write → 409 `optimistic_lock_conflict`.
 *
 * Pattern (per `optimisticLockUi.ts`): capture the record's `updated_at`,
 * advance it out-of-band via a header-less write, then replay the now-stale
 * write to trigger the 409 → conflict bar (or 409 body for the API fallback).
 *
 * The seeded `admin` is a tenant admin (not super admin); roles it creates live
 * in its own tenant and carry `auth.roles.manage` / `auth.acl.manage`, so all
 * three surfaces are reachable as `admin`.
 */

const ROLES_API = '/api/auth/roles'
const ROLE_ACL_API = '/api/auth/roles/acl'

async function createRoleFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', ROLES_API, { token, data: { name } })
  expect(response.status(), 'POST /api/auth/roles should return 201').toBe(201)
  const created = (await response.json()) as { id?: string }
  expect(created.id, 'created role should have an id').toBeTruthy()
  return created.id as string
}

async function deleteRoleIfExists(
  request: APIRequestContext,
  token: string,
  roleId: string | null,
): Promise<void> {
  if (!roleId) return
  await apiRequest(request, 'DELETE', `${ROLES_API}?id=${encodeURIComponent(roleId)}`, {
    token,
  }).catch(() => undefined)
}

async function setRoleAclFeatures(
  request: APIRequestContext,
  token: string,
  roleId: string,
  features: string[],
): Promise<void> {
  const response = await apiRequest(request, 'PUT', ROLE_ACL_API, {
    token,
    data: { roleId, features },
  })
  expect(response.status(), 'role ACL PUT should succeed (additive path)').toBeLessThan(300)
}

async function readRoleAclUpdatedAt(
  request: APIRequestContext,
  token: string,
  roleId: string,
): Promise<string | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${ROLE_ACL_API}?roleId=${encodeURIComponent(roleId)}`,
    { token },
  )
  expect(response.status(), 'GET role ACL should be 200').toBe(200)
  const body = (await response.json()) as { updatedAt?: string | null }
  return body.updatedAt ?? null
}

test.describe('TC-LOCK-OSS-031: auth role edit + delete + ACL clobber optimistic-lock', () => {
  test('AUTH-01 stale role-name edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let roleId: string | null = null
    try {
      roleId = await createRoleFixture(page.request, token, `QA Lock 031 ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/roles/${roleId}/edit`)

      // Form is loaded; its optimistic-lock token is captured from the role's
      // updated_at at load time.
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, ROLES_API, {
        id: roleId,
        name: `QA Lock 031 bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 031 stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteRoleIfExists(page.request, token, roleId)
    }
  })

  test('AUTH-05 stale role delete shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let roleId: string | null = null
    try {
      roleId = await createRoleFixture(page.request, token, `QA Lock 031 del ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/roles/${roleId}/edit`)

      // Wait for the form so its optimistic-lock token is captured at load time.
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      // Advance updated_at out-of-band → the loaded form now holds a stale token.
      await bumpRecordViaApi(page.request, token, ROLES_API, {
        id: roleId,
        name: `QA Lock 031 del bumped ${stamp}`,
      })

      // Trigger delete from the form → confirm dialog → stale DELETE header → 409.
      await page.getByRole('button', { name: /delete/i }).first().click()
      const confirmDialog = page.getByRole('alertdialog')
      await expect(confirmDialog).toBeVisible({ timeout: 10_000 })
      await confirmDialog.getByRole('button', { name: /confirm/i }).click()

      await expectConflictBanner(page)
    } finally {
      await deleteRoleIfExists(page.request, token, roleId)
    }
  })

  test('AUTH-02 stale role-ACL clobber is refused with a 409 conflict (API fallback)', async ({
    page,
  }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let roleId: string | null = null
    try {
      roleId = await createRoleFixture(page.request, token, `QA Lock 031 acl ${stamp}`)

      // First grant creates the RoleAcl row but leaves updated_at unset (the
      // command only conflicts once a prior version exists). A second header-less
      // grant materializes a real updated_at we can capture as the stale token.
      await setRoleAclFeatures(page.request, token, roleId, ['auth.roles.list'])
      await setRoleAclFeatures(page.request, token, roleId, ['auth.roles.list', 'auth.users.list'])
      const staleUpdatedAt = await readRoleAclUpdatedAt(page.request, token, roleId)
      expect(typeof staleUpdatedAt, 'role ACL should expose updatedAt after a second grant').toBe(
        'string',
      )

      // Advance the ACL's updated_at out-of-band via a header-less grant → the
      // captured token is now stale.
      await setRoleAclFeatures(page.request, token, roleId, [
        'auth.roles.list',
        'auth.users.list',
        'auth.acl.manage',
      ])

      // Replay the now-stale ACL write with the original version → 409.
      const conflict = await putWithLock(
        page.request,
        token,
        ROLE_ACL_API,
        { roleId, features: ['auth.roles.list'] },
        staleUpdatedAt as string,
      )
      await expectConflictBody(conflict)
    } finally {
      await deleteRoleIfExists(page.request, token, roleId)
    }
  })
})
