import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test.describe('TC-AUTH-001: Template login flow', () => {
  test('should login with default admin credentials', async ({ page }) => {
    await login(page)
    await expect(page).toHaveURL(/\/backend/)
  })
})
