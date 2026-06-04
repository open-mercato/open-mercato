import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createStaffTeamFixture,
  createStaffTeamRoleFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/staffFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  expectNoConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-035 (browser UI) — manual cases STF-01 / STF-02.
 *
 * Browser-driven proof that a stale edit on the staff team-role and team
 * CrudForms surfaces the unified "Record changed" conflict bar
 * (`data-testid="record-conflict-banner"`) instead of silently overwriting,
 * and that a clean single-tab save does NOT raise a false-positive bar.
 *
 * Pattern: load the edit page (the form captures `updated_at`) → advance
 * `updated_at` out-of-band via a header-less API PUT → edit + save in the
 * browser (the now-stale header → 409 → conflict bar). See
 * `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`.
 */

const TEAM_ROLES_API = '/api/staff/team-roles'
const TEAMS_API = '/api/staff/teams'

test.describe('TC-LOCK-OSS-035: staff team-role + team edit optimistic-lock conflict bar', () => {
  test('stale team-role edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let roleId: string | null = null
    try {
      roleId = await createStaffTeamRoleFixture(page.request, token, {
        name: `QA Lock 035 role ${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/staff/team-roles/${roleId}/edit`)

      // Form is loaded (its optimistic-lock token is now captured at load time).
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, TEAM_ROLES_API, {
        id: roleId,
        name: `QA Lock 035 role bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 035 role stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteStaffEntityIfExists(page.request, token, TEAM_ROLES_API, roleId)
    }
  })

  test('clean single-tab team-role save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let roleId: string | null = null
    try {
      roleId = await createStaffTeamRoleFixture(page.request, token, {
        name: `QA Lock 035b role ${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/staff/team-roles/${roleId}/edit`)

      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      const putPromise = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes(TEAM_ROLES_API),
        { timeout: 10_000 },
      )
      await fillControlledInput(nameInput, `QA Lock 035b role saved ${stamp}`)
      await nameInput.press('Control+Enter')
      const settled = await putPromise
      expect(settled.status(), 'clean save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteStaffEntityIfExists(page.request, token, TEAM_ROLES_API, roleId)
    }
  })

  test('stale team edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let teamId: string | null = null
    try {
      teamId = await createStaffTeamFixture(page.request, token, `QA Lock 035 team ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/staff/teams/${teamId}/edit`)

      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, TEAMS_API, {
        id: teamId,
        name: `QA Lock 035 team bumped ${stamp}`,
      })

      await fillControlledInput(nameInput, `QA Lock 035 team stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteStaffEntityIfExists(page.request, token, TEAMS_API, teamId)
    }
  })

  test('clean single-tab team save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let teamId: string | null = null
    try {
      teamId = await createStaffTeamFixture(page.request, token, `QA Lock 035b team ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/staff/teams/${teamId}/edit`)

      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      const putPromise = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes(TEAMS_API),
        { timeout: 10_000 },
      )
      await fillControlledInput(nameInput, `QA Lock 035b team saved ${stamp}`)
      await nameInput.press('Control+Enter')
      const settled = await putPromise
      expect(settled.status(), 'clean save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteStaffEntityIfExists(page.request, token, TEAMS_API, teamId)
    }
  })
})
