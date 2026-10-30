import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createTestCustomer,
  createTestTimeProject,
  type TestCustomerFixture,
  type TestTimeProjectFixture,
} from './fixtures'

export const integrationMeta = {
  dependsOnModules: ['customers'],
}

/**
 * TC-TT-003 — Projects list (screen 3), Team Leader perspective.
 *
 * Source: `.ai/specs/2026-08-12-time-tracking-consulting-suite.md`
 *   § Testing Coverage → Integration → "Projects list shows hours/cost/budget; no grand total"
 *   Screen 3 note 2: currencies never cross, so the table footer has NO "total" row.
 *   Screen 3 note 4: "Report from selected" only works inside one customer; otherwise
 *   the action is blocked *with an explanation*, not silently.
 *
 * Persona: `admin`, which `setup.ts` grants `staff.*` — so it holds
 * `staff.timesheets.projects.manage` (the Team Leader marker per § Access Control)
 * plus `reports.view`/`reports.manage`, which is what makes the row checkboxes and
 * the "Report from selected" bulk action render at all.
 *
 * Self-contained: two customers and two projects are created through the shared
 * fixtures in setup and removed in `finally`, including when the body throws.
 */

const TIME_PROJECTS_PATH = '/api/staff/timesheets/time-projects'
const PROJECTS_PAGE = '/backend/staff/time-tracking/projects?view=table'

/**
 * The shared `createTestTimeProject` fixture deliberately creates the minimum a
 * project needs. Rate and budget are layered on afterwards through the public
 * update route rather than by widening the fixture, so this spec stays additive.
 */
async function setProjectBilling(
  request: APIRequestContext,
  token: string,
  projectId: string,
  billing: { hourlyRate: string; budgetKind: 'hours' | 'amount'; budgetValue: string },
): Promise<void> {
  const response = await apiRequest(request, 'PUT', TIME_PROJECTS_PATH, {
    token,
    data: {
      id: projectId,
      hourlyRate: billing.hourlyRate,
      budgetKind: billing.budgetKind,
      budgetValue: billing.budgetValue,
      budgetWarnAtPercent: 80,
    },
  })
  expect(response.ok(), `PUT ${TIME_PROJECTS_PATH} should persist the billing fields: ${response.status()}`).toBeTruthy()
}

test.describe('TC-TT-003: Time tracking projects portfolio', () => {
  test('shows the money columns, has no grand total, and blocks a cross-customer report with a reason', async ({ page, request }) => {
    test.setTimeout(120_000)

    // 9 digits keeps every derived project code inside the 20-character cap.
    const stamp = String(Date.now()).slice(-9)
    const marker = `QATT3 ${stamp}`
    const alphaCustomerName = `${marker} Alpha Customer`
    const betaCustomerName = `${marker} Beta Customer`
    const alphaProjectName = `${marker} Alpha`
    const betaProjectName = `${marker} Beta`

    const adminToken = await getAuthToken(request, 'admin')
    let alphaCustomer: TestCustomerFixture | null = null
    let betaCustomer: TestCustomerFixture | null = null
    let alphaProject: TestTimeProjectFixture | null = null
    let betaProject: TestTimeProjectFixture | null = null

    try {
      // Two customers, one project each — the minimum that exercises screen 3 note 4.
      alphaCustomer = await createTestCustomer(request, adminToken, { displayName: alphaCustomerName })
      betaCustomer = await createTestCustomer(request, adminToken, { displayName: betaCustomerName })

      alphaProject = await createTestTimeProject(request, adminToken, {
        name: alphaProjectName,
        code: `QT3A-${stamp}`,
        customer: alphaCustomer,
      })
      betaProject = await createTestTimeProject(request, adminToken, {
        name: betaProjectName,
        code: `QT3B-${stamp}`,
        customer: betaCustomer,
      })

      await setProjectBilling(request, adminToken, alphaProject.id, {
        hourlyRate: '320',
        budgetKind: 'hours',
        budgetValue: '125',
      })
      await setProjectBilling(request, adminToken, betaProject.id, {
        hourlyRate: '280',
        budgetKind: 'hours',
        budgetValue: '40',
      })

      await login(page, 'admin')
      await page.goto(PROJECTS_PAGE)

      const table = page.getByRole('table')
      await expect(table).toBeVisible({ timeout: 30_000 })

      // The consulting columns the portfolio exists for (screen 3).
      await expect(table.getByRole('columnheader', { name: 'Customer', exact: true })).toBeVisible()
      await expect(table.getByRole('columnheader', { name: 'Rate', exact: true })).toBeVisible()
      await expect(table.getByRole('columnheader', { name: 'Hours', exact: true })).toBeVisible()
      await expect(table.getByRole('columnheader', { name: 'Cost', exact: true })).toBeVisible()
      await expect(table.getByRole('columnheader', { name: 'Budget', exact: true })).toBeVisible()

      // Narrow the page to this spec's own rows. The search must be fully applied
      // BEFORE selecting anything — the page clears the selection whenever the query
      // changes, so waiting for the debounced `q=` fetch avoids a torn selection.
      const filteredList = page.waitForResponse(
        (response) =>
          response.url().includes(TIME_PROJECTS_PATH)
          && response.request().method() === 'GET'
          && /[?&]q=/.test(response.url()),
        { timeout: 30_000 },
      )
      await page.getByPlaceholder(/search projects/i).fill(marker)
      await filteredList

      const alphaRow = table.getByRole('row').filter({ hasText: alphaProjectName })
      const betaRow = table.getByRole('row').filter({ hasText: betaProjectName })
      await expect(alphaRow).toBeVisible({ timeout: 30_000 })
      await expect(betaRow).toBeVisible()

      // The Customer column resolves the name from the project's own snapshot.
      await expect(alphaRow).toContainText(alphaCustomerName)
      await expect(betaRow).toContainText(betaCustomerName)

      // Screen 3 note 2 — money is never summed across the portfolio, so the table
      // carries no footer and no "Total" row of any kind.
      await expect(table.locator('tfoot')).toHaveCount(0)
      await expect(table.getByRole('row').filter({ hasText: /^\s*total/i })).toHaveCount(0)

      // Screen 3 note 4 — a selection spanning two customers blocks the report.
      await alphaRow.getByRole('checkbox').check()
      await betaRow.getByRole('checkbox').check()

      const bulkBar = page.getByTestId('projects-bulk-actions')
      await expect(bulkBar).toBeVisible()
      await expect(bulkBar).toContainText('2 selected')

      const reportButton = page.getByTestId('projects-bulk-report')
      await expect(reportButton).toBeVisible()
      await expect(reportButton).toBeDisabled()

      // Disabled is not enough: the reason has to be on screen, naming the offenders.
      const blockedReason = page.getByTestId('projects-bulk-report-blocked')
      await expect(blockedReason).toBeVisible()
      await expect(blockedReason).toContainText('A report always covers one customer.')
      await expect(blockedReason).toContainText(alphaCustomerName)
      await expect(blockedReason).toContainText(betaCustomerName)

      // Back inside a single customer the action becomes usable again and the
      // explanation disappears — the block is about the selection, not the feature.
      await betaRow.getByRole('checkbox').uncheck()
      await expect(bulkBar).toContainText('1 selected')
      await expect(reportButton).toBeEnabled()
      await expect(blockedReason).toHaveCount(0)
    } finally {
      if (alphaProject) await alphaProject.cleanup()
      if (betaProject) await betaProject.cleanup()
      // The projects were handed a pre-existing customer fixture, so their cleanup
      // does not own it — each customer is removed by its own idempotent cleanup.
      if (alphaCustomer) await alphaCustomer.cleanup()
      if (betaCustomer) await betaCustomer.cleanup()
    }
  })
})
