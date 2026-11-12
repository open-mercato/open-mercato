import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  expectConflictBody,
  putWithLock,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'

/**
 * TC-LOCK-OSS-049 — follow-up from #8757: QA reproduced a lost update on newly
 * created customer roles whose detail API returned a null version (#8846).
 *
 * `CustomerRole.updated_at` previously declared only `onUpdate`, so a freshly
 * inserted role persisted `updated_at = NULL`. The command-level lock guard
 * (`enforceCommandOptimisticLockWithGuards`) treats a null `current` version as
 * unlockable and no-ops, so the role's very first concurrent edit always won
 * the race silently — unlike every OTHER optimistic-lock spec in this suite
 * (e.g. TC-LOCK-OSS-033), which works around exactly this gap by doing one
 * header-less PUT to establish a non-null `updated_at` before testing the lock.
 *
 * This spec does NOT do that warm-up PUT — it captures "User A"'s token
 * straight off the role the CREATE call returns, which is the realistic shape
 * of the two-user scenario from the issue: A opens a role immediately after it
 * was created, B edits and saves, then A's stale save must be refused and B's
 * write must survive untouched.
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
      name: `QA Lock 049 ${stamp}`,
      slug: `qa-lock-049-${stamp}`,
      description: 'original description',
    },
  })
  expect(res.status(), 'role should be created').toBe(201)
  const id = ((await res.json()) as { role?: { id?: string } }).role?.id ?? null
  expect(id, 'created role id should be returned').toBeTruthy()
  return id as string
}

async function getRoleDetail(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<{ updatedAt: string | null; name: string; description: string | null }> {
  const res = await request.fetch(resolveApiUrl(`${ROLES_API}/${id}`), {
    method: 'GET',
    headers: authHeaders(token),
  })
  expect(res.status(), 'role detail GET should be 200').toBe(200)
  const body = (await res.json()) as {
    updatedAt?: string | null
    name?: string
    description?: string | null
  }
  return {
    updatedAt: body.updatedAt ?? null,
    name: body.name ?? '',
    description: body.description ?? null,
  }
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

test.describe('TC-LOCK-OSS-049: a brand-new customer role is lockable on its very first concurrent edit (#8846)', () => {
  test('create → immediate detail read exposes a non-null updated_at (no warm-up write)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let roleId: string | null = null
    try {
      roleId = await createRole(request, token, stamp)
      const detail = await getRoleDetail(request, token, roleId)
      expect(detail.updatedAt, 'a freshly created role must expose a non-null updated_at immediately').not.toBeNull()
    } finally {
      await deleteRole(request, token, roleId)
    }
  })

  test('A opens a brand-new role, B saves a Description edit, then A\'s stale Name edit is refused and B\'s write survives', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let roleId: string | null = null
    try {
      roleId = await createRole(request, token, stamp)

      // User A "opens" the role right after creation — the token it captures is
      // the one exposed by the very first detail GET, never bumped out-of-band.
      const aDetail = await getRoleDetail(request, token, roleId)
      expect(aDetail.updatedAt).not.toBeNull()
      const aToken = aDetail.updatedAt as string

      // User B edits Description and saves — header-less PUT (additive path).
      const bPut = await request.fetch(resolveApiUrl(`${ROLES_API}/${roleId}`), {
        method: 'PUT',
        headers: authHeaders(token),
        data: { description: 'B set this description' },
      })
      expect(bPut.status(), 'B\'s header-less save should succeed').toBeLessThan(300)
      const bToken = ((await bPut.json()) as { updatedAt?: string }).updatedAt as string
      expect(bToken, 'B\'s save should return the new updatedAt').toBeTruthy()
      expect(bToken).not.toBe(aToken)

      // User A now submits a stale Name edit using the token captured when the
      // role was brand new — before this fix this would have been a silent 200
      // (and worse, pre-fix `aToken` would itself have been null/missing).
      const staleNamePut = await putWithLock(
        request,
        token,
        `${ROLES_API}/${roleId}`,
        { name: `A set this (stale) ${stamp}` },
        aToken,
      )
      const conflictBody = await expectConflictBody(staleNamePut)
      expect(conflictBody.currentUpdatedAt).toBe(bToken)

      // B's write must survive untouched — A's stale edit must not have landed.
      const afterConflict = await getRoleDetail(request, token, roleId)
      expect(afterConflict.description).toBe('B set this description')
      expect(afterConflict.name).not.toBe(`A set this (stale) ${stamp}`)

      // Retry stays usable: A re-reads the current token and resubmits with it.
      const retryPut = await putWithLock(
        request,
        token,
        `${ROLES_API}/${roleId}`,
        { name: `A retried ${stamp}` },
        bToken,
      )
      expect(retryPut.status(), 'a fresh-token retry should succeed').toBeLessThan(300)

      const final = await getRoleDetail(request, token, roleId)
      expect(final.name).toBe(`A retried ${stamp}`)
      expect(final.description).toBe('B set this description')
    } finally {
      await deleteRole(request, token, roleId)
    }
  })
})
