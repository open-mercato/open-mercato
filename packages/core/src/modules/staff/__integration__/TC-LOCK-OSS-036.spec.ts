import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/staffFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  expectNoConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-036 (browser UI + API) — manual cases STF-04 / STF-05 / STF-06.
 *
 * Browser-driven proof that a stale edit on the staff *leave-request* surface
 * (`/backend/staff/my-leave-requests/<id>` → `LeaveRequestForm`, a CrudForm
 * wired with `optimisticLockUpdatedAt`) surfaces the unified "Record changed"
 * conflict bar (`data-testid="record-conflict-banner"`) instead of silently
 * overwriting, and that a clean single-tab save does NOT raise a false-positive
 * bar.
 *
 * Pattern (deterministic, no two real tabs / no sleeps): create the record via
 * API, open the edit page in the browser (the CrudForm captures `updated_at`),
 * advance `updated_at` out-of-band with a header-less PUT (strictly-additive
 * path, always succeeds and bumps `updated_at`), then edit + save in the browser
 * so the now-stale `x-om-ext-optimistic-lock-expected-updated-at` header triggers
 * the 409 → conflict bar. See
 * `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`.
 *
 * Leave-request routes:
 *   - page  : `backend/staff/my-leave-requests/[id]/page.tsx`
 *             (renders the editable `LeaveRequestForm` only while status is
 *             `pending`; a freshly-created request defaults to `pending`).
 *   - API   : `api/staff/leave-requests` (`makeCrudRoute`, command route).
 *   The leave-request PUT honors the OSS optimistic-lock header and returns the
 *   standard 409 contract body (`code: 'optimistic_lock_conflict'` +
 *   `currentUpdatedAt`/`expectedUpdatedAt`), so the unified bar surfaces.
 *
 * Job-history (STF-06) is covered at the API level + one documented `fixme` —
 * see the header comment on that describe block for the route file and why the
 * unified bar cannot surface for that surface today.
 */

const LEAVE_REQUESTS_API = '/api/staff/leave-requests'
const JOB_HISTORIES_API = '/api/staff/job-histories'
const TEAM_MEMBERS_API = '/api/staff/team-members'

type CreatedLeaveRequest = { id: string; memberId: string }

async function createLeaveRequestFixture(
  request: APIRequestContext,
  token: string,
  memberId: string,
  note: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', LEAVE_REQUESTS_API, {
    token,
    data: {
      memberId,
      timezone: 'UTC',
      startDate: '2030-01-10',
      endDate: '2030-01-12',
      note,
    },
  })
  expect(response.ok(), `Failed to create leave request fixture: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy()
  return body.id as string
}

async function createJobHistoryFixture(
  request: APIRequestContext,
  token: string,
  memberId: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', JOB_HISTORIES_API, {
    token,
    data: { entityId: memberId, name, startDate: '2020-01-01' },
  })
  expect(response.ok(), `Failed to create job history fixture: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy()
  return body.id as string
}

/**
 * The job-histories list is filtered by `entityId` (the owning member id), not
 * by record id, so we read the record's `updated_at` via the member-scoped list
 * and pick out the entry by id.
 */
async function readJobHistoryUpdatedAt(
  request: APIRequestContext,
  token: string,
  memberId: string,
  jobHistoryId: string,
): Promise<string> {
  const response = await apiRequest(
    request,
    'GET',
    `${JOB_HISTORIES_API}?entityId=${memberId}&pageSize=100`,
    { token },
  )
  expect(response.ok(), `Failed to read job histories: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const item = Array.isArray(body.items)
    ? body.items.find((entry) => entry.id === jobHistoryId)
    : undefined
  expect(item, `job history ${jobHistoryId} should be listed under member ${memberId}`).toBeTruthy()
  const raw = (item?.updated_at ?? item?.updatedAt) as string | undefined
  expect(typeof raw, `job history should expose updated_at, got ${String(raw)}`).toBe('string')
  return new Date(Date.parse(raw as string)).toISOString()
}

test.describe('TC-LOCK-OSS-036: staff leave-request edit optimistic-lock conflict bar (STF-04/05)', () => {
  test('stale leave-request edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let memberId: string | null = null
    let requestId: string | null = null
    try {
      memberId = await createStaffTeamMemberFixture(page.request, token, {
        displayName: `QA Lock 036 member ${stamp}`,
      })
      requestId = await createLeaveRequestFixture(page.request, token, memberId, `QA Lock 036 note ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/staff/my-leave-requests/${requestId}`)

      // The editable LeaveRequestForm is loaded → its optimistic-lock token is
      // captured at load time. The `note` field renders as a textarea wrapped
      // in `[data-crud-field-id="note"]`.
      const noteInput = page.locator('[data-crud-field-id="note"] textarea').first()
      await expect(noteInput).toBeVisible({ timeout: 15_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, LEAVE_REQUESTS_API, {
        id: requestId,
        note: `QA Lock 036 bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      // The form is submitted via the footer "Save" button (submitLabel); a
      // textarea swallows Control+Enter, so the button click is the reliable
      // submit trigger.
      await fillControlledInput(noteInput, `QA Lock 036 stale ${stamp}`)
      await page.getByRole('button', { name: /^save$/i }).first().click()

      await expectConflictBanner(page)
    } finally {
      await deleteStaffEntityIfExists(page.request, token, LEAVE_REQUESTS_API, requestId)
      await deleteStaffEntityIfExists(page.request, token, TEAM_MEMBERS_API, memberId)
    }
  })

  test('clean single-tab leave-request save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let memberId: string | null = null
    let requestId: string | null = null
    try {
      memberId = await createStaffTeamMemberFixture(page.request, token, {
        displayName: `QA Lock 036b member ${stamp}`,
      })
      requestId = await createLeaveRequestFixture(page.request, token, memberId, `QA Lock 036b note ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/staff/my-leave-requests/${requestId}`)

      const noteInput = page.locator('[data-crud-field-id="note"] textarea').first()
      await expect(noteInput).toBeVisible({ timeout: 15_000 })

      const putPromise = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes(LEAVE_REQUESTS_API),
        { timeout: 15_000 },
      )
      await fillControlledInput(noteInput, `QA Lock 036b saved ${stamp}`)
      await page.getByRole('button', { name: /^save$/i }).first().click()
      const settled = await putPromise
      expect(settled.status(), 'clean save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteStaffEntityIfExists(page.request, token, LEAVE_REQUESTS_API, requestId)
      await deleteStaffEntityIfExists(page.request, token, TEAM_MEMBERS_API, memberId)
    }
  })
})

/**
 * STF-06 — staff team-member *job-history* nested edit (API fallback).
 *
 * The job-history edit lives in a nested dialog inside the team-member detail
 * (`components/detail/JobHistorySection.tsx` → a `CrudForm` rendered inside a
 * `<Dialog>`). Two complementary cases are covered below:
 *   - the body-`updatedAt` lock (a stale `updatedAt` in the PUT *body* → 409),
 *     proven at the API level, and
 *   - the standard OSS header lock surfacing the unified conflict bar in the
 *     browser. The update command runs `enforceCommandOptimisticLock({
 *     resourceKind: 'staff.jobHistory', ... })`, and the dialog lets the 409
 *     propagate so the enclosing CrudForm raises the unified
 *     `record-conflict-banner`.
 */
test.describe('TC-LOCK-OSS-036: staff job-history nested edit optimistic lock (STF-06, API)', () => {
  test('stale job-history edit (body updatedAt) is refused with 409', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let memberId: string | null = null
    let jobHistoryId: string | null = null
    try {
      memberId = await createStaffTeamMemberFixture(page.request, token, {
        displayName: `QA Lock 036c member ${stamp}`,
      })
      jobHistoryId = await createJobHistoryFixture(page.request, token, memberId, `QA Lock 036c job ${stamp}`)

      const loadedUpdatedAt = await readJobHistoryUpdatedAt(page.request, token, memberId, jobHistoryId)

      // Advance updated_at out-of-band (header-less, additive path) so the
      // captured `loadedUpdatedAt` is now stale.
      await bumpRecordViaApi(page.request, token, JOB_HISTORIES_API, {
        id: jobHistoryId,
        entityId: memberId,
        name: `QA Lock 036c bumped ${stamp}`,
        updatedAt: loadedUpdatedAt,
      })

      // Re-submitting with the now-stale body `updatedAt` must be refused.
      const conflictResponse = await apiRequest(page.request, 'PUT', JOB_HISTORIES_API, {
        token,
        data: {
          id: jobHistoryId,
          entityId: memberId,
          name: `QA Lock 036c stale ${stamp}`,
          updatedAt: loadedUpdatedAt,
        },
      })
      expect(
        conflictResponse.status(),
        'stale job-history write (body updatedAt) should be 409',
      ).toBe(409)
    } finally {
      await deleteStaffEntityIfExists(page.request, token, JOB_HISTORIES_API, jobHistoryId)
      await deleteStaffEntityIfExists(page.request, token, TEAM_MEMBERS_API, memberId)
    }
  })

  /**
   * STF-06 (delete) — a stale DELETE on the job-history surface must hit the same
   * OSS optimistic-lock 409 contract as the stale edit. The nested
   * `JobHistorySection.handleDelete` sends `body: { id, updatedAt }`; with a stale
   * `updatedAt` the command's `enforceCommandOptimisticLock({ resourceKind:
   * 'staff.jobHistory', ... })` refuses the delete with the standard
   * `code: 'optimistic_lock_conflict'` body, which the dialog routes through
   * `surfaceRecordConflict(...)` to raise the unified conflict bar in the browser.
   */
  test('stale job-history delete (body updatedAt) is refused with 409', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let memberId: string | null = null
    let jobHistoryId: string | null = null
    try {
      memberId = await createStaffTeamMemberFixture(page.request, token, {
        displayName: `QA Lock 036e member ${stamp}`,
      })
      jobHistoryId = await createJobHistoryFixture(page.request, token, memberId, `QA Lock 036e job ${stamp}`)

      const loadedUpdatedAt = await readJobHistoryUpdatedAt(page.request, token, memberId, jobHistoryId)

      // Advance updated_at out-of-band so the captured `loadedUpdatedAt` is stale.
      await bumpRecordViaApi(page.request, token, JOB_HISTORIES_API, {
        id: jobHistoryId,
        entityId: memberId,
        name: `QA Lock 036e bumped ${stamp}`,
        updatedAt: loadedUpdatedAt,
      })

      // Deleting with the now-stale body `updatedAt` must be refused with the
      // standard 409 optimistic-lock contract.
      const conflictResponse = await apiRequest(page.request, 'DELETE', JOB_HISTORIES_API, {
        token,
        data: { id: jobHistoryId, updatedAt: loadedUpdatedAt },
      })
      expect(
        conflictResponse.status(),
        'stale job-history delete (body updatedAt) should be 409',
      ).toBe(409)
      const conflictBody = (await conflictResponse.json()) as { code?: string }
      expect(conflictBody.code, 'stale delete should return the optimistic-lock code').toBe(
        'optimistic_lock_conflict',
      )
    } finally {
      await deleteStaffEntityIfExists(page.request, token, JOB_HISTORIES_API, jobHistoryId)
      await deleteStaffEntityIfExists(page.request, token, TEAM_MEMBERS_API, memberId)
    }
  })

  /**
   * Job-history now honors the OSS optimistic-lock contract end-to-end.
   *
   * Route file: `packages/core/src/modules/staff/api/job-histories.ts`
   *   + command: `packages/core/src/modules/staff/commands/job-histories.ts`
   *
   * The update command calls `enforceCommandOptimisticLock({ resourceKind:
   * 'staff.jobHistory', ... })`, so it now (a) reads the standard
   * `x-om-ext-optimistic-lock-expected-updated-at` header (additive — the
   * existing body-`updatedAt` path still works) and (b) throws the standard
   * `CrudHttpError(409, { code: 'optimistic_lock_conflict', ... })`. The nested
   * `JobHistorySection` dialog no longer swallows the error into a flash toast —
   * it lets the 409 propagate so the enclosing CrudForm's
   * `surfaceRecordConflict(...)` raises the unified `record-conflict-banner`.
   */
  test('stale job-history edit (OSS header) shows the unified conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let memberId: string | null = null
    let jobHistoryId: string | null = null
    try {
      memberId = await createStaffTeamMemberFixture(page.request, token, {
        displayName: `QA Lock 036d member ${stamp}`,
      })
      jobHistoryId = await createJobHistoryFixture(page.request, token, memberId, `QA Lock 036d job ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/staff/team-members/${memberId}`)

      // The job-history list lives behind the "Job history" panel tab on the
      // team-member detail page; select it before exercising the nested edit
      // dialog (mirrors the tabbed-detail navigation in the customers specs).
      await page.getByRole('tab', { name: /job history/i }).click()
      await page.getByRole('button', { name: /edit job/i }).first().click()
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 15_000 })

      await bumpRecordViaApi(page.request, token, JOB_HISTORIES_API, {
        id: jobHistoryId,
        entityId: memberId,
        name: `QA Lock 036d bumped ${stamp}`,
      })

      await fillControlledInput(nameInput, `QA Lock 036d stale ${stamp}`)
      await page.getByRole('button', { name: /^update job$/i }).first().click()

      await expectConflictBanner(page)
    } finally {
      await deleteStaffEntityIfExists(page.request, token, JOB_HISTORIES_API, jobHistoryId)
      await deleteStaffEntityIfExists(page.request, token, TEAM_MEMBERS_API, memberId)
    }
  })
})
