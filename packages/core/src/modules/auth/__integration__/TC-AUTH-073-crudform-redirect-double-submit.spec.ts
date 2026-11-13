import { expect, test, type Page } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TC-AUTH-073: CrudForm keeps the submit lock held through a delayed
 * successRedirect — the browser/API regression for #8645, deferred from the
 * PR #8683 review (issue #8715).
 *
 * Empirically, the real create-to-list transition unmounts the create form
 * ~200-400ms after the create POST resolves (observed against this exact
 * build). That window is real but too timing-sensitive to assert against
 * directly, so each test delays the destination route's RSC navigation
 * fetch (`GET /backend/users?flash=...&_rsc=...`) by a couple of seconds via
 * `page.route`, widening the window deterministically before firing rapid
 * repeated triggers — exactly the race `redirectNavigationStarted` in
 * `CrudForm.tsx` (`handleSubmit` / `navigateWithGuard`) protects.
 *
 * Two boundaries already have coverage elsewhere and are intentionally not
 * duplicated here:
 * - the pre-existing in-flight-submit guard (#1539) and the ordinary
 *   no-redirect repeated-save path — `packages/ui/src/backend/__tests__/CrudForm.doubleSubmit.test.tsx`
 * - the onBeforeNavigate-denial-releases-the-lock path — same file (added
 *   alongside this spec), since reproducing a blocking injection widget
 *   through a real backend page is disproportionate to what it would prove
 *   beyond the existing unit coverage.
 */

type UserListItem = { id?: string; email?: string }

async function countUsersByEmail(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  email: string,
): Promise<UserListItem[]> {
  const response = await apiRequest(request, 'GET', `/api/auth/users?search=${encodeURIComponent(email)}&pageSize=50`, { token })
  const body = await readJsonSafe<{ items?: UserListItem[] }>(response)
  const items = Array.isArray(body?.items) ? body!.items! : []
  return items.filter((item) => typeof item.email === 'string' && item.email.toLowerCase() === email.toLowerCase())
}

async function openCreateForm(page: Page, locale: 'en' | 'pl'): Promise<void> {
  if (locale === 'pl') {
    await page.context().addCookies([{ name: 'locale', value: 'pl', url: process.env.BASE_URL || 'http://localhost:3000' }])
  }
  await page.goto('/backend/users/create', { waitUntil: 'domcontentloaded' })
}

async function fillCreateForm(page: Page, email: string): Promise<void> {
  // Wait for a signal that client hydration has actually finished *before*
  // filling anything. The organization <select> only populates its options
  // after a post-hydration client fetch resolves; filling earlier lands on a
  // not-yet-hydrated DOM node — the raw element value changes, but React's
  // own controlled state (what submit-time validation reads) never does, so
  // the submit silently fails local validation instead of racing the server.
  // (`waitForLoadState('networkidle')` is not an alternative here: the DOM
  // Event Bridge SSE stream keeps the page "busy" forever.)
  const orgSelect = page.locator('main').locator('select').first()
  await expect(orgSelect).toBeVisible()
  await expect.poll(async () => orgSelect.evaluate((element) => (element as HTMLSelectElement).options.length)).toBeGreaterThan(1)
  const orgValue = await orgSelect.evaluate((element) => {
    const select = element as HTMLSelectElement
    for (const option of Array.from(select.options)) {
      if (option.value && option.value.trim().length > 0) return option.value
    }
    return ''
  })
  if (orgValue) await orgSelect.selectOption(orgValue)

  await page.locator('[data-crud-field-id="email"] input').first().fill(email)
  await page.locator('[data-crud-field-id="password"] input').first().fill('StrongSecret123!')
}

async function delayRedirectNavigation(page: Page, delayMs: number): Promise<void> {
  await page.route('**/backend/users?*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    await route.continue()
  })
}

async function raceCreateSubmit(
  page: Page,
  createButton: ReturnType<Page['getByRole']>,
  emailInput: ReturnType<Page['locator']>,
): Promise<void> {
  await createButton.click()
  // Fire everything else without waiting for navigation, so every trigger
  // below lands inside the delayed-redirect window set up by the caller.
  await createButton.click({ force: true }).catch(() => {})
  await emailInput.focus().catch(() => {})
  await page.keyboard.press('Enter').catch(() => {})
  await page.keyboard.down('Meta')
  await page.keyboard.press('Enter').catch(() => {})
  await page.keyboard.up('Meta')
  await page.evaluate(() => {
    const form = document.querySelector('form')
    form?.requestSubmit()
  }).catch(() => {})
}

test.describe('TC-AUTH-073: CrudForm redirect double-submit protection (#8645)', () => {
  test.describe.configure({ timeout: 60_000 })

  test('rapid double-click, Enter, Cmd/Ctrl+Enter and a direct submit during a delayed redirect create exactly one user', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const email = `qa-tc-auth-073-race-${stamp}@example.com`
    let createdUserId: string | null = null

    try {
      await login(page, 'admin')
      await openCreateForm(page, 'en')
      await fillCreateForm(page, email)
      await delayRedirectNavigation(page, 2_500)

      let createPostCount = 0
      page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().includes('/api/auth/users') && !req.url().includes('/acl')) {
          createPostCount += 1
        }
      })

      const createButton = page.getByRole('button', { name: 'Create' }).first()
      const emailInput = page.locator('[data-crud-field-id="email"] input').first()
      await raceCreateSubmit(page, createButton, emailInput)

      await expect(page).toHaveURL(/\/backend\/users(?:\?.*)?$/, { timeout: 10_000 })
      expect(createPostCount, 'exactly one create POST should have reached the server').toBe(1)

      const matches = await countUsersByEmail(request, adminToken, email)
      expect(matches.length, 'exactly one user row should exist for this email').toBe(1)
      createdUserId = matches[0]?.id ?? null
    } finally {
      await deleteUserIfExists(request, adminToken, createdUserId)
    }
  })

  test('the same race at a 390px viewport under the Polish locale still creates exactly one user', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const email = `qa-tc-auth-073-race-pl-${stamp}@example.com`
    let createdUserId: string | null = null

    try {
      await login(page, 'admin')
      await openCreateForm(page, 'pl')
      await fillCreateForm(page, email)
      await delayRedirectNavigation(page, 2_500)

      let createPostCount = 0
      page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().includes('/api/auth/users') && !req.url().includes('/acl')) {
          createPostCount += 1
        }
      })

      const createButton = page.getByRole('button', { name: 'Utwórz' }).first()
      const emailInput = page.locator('[data-crud-field-id="email"] input').first()
      await raceCreateSubmit(page, createButton, emailInput)

      await expect(page).toHaveURL(/\/backend\/users(?:\?.*)?$/, { timeout: 10_000 })
      expect(createPostCount, 'exactly one create POST should have reached the server').toBe(1)

      const matches = await countUsersByEmail(request, adminToken, email)
      expect(matches.length, 'exactly one user row should exist for this email').toBe(1)
      createdUserId = matches[0]?.id ?? null
    } finally {
      await page.request.post('/api/auth/locale', { data: { locale: 'en' } }).catch(() => {})
      await deleteUserIfExists(request, adminToken, createdUserId)
    }
  })

  test('a real duplicate-email 400 releases the lock, letting a corrected retry create exactly one user', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const duplicateEmail = `qa-tc-auth-073-dup-${stamp}@example.com`
    const retryEmail = `qa-tc-auth-073-retry-${stamp}@example.com`
    let fixtureUserId: string | null = null
    let retryUserId: string | null = null

    try {
      const fixtureResponse = await apiRequest(request, 'POST', '/api/auth/users', {
        token: adminToken,
        data: { email: duplicateEmail, password: 'StrongSecret123!', organizationId, roles: [] },
      })
      expect(fixtureResponse.status(), 'fixture user create should return 201').toBe(201)
      fixtureUserId = (await readJsonSafe<{ id?: string }>(fixtureResponse))?.id ?? null

      await login(page, 'admin')
      await openCreateForm(page, 'en')
      await fillCreateForm(page, duplicateEmail)

      const createButton = page.getByRole('button', { name: 'Create' }).first()
      const errorResponse = page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url().includes('/api/auth/users') && !res.url().includes('/acl'),
      )
      await createButton.click()
      expect((await errorResponse).status(), 'duplicate email within the same tenant should be rejected').toBe(400)

      // The error releases the lock (CrudForm's catch branch leaves
      // redirectNavigationStarted false) — the page stays on the create form
      // and the button is interactable again, so a corrected retry goes through.
      await expect(page).toHaveURL(/\/backend\/users\/create(?:\?.*)?$/)
      await expect(createButton).toBeEnabled()

      const emailInput = page.locator('[data-crud-field-id="email"] input').first()
      await emailInput.fill(retryEmail)
      const successResponse = page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url().includes('/api/auth/users') && !res.url().includes('/acl'),
      )
      await createButton.click()
      expect((await successResponse).status(), 'the corrected retry should succeed').toBe(201)
      await expect(page).toHaveURL(/\/backend\/users(?:\?.*)?$/, { timeout: 10_000 })

      const retryMatches = await countUsersByEmail(request, adminToken, retryEmail)
      expect(retryMatches.length, 'exactly one user row should exist for the retried email').toBe(1)
      retryUserId = retryMatches[0]?.id ?? null

      const duplicateMatches = await countUsersByEmail(request, adminToken, duplicateEmail)
      expect(duplicateMatches.length, 'the rejected duplicate submit must not have created a second row').toBe(1)
    } finally {
      await deleteUserIfExists(request, adminToken, fixtureUserId)
      await deleteUserIfExists(request, adminToken, retryUserId)
    }
  })
})
