import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
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

async function settledBackgroundColor(locator: Locator): Promise<string> {
  let previous = ''
  await expect.poll(async () => {
    const current = await locator.evaluate(element => getComputedStyle(element).backgroundColor)
    const settled = current === previous
    previous = current
    return settled
  }, { intervals: [250] }).toBe(true)
  return previous
}

test.describe('design_system gallery', () => {
  test('style agents previews locally, applies branding, persists on reload and restores defaults', async ({ page }) => {
    await login(page, 'admin')
    await page.goto(`${GALLERY_PATH}?view=style-agents`)
    const apply = page.getByRole('button', { name: 'Apply', exact: true })
    const restore = page.getByRole('button', { name: 'Restore defaults', exact: true })
    await expect(page.getByRole('heading', { name: 'Style agents', level: 1 })).toBeVisible()
    const original = await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--primary'))
    try {
      await page.getByRole('textbox', { name: 'HEX color', exact: true }).fill('#2563EB')
      await page.getByLabel('Upload logo', { exact: true }).setInputFiles({
        name: 'logo.png', mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'),
      })
      await expect(page.getByAltText('Logo preview').first()).toBeVisible()
      expect(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--primary'))).toBe(original)
      await expect(apply).toBeEnabled()
      await apply.click()
      await expect(page.getByRole('status').filter({ hasText: 'Style applied in this browser.' })).toBeVisible()
      const applied = await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--primary'))
      expect(applied).not.toBe(original)
      await page.goto(`${GALLERY_PATH}?family=buttons`)
      await page.reload()
      await expect.poll(() => page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--primary'))).toBe(applied)
      await page.getByRole('link', { name: 'Style agents', exact: true }).click()
      await expect(page.getByRole('textbox', { name: 'HEX color', exact: true })).toHaveValue('#2563EB')
      await expect(page.getByAltText('Logo preview').first()).toBeVisible()
      await restore.click()
      await expect.poll(() => page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--primary'))).toBe(original)
      await expect(page.getByRole('textbox', { name: 'HEX color', exact: true })).toHaveValue('#2563EB')
    } finally {
      await page.goto(`${GALLERY_PATH}?view=style-agents`)
      await restore.click()
    }
  })

  test('color studio compares local palettes without changing the host or status meanings', async ({ page }) => {
    await login(page, 'admin')
    await page.goto(`${GALLERY_PATH}?view=style-agents`)
    const playground = page.getByRole('region', { name: 'Color studio', exact: true })
    await playground.getByRole('radio', { name: 'Compare', exact: true }).click()
    const light = playground.getByRole('region', { name: 'Interface preview — Light', exact: true })
    const dark = playground.getByRole('region', { name: 'Interface preview — Dark', exact: true })
    const hex = playground.getByRole('textbox', { name: 'HEX color', exact: true })
    const action = light.getByRole('button', { name: 'New project', exact: true })
    const status = light.getByText('Confirmed', { exact: true }).first()
    await expect(action).toBeVisible()
    await expect(dark).toBeVisible()
    await expect(playground.getByRole('radio', { name: 'Compare', exact: true })).toBeChecked()
    const rootTheme = await page.locator('html').getAttribute('class')
    const statusColor = await status.evaluate(element => getComputedStyle(element).color)
    const originalAction = await action.evaluate(element => getComputedStyle(element).backgroundColor)

    await hex.fill('#2563EB')
    await expect(action).not.toHaveCSS('background-color', originalAction)
    await expect(status).toHaveCSS('color', statusColor)
    // The button animates between colors, so read the value only once the transition has settled;
    // a mid-transition sample would never match again.
    const validAction = await settledBackgroundColor(action)
    await hex.fill('invalid')
    await expect(hex).toHaveAttribute('aria-invalid', 'true')
    await expect(action).toHaveCSS('background-color', validAction)
    await hex.fill('#2563EB')

    const secondary = playground.getByRole('textbox', { name: 'Secondary HEX', exact: true })
    const originalSecondary = await secondary.inputValue()
    const tertiary = playground.getByRole('textbox', { name: 'Tertiary HEX', exact: true })
    const originalTertiary = await tertiary.inputValue()
    await playground.getByRole('button', { name: 'Move right: Primary', exact: true }).click()
    await expect(hex).toHaveValue(originalSecondary)
    await expect(secondary).toHaveValue('#2563EB')
    await expect(tertiary).toHaveValue(originalTertiary)
    await playground.getByRole('button', { name: 'Move right: Primary', exact: true }).click()
    await expect(hex).toHaveValue('#2563EB')
    await expect(secondary).toHaveValue(originalSecondary)
    await playground.getByRole('combobox', { name: 'Color harmony', exact: true }).click()
    await page.getByRole('option', { name: 'Analogous', exact: true }).click()
    await expect(secondary).not.toHaveValue(originalSecondary)
    await secondary.fill('#123456')
    await expect(playground.getByRole('button', { name: /Copy color Secondary \d+ #123456/ })).toBeVisible()
    await playground.getByRole('combobox', { name: 'Light theme action', exact: true }).click()
    await page.getByRole('option', { name: /^800 ·/ }).click()
    await expect(playground.getByRole('combobox', { name: 'Light theme action', exact: true })).toContainText('800')

    await playground.getByRole('radio', { name: 'Dark', exact: true }).click()
    await expect(light).toHaveCount(0)
    await expect(dark).toBeVisible()
    expect(await page.locator('html').getAttribute('class')).toBe(rootTheme)
    await playground.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(hex).toHaveValue('#F4700D')
    await expect(playground.getByRole('radio', { name: 'Light', exact: true })).toBeChecked()
    await playground.getByRole('radio', { name: 'Compare', exact: true }).click()
    await expect(light).toBeVisible()
    await expect(dark).toBeVisible()

    // The studio lives in Style agents only; the color tokens page is a read-only reference that
    // points back to it.
    await page.goto(`${GALLERY_PATH}?family=foundations&entry=color-tokens`)
    await expect(page.getByText('Change your logo and colors in Style agents.', { exact: false })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Color studio', exact: true })).toHaveCount(0)
  })

  test('page loads for a user with design_system.view (spec path 1)', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page)
    // Default admin receives design_system.view via setup defaultRoleFeatures.
    await login(page, 'admin')
    // The assertion below guards the GALLERY route only — the post-login hop
    // through the dashboard can log its own transient fetch errors in the
    // ephemeral env, and those are not this module's to assert on.
    consoleErrors.length = 0
    await page.goto(GALLERY_PATH)

    await expect(page.getByRole('heading', { name: 'From a component to a complete interface.', level: 1 })).toBeVisible()
    const browse = page.getByRole('link', { name: 'Explore components', exact: true })
    await expect(browse).toHaveAttribute('href', `${GALLERY_PATH}?view=components`)
    await browse.click()
    await expect(page).toHaveURL(/\?view=components$/)
    await expect(page.getByRole('heading', { name: 'Components', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Buttons', level: 2 })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Preview width', exact: true })).toHaveCount(0)
    // Navigating away aborts the dashboard's in-flight layout fetch, which can
    // log asynchronously even after the reset above — same non-gallery noise.
    const galleryErrors = consoleErrors.filter((text) => !text.includes('DashboardScreen') && !text.includes('Failed to fetch'))
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

    await page.goto(`${GALLERY_PATH}?family=buttons&entry=button-group`)
    await expect(page.getByRole('heading', { name: 'ButtonGroup', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('region', { name: 'ButtonGroup', exact: true })).toBeVisible()
    await expect(page.getByPlaceholder(/search components/i)).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Preview width', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Back to Buttons', exact: true }).click()
    await expect(page).toHaveURL(/\?family=buttons$/)
    await expect(page.getByRole('heading', { name: 'Buttons', level: 1 })).toBeVisible()
  })

  test('search filters entries across families (spec path 6)', async ({ page }) => {
    await login(page, 'admin')
    await page.goto(`${GALLERY_PATH}?view=components`)
    const search = page.getByPlaceholder(/search components/i)

    await search.fill('icon-button')
    await expect(page.getByRole('heading', { name: 'IconButton', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'FancyButton', exact: true })).toHaveCount(0)

    // Zero-hit search shows the DS empty state, not a blank pane.
    await search.fill('no-such-component-zzz')
    await expect(page.getByText('No components match your search')).toBeVisible()

    await search.fill('')
    await expect(page.getByRole('heading', { name: 'Buttons', level: 2 })).toBeVisible()

    await search.fill('icon-button')
    await page.getByRole('heading', { name: 'IconButton', exact: true }).getByRole('link').click()
    await expect(page).toHaveURL(/family=buttons&entry=icon-button/)
    await expect(search).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'IconButton', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Buttons', exact: true })).toBeVisible()
  })

  test('settings opens the native component explorer with a deep-linked variant', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/settings')
    await page.getByRole('link', { name: /design system/i }).first().click()
    await expect(page).toHaveURL(/\/backend\/design-system/)
    await page.goto(`${GALLERY_PATH}?family=display&entry=table&variant=header-states`)
    const entry = page.getByRole('region', { name: 'Table', exact: true })
    await expect(entry.getByRole('combobox', { name: 'Variant', exact: true })).toHaveCount(0)
    await expect(entry.locator('#gallery-variant-table-header-states')).toBeVisible()
    await expect(entry.locator('#gallery-variant-table-cells-48')).toBeAttached()
    await expect(page.locator('#gallery-entry-avatar')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Preview width', exact: true })).toHaveCount(0)
    await expect(page.getByPlaceholder(/search components/i)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Table', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Data display', exact: true })).toBeVisible()
    const cellExample = entry.locator('#gallery-variant-table-cells-48')
    await expect(cellExample.locator('tbody tr')).toHaveCount(12)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await cellExample.getByRole('button', { name: 'Copy code', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('@open-mercato/ui/primitives/table')
    expect(page.url()).not.toContain(':6006')
    await expect(page.locator('iframe[src*="6006"]')).toHaveCount(0)
  })

  test('foundations remain a continuous guide without variant or viewport controls', async ({ page }) => {
    await login(page, 'admin')
    await page.goto(`${GALLERY_PATH}?family=foundations`)
    await expect(page.getByRole('heading', { name: 'Foundations', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Brand colors', level: 2 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Chart palette', level: 2 })).toBeAttached()
    await expect(page.getByRole('combobox', { name: 'Variant', exact: true })).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Preview width', exact: true })).toHaveCount(0)
    await page.goto(`${GALLERY_PATH}?family=foundations&entry=color-roles`)
    await expect(page.getByRole('region', { name: 'Color roles', exact: true })).toBeInViewport()
    await expect(page.getByRole('heading', { name: 'Brand colors', level: 2 })).toBeAttached()
    await page.getByRole('link', { name: 'Back to Components', exact: true }).click()
    await expect(page).toHaveURL(/\?view=components$/)
  })

  test('icons use one collection selector and one local search', async ({ page }) => {
    await login(page, 'admin')
    await page.goto(`${GALLERY_PATH}?family=icons&entry=source-icons`)
    await expect(page.getByRole('heading', { name: 'Icons', level: 1 })).toBeVisible()
    const collection = page.getByRole('combobox', { name: 'Collection', exact: true })
    await expect(collection).toHaveCount(1)
    await expect(collection).toContainText('Icons')
    await expect(page.getByPlaceholder(/search components/i)).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Preview width', exact: true })).toHaveCount(0)
    const iconSearch = page.getByRole('searchbox', { name: 'Filter icons…', exact: true })
    await expect(iconSearch).toHaveCount(1)
    await expect(page.getByRole('searchbox')).toHaveCount(1)
    await iconSearch.fill('activity')
    await expect(page.getByRole('button', { name: 'activity', exact: true })).toBeVisible()
    await collection.click()
    await page.getByRole('option', { name: 'Logos', exact: true }).click()
    await expect(page).toHaveURL(/family=icons&entry=source-artwork&variant=brands/)
    await expect(iconSearch).toHaveCount(0)
    await expect(page.getByRole('searchbox', { name: 'Search artwork…', exact: true })).toHaveCount(1)
    await expect(page.getByRole('searchbox')).toHaveCount(1)
    await expect(page.getByPlaceholder(/search components/i)).toHaveCount(0)
  })

})
