import { randomUUID } from 'node:crypto'
import { test, expect, type Page, type Response } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

async function expectDocumentPolicy(page: Page, response: Response | null) {
  expect(response?.ok()).toBe(true)
  const policy = response?.headers()['content-security-policy'] ?? ''
  const scriptPolicy = policy.split('; ').find((directive) => directive.startsWith('script-src ')) ?? ''
  const stylePolicy = policy.split('; ').find((directive) => directive.startsWith('style-src ')) ?? ''
  expect(scriptPolicy).not.toMatch(/unsafe-inline|unsafe-eval/)
  expect(stylePolicy).not.toContain('unsafe-inline')
  const nonce = scriptPolicy.match(/'nonce-([^']+)'/)?.[1]
  expect(nonce).toBeTruthy()
  expect(await page.locator('#om-theme-init').evaluate((script: HTMLScriptElement) => script.nonce)).toBe(nonce)
  const inlineNonces = await page.locator('script:not([src])').evaluateAll((scripts) => scripts
    .filter((script) => !script.getAttribute('type') || /javascript/.test(script.getAttribute('type') ?? ''))
    .map((script) => (script as HTMLScriptElement).nonce))
  expect(inlineNonces.length).toBeGreaterThan(0)
  expect(inlineNonces.every((value) => value === nonce)).toBe(true)
  return nonce
}

test('production login hydrates with fresh nonces and rejects injected inline scripts and styles', async ({ page }) => {
  const firstNonce = await expectDocumentPolicy(page, await page.goto('/login'))
  await expect(page.locator('input[type="password"]')).toBeVisible()
  await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'document.documentElement.dataset.cspInjected="executed"'
    document.body.appendChild(script)
    const style = document.createElement('style')
    style.textContent = ':root{--om-csp-injected:executed}'
    document.head.appendChild(style)
  })
  expect(await page.evaluate(() => document.documentElement.dataset.cspInjected)).toBeUndefined()
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--om-csp-injected'))).toBe('')
  const nextNonce = await expectDocumentPolicy(page, await page.reload())
  expect(nextNonce).not.toBe(firstNonce)
})

test('production backend hydrates for a self-contained account', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const { organizationId } = getTokenContext(token)
  const email = `csp-${randomUUID()}@example.com`
  const password = `Csp-${randomUUID()}`
  let userId: string | null = null
  try {
    userId = await createUserFixture(request, token, { email, password, organizationId, roles: ['admin'] })
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').fill(password)
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/backend/)
    await expectDocumentPolicy(page, await page.goto('/backend'))
    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('a client-side exception has occurred')
  } finally {
    await deleteUserIfExists(request, token, userId)
  }
})
