import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createTestCustomer, createTestTimeProject, type TestCustomerFixture, type TestTimeProjectFixture } from './fixtures'

export const integrationMeta = {
  dependsOnModules: ['customers'],
}

/**
 * TC-TT-017 — No access to a project (screen 17).
 *
 * Source: `.ai/specs/2026-08-12-time-tracking-consulting-suite.md`
 *   § Testing Coverage → Integration → "Non-member hitting a project URL gets the guard
 *   state, not a 403 dump".
 *   § Proposed Solution → "A denied project route renders screen 17 — an explanation that
 *   names neither the customer nor the project, plus a way back (US-A2, screen 17 note 1)."
 *   D-6 — the "request access" button is a real action that notifies the
 *   `staff.timesheets.projects.manage` holders, not decoration.
 *
 * Personas: `admin` (Team Leader, `staff.*`) owns the fixture project; `employee` is the
 * Team Member who was never assigned to it. Both are `mercato init` accounts, matching the
 * precedent in this folder.
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * Un-quarantined (R3). The guard is now wired end to end:
 *
 *   1. `GET /api/staff/timesheets/time-projects` intersects every row with
 *      `resolveProjectAccess`, so a non-member gets no row at all — never a redacted
 *      one — and a request for one specific id they may not see answers 404 with
 *      `reason: 'no_project_access'` and nothing else. The same 404 covers ids that do
 *      not exist, so the response cannot be used to enumerate projects.
 *   2. `backend/staff/time-tracking/projects/[id]/page.tsx` (and its `edit` sibling)
 *      branch on that discriminator and render `NoProjectAccess` — screen 17 — instead
 *      of `RecordNotFoundState`.
 * ────────────────────────────────────────────────────────────────────────────────────
 */

const ACCESS_REQUEST_ENDPOINT = '/api/staff/timesheets/access-requests'

test.describe('TC-TT-017: No access to a project', () => {
  test('shows the guard state without leaking the customer or project, and the request-access action works', async ({ page, request }) => {
    test.setTimeout(120_000)

    const stamp = String(Date.now()).slice(-9)
    const customerName = `QATT17 Customer ${stamp}`
    const projectName = `QATT17 Project ${stamp}`

    const adminToken = await getAuthToken(request, 'admin')
    let customer: TestCustomerFixture | null = null
    let project: TestTimeProjectFixture | null = null

    try {
      // A project the Team Member is deliberately never assigned to.
      customer = await createTestCustomer(request, adminToken, { displayName: customerName })
      project = await createTestTimeProject(request, adminToken, {
        name: projectName,
        code: `QT17-${stamp}`,
        customer,
      })

      await login(page, 'employee')
      await page.goto(`/backend/staff/time-tracking/projects/${project.id}`)

      // Screen 17 — a readable state, not a raw failure.
      await expect(page.getByText('You do not have access to this project')).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByText(
          'Project access is granted one project at a time by a Team Leader. If you had access before, it may have been revoked — your earlier time entries stay saved.',
        ),
      ).toBeVisible()

      // Not a 403 dump and not a stack trace.
      const body = page.locator('body')
      await expect(body).not.toContainText('403')
      await expect(body).not.toContainText('Forbidden')
      await expect(body).not.toContainText(/at .*\(.*:\d+:\d+\)/)
      await expect(body).not.toContainText('Application error')

      // Screen 17 note 1 — the UI must not confirm what it is refusing to show.
      await expect(body).not.toContainText(projectName)
      await expect(body).not.toContainText(customerName)

      // …and a way back plus a way forward.
      await expect(page.getByRole('link', { name: /back to .?my work.?/i })).toBeVisible()

      // D-6 — using the action succeeds; the request reaches the endpoint and the button
      // acknowledges it rather than erroring.
      const requestButton = page.getByRole('button', { name: 'Request access' })
      await expect(requestButton).toBeVisible()

      const [accessRequest] = await Promise.all([
        page.waitForResponse(
          (response) => response.url().includes(ACCESS_REQUEST_ENDPOINT) && response.request().method() === 'POST',
          { timeout: 30_000 },
        ),
        requestButton.click(),
      ])
      expect(accessRequest.ok(), `POST ${ACCESS_REQUEST_ENDPOINT} should succeed: ${accessRequest.status()}`).toBeTruthy()

      await expect(page.getByText('Your request has been sent to the Team Leaders.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Request sent' })).toBeDisabled()
      await expect(page.getByText('Could not send the access request.')).toHaveCount(0)
    } finally {
      if (project) await project.cleanup()
      if (customer) await customer.cleanup()
    }
  })
})
