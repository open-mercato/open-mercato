import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

const GALLERY_PATH = '/backend/design-system'

async function loginWithCredentials(page: Page, email: string, password: string): Promise<void> {
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', password)
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok()).toBeTruthy()
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test.describe('design_system gallery', () => {
  test('page loads for a user with design_system.view (spec path 1)', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page)
    // Default admin receives design_system.view via setup defaultRoleFeatures.
    await login(page, 'admin')
    // The assertion below guards the GALLERY route only — the post-login hop
    // through the dashboard can log its own transient fetch errors in the
    // ephemeral env, and those are not this module's to assert on.
    consoleErrors.length = 0
    await page.goto(GALLERY_PATH)

    // Gallery shell renders with the first family's entries (foundations).
    await expect(page.getByRole('heading', { name: 'Brand colors', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Chart palette', exact: true })).toBeVisible()
    // The lazy-family skeleton must have resolved.
    await expect(page.getByTestId('gallery-family-skeleton')).toHaveCount(0)
    // Navigating away aborts the dashboard's in-flight layout fetch, which can
    // log asynchronously even after the reset above — same non-gallery noise.
    const galleryErrors = consoleErrors.filter((text) => !text.includes('DashboardScreen'))
    expect(galleryErrors).toEqual([])
  })

  test('access is denied without design_system.view (spec path 2)', async ({ page, request }) => {
    const stamp = randomUUID()
    const email = `qa-design-system-${stamp}@example.com`
    const password = 'StrongSecret123!'
    let token: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      token = await getAuthToken(request, 'superadmin')
      const { tenantId, organizationId } = getTokenContext(token)
      // Fresh role with no feature grants — in particular no design_system.view.
      roleId = await createRoleFixture(request, token, {
        name: `qa-design-system-none-${stamp}`,
        tenantId,
      })
      userId = await createUserFixture(request, token, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA Design System NoAccess',
      })

      await loginWithCredentials(page, email, password)
      await page.goto(GALLERY_PATH)

      // Standard access-denied UX, not a blank page and not the gallery.
      await expect(page.getByRole('heading', { name: 'Button', exact: true })).toHaveCount(0)
      await expect(
        page.getByText(/access denied|forbidden|not authorized|permission/i).first(),
      ).toBeVisible()
    } finally {
      await deleteUserIfExists(request, token, userId)
      await deleteRoleIfExists(request, token, roleId)
    }
  })

  test('family navigation via query param deep link (spec path 3)', async ({ page }) => {
    await login(page, 'admin')

    // Clicking the family in the section nav updates the query param.
    await page.goto(GALLERY_PATH)
    await page.getByRole('link', { name: 'Buttons' }).click()
    await expect(page).toHaveURL(/\/backend\/design-system\?family=buttons/)
    await expect(page.getByRole('heading', { name: 'Button', exact: true })).toBeVisible()

    // Direct navigation to ?family=...&entry=... scrolls the entry into view.
    await page.goto(`${GALLERY_PATH}?family=buttons&entry=button-group`)
    const target = page.locator('#gallery-entry-button-group')
    await expect(target).toBeVisible()
    await expect(target).toBeInViewport()
  })

  test('search filters entries across families (spec path 6)', async ({ page }) => {
    await login(page, 'admin')
    await page.goto(GALLERY_PATH)
    const search = page.getByPlaceholder(/search components/i)

    await search.fill('icon-button')
    await expect(page.getByRole('heading', { name: 'IconButton', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'FancyButton', exact: true })).toHaveCount(0)

    // Zero-hit search shows the DS empty state, not a blank pane.
    await search.fill('no-such-component-zzz')
    await expect(page.getByText('No components match your search')).toBeVisible()

    // Clearing restores the active family (foundations is the default).
    await search.fill('')
    await expect(page.getByRole('heading', { name: 'Brand colors', exact: true })).toBeVisible()
  })
})
