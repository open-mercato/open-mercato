import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test.describe('TC-UMES-001: Foundation and Menu Injection', () => {
  test.describe.configure({ timeout: 60_000 })

  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers', { waitUntil: 'commit' })
    await page.waitForLoadState('domcontentloaded')
  })

  test('TC-UMES-H01: renders one page heading with the form title nested beneath it', async ({ page }) => {
    await expect(page.locator('main h1')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: 'UMES Phase A-D Features Demo' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'CRUD form event harness' })).toBeVisible()
  })

  test('should render injected sidebar item and navigate to todos page', async ({ page }) => {
    test.slow()

    await expect(page.getByTestId('phase-ab-sidebar-items')).toContainText('example-todos-shortcut', { timeout: 30_000 })
    const sidebarItem = page.getByTestId('phase-ab-open-todos')
    await expect(sidebarItem).toHaveAttribute('href', '/backend/todos')
    await page.goto('/backend/todos', { waitUntil: 'commit' })
    await expect(page).toHaveURL(/\/backend\/todos(?:\?.*)?$/)
  })

  test('should render injected profile dropdown item and navigate to todo create', async ({ page }) => {
    test.slow()

    await expect(page.getByTestId('phase-ab-profile-items')).toContainText('example-quick-add-todo', { timeout: 30_000 })
    const injectedItem = page.getByTestId('phase-ab-open-todo-create')
    await expect(injectedItem).toHaveAttribute('href', '/backend/todos/create')
    await page.goto('/backend/todos/create', { waitUntil: 'commit' })
    await expect(page).toHaveURL(/\/backend\/todos\/create(?:\?.*)?$/)
  })
})
