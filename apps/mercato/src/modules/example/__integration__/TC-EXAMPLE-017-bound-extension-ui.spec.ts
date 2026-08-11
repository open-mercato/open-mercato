import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
} from '@open-mercato/core/helpers/integration/optimisticLockUi'

export const integrationMeta = {
  dependsOnModules: ['example', 'customers', 'events'],
}

const TODOS_API = '/api/example/todos'
const TODOS_LIST_PATH = '/backend/todos'
const COMPONENT_OVERRIDES_PATH = '/backend/component-overrides'

function readTokenClaims(token: string): { tenantId?: string; orgId?: string | null } {
  const parts = token.split('.')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as {
    tenantId?: string
    orgId?: string | null
  }
}

async function loginWithCredentials(page: Page, email: string, password: string): Promise<void> {
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', password)
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok(), `limited-user login failed: ${response.status()}`).toBeTruthy()
  const payload = await readJsonSafe<{ token?: string }>(response)
  expect(payload?.token).toBeTruthy()
  const claims = readTokenClaims(payload!.token!)
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const cookies = [
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' as const },
  ]
  if (claims.tenantId) {
    cookies.push({ name: 'om_selected_tenant', value: claims.tenantId, url: baseUrl, sameSite: 'Lax' as const })
  }
  if (claims.orgId) {
    cookies.push({ name: 'om_selected_org', value: claims.orgId, url: baseUrl, sameSite: 'Lax' as const })
  }
  await page.context().addCookies(cookies)
}

function collectExampleLifecycleLogs(page: Page): string[] {
  const entries: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('[Example Widget]') || message.text().includes('[UMES] Nested addon')) {
      entries.push(message.text())
    }
  })
  return entries
}

/**
 * Milestone B coverage for the extension surfaces this module BINDS, as opposed to the ones it
 * contributes into other modules.
 *
 * `extension-points.ts` declares two hosts — the Todo DataTable (`example.todos.list`) and the
 * Todo CrudForm (`crud-form:example.todo`) — and each is only a real host if its declared source
 * file actually renders the spot. A declaration nothing consumes still looks correct in review
 * and still resolves at runtime for whoever injects into it, which is exactly why the generator
 * marks it `unbound-declaration`; this test is the runtime half of that check.
 *
 * The three `ComponentOverride` modes are exercised at their own call sites too, because they
 * differ in kind and the difference is only visible in the rendered tree: `replace` discards the
 * host's implementation, `props` keeps it and feeds it transformed props, and `wrapper` renders
 * the host inside something else. A test that only asserted "the override is registered" would
 * pass for all three no matter which one actually ran.
 */
test.describe('TC-EXAMPLE-017: the module\'s bound DataTable and CrudForm hosts, and all three component modes', () => {
  test('the bound CrudForm host renders its injected widget, its nested spot, and every payload category', async ({ page }) => {
    test.slow()
    await login(page, 'admin')
    await page.goto('/backend/todos/create', { waitUntil: 'domcontentloaded' })

    // The host binding: `TodoForm.tsx` passes `entityId="example:todo"`, `CrudForm` normalizes it
    // to `example.todo`, and the injection table keys `crud-form:example.todo` off that. If the
    // form stopped rendering the spot, the declaration in `extension-points.ts` would still read
    // as correct and nothing else would notice.
    const injected = page.getByText('Example Injection Widget')
    await expect(injected).toBeVisible({ timeout: 20_000 })

    // Every payload category the CrudForm host publishes has its own readout. They start null,
    // which is the point: the categories are distinct channels, not one blob.
    for (const testId of [
      'widget-field-change',
      'widget-field-warning',
      'widget-navigation',
      'widget-visibility',
      'widget-app-event',
      'widget-save-guard',
      'widget-transform-form-data',
      'widget-transform-display-data',
      'widget-transform-validation',
      'widget-recursive-before-save',
    ]) {
      await expect(page.getByTestId(testId), `${testId} must be rendered by the injected widget`).toBeVisible()
    }

    // Recursive injection: the injected widget is itself a host, and its nested spot resolves.
    // A one-level-only implementation would render the outer widget and stop here.
    const addonHost = page.getByTestId('widget-recursive-addon-host')
    await expect(addonHost).toBeVisible()
    await expect(addonHost.getByText(/Addon injected into validation widget/i)).toBeVisible()

    // `onFieldChange` is the category most easily faked by a widget that just renders a label,
    // so it is driven for real: typing into a host field must reach the injected widget.
    const titleInput = page.locator('[data-crud-field-id="title"] input').first()
    // Re-typed on every poll attempt: the widget subscribes to the form's shared state after its
    // own mount, so a single keystroke landing before that subscription is a real race rather
    // than a missing handler, and retrying the input is what distinguishes the two.
    await expect
      .poll(async () => {
        await titleInput.fill(`TC-EXAMPLE-017 ${randomUUID().slice(0, 8)}`)
        await titleInput.blur()
        return (await page.getByTestId('widget-field-change').textContent()) ?? ''
      }, { timeout: 30_000, intervals: [500, 1000, 2000, 3000] })
      .not.toBe('fieldChange=null')
  })

  test('runs validation, transform, recursive, save and after-save phases through a real create', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const logs = collectExampleLifecycleLogs(page)
    let todoId: string | null = null

    try {
      await login(page, 'admin')
      await page.goto('/backend/todos/create', { waitUntil: 'domcontentloaded' })
      const titleInput = page.locator('[data-crud-field-id="title"] input').first()
      await expect(page.getByText('Example Injection Widget')).toBeVisible({ timeout: 20_000 })
      await page.locator('[data-crud-field-id="cf_priority"] input[type="number"]').first().fill('3')
      await page.locator('[data-crud-field-id="cf_severity"]').getByRole('combobox').first().click()
      await page.getByRole('option', { name: 'Medium' }).click()

      const blockedTitle = `[block] TC-EXAMPLE-017 ${suffix}`
      await titleInput.fill(blockedTitle)
      await titleInput.locator('xpath=ancestor::form').first().locator('button[type="submit"]').first().click()
      await expect(page.getByTestId('widget-save-guard')).toContainText('"ok":false')
      await expect(page).toHaveURL(/\/backend\/todos\/create(?:\?.*)?$/)
      expect(logs.some((entry) => entry.includes('Before save validation'))).toBe(true)
      expect(logs.some((entry) => entry.includes('Save triggered'))).toBe(false)

      logs.length = 0
      const rawTitle = `[transform] TC-EXAMPLE-017 ${suffix}`
      const expectedTitle = `TC-EXAMPLE-017 ${suffix} (transformed)`
      await titleInput.fill(rawTitle)
      const [createRequest, createResponse] = await Promise.all([
        page.waitForRequest((candidate) => candidate.url().includes(TODOS_API) && candidate.method() === 'POST'),
        page.waitForResponse((response) => response.url().includes(TODOS_API) && response.request().method() === 'POST'),
        titleInput.locator('xpath=ancestor::form').first().locator('button[type="submit"]').first().click(),
      ])
      expect(createResponse.ok(), `create failed: ${createResponse.status()}`).toBeTruthy()
      todoId = ((await createResponse.json()) as { id?: string }).id ?? null
      expect(todoId).toBeTruthy()
      expect((createRequest.postDataJSON() as { title?: string }).title).toBe(expectedTitle)
      await expect(page).toHaveURL(/\/backend\/todos(?:\?.*)?$/)

      expect(logs.findIndex((entry) => entry.includes('Before save validation'))).toBeGreaterThanOrEqual(0)
      expect(logs.findIndex((entry) => entry.includes('Save triggered'))).toBeGreaterThan(
        logs.findIndex((entry) => entry.includes('Before save validation')),
      )
      expect(logs.findIndex((entry) => entry.includes('After save complete'))).toBeGreaterThan(
        logs.findIndex((entry) => entry.includes('Save triggered')),
      )
      expect(logs.some((entry) => entry.includes('[UMES] Nested addon widget onBeforeSave fired'))).toBe(true)

      const read = await apiRequest(request, 'GET', `${TODOS_API}?ids=${todoId}&page=1&pageSize=1`, { token })
      const item = ((await read.json()) as { items?: Array<{ title?: string }> }).items?.[0]
      expect(item?.title).toBe(expectedTitle)
    } finally {
      await deleteEntityIfExists(request, token, TODOS_API, todoId)
    }
  })

  test('runs the delete success and stale-delete error lifecycles at the real CrudForm host', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const email = `tc-example-017-delete-${suffix}@example.com`
    const password = 'StrongSecret123!'
    const logs = collectExampleLifecycleLogs(page)
    let successTodoId: string | null = null
    let staleTodoId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, token, {
        name: `TC-EXAMPLE-017 delete lifecycle ${suffix}`,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, token, {
        roleId,
        features: [
          'example.backend',
          'example.view',
          'example.todos.view',
          'example.todos.manage',
          'example.widgets.injection',
        ],
        organizations: [scope.organizationId],
      })
      userId = await createUserFixture(request, token, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: 'TC EXAMPLE 017 delete lifecycle',
      })

      for (const branch of ['success', 'stale'] as const) {
        const created = await apiRequest(request, 'POST', TODOS_API, {
          token,
          data: { title: `TC-EXAMPLE-017 delete ${branch} ${suffix}`, cf_priority: 1, cf_severity: 'low' },
        })
        expect(created.ok()).toBeTruthy()
        const createdId = ((await created.json()) as { id?: string }).id ?? null
        expect(createdId).toBeTruthy()
        if (branch === 'success') successTodoId = createdId
        else staleTodoId = createdId
      }

      // Use the exact Example permissions needed by this host. In enterprise-enabled CI an
      // administrator also receives record_locks.view; its proactive conflict widget correctly
      // blocks a stale delete during onBeforeDelete, before the CrudForm error lifecycle can run.
      // This scoped user keeps the test on the Example host and lets the stale DELETE reach the
      // API, where the 409 drives onDeleteError as the capability under test requires.
      await loginWithCredentials(page, email, password)
      await page.goto(`/backend/todos/${encodeURIComponent(successTodoId!)}/edit`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('[data-crud-field-id="title"] input').first()).toHaveValue(
        `TC-EXAMPLE-017 delete success ${suffix}`,
      )
      await expect(page.getByText('Example Injection Widget')).toBeVisible({ timeout: 20_000 })
      logs.length = 0
      await page.getByRole('button', { name: /^Delete$/ }).first().click()
      const successDialog = page.getByRole('alertdialog')
      await expect(successDialog).toBeVisible()
      const successResponsePromise = page.waitForResponse((response) =>
        response.url().includes(TODOS_API) && response.request().method() === 'DELETE')
      await successDialog.getByRole('button', { name: /^Confirm$/ }).click()
      expect((await successResponsePromise).ok()).toBeTruthy()
      await expect(page).toHaveURL(/\/backend\/todos(?:\?.*)?$/)
      expect(logs.findIndex((entry) => entry.includes('Before delete'))).toBeGreaterThanOrEqual(0)
      expect(logs.findIndex((entry) => entry.includes('Delete triggered'))).toBeGreaterThan(
        logs.findIndex((entry) => entry.includes('Before delete')),
      )
      expect(logs.findIndex((entry) => entry.includes('After delete complete'))).toBeGreaterThan(
        logs.findIndex((entry) => entry.includes('Delete triggered')),
      )

      await page.goto(`/backend/todos/${encodeURIComponent(staleTodoId!)}/edit`, { waitUntil: 'domcontentloaded' })
      const staleTitle = `TC-EXAMPLE-017 delete stale ${suffix}`
      await expect(page.locator('[data-crud-field-id="title"] input').first()).toHaveValue(staleTitle)
      await expect(page.getByText('Example Injection Widget')).toBeVisible({ timeout: 20_000 })
      await bumpRecordViaApi(request, token, TODOS_API, { id: staleTodoId, title: `${staleTitle} moved` })
      logs.length = 0
      await page.getByRole('button', { name: /^Delete$/ }).first().click()
      const staleDialog = page.getByRole('alertdialog')
      await expect(staleDialog).toBeVisible()
      const staleResponsePromise = page.waitForResponse((response) =>
        response.url().includes(TODOS_API) && response.request().method() === 'DELETE')
      await staleDialog.getByRole('button', { name: /^Confirm$/ }).click()
      expect((await staleResponsePromise).status()).toBe(409)
      await expectConflictBanner(page)
      expect(logs.some((entry) => entry.includes('Before delete'))).toBe(true)
      expect(logs.some((entry) => entry.includes('Delete triggered'))).toBe(true)
      expect(logs.some((entry) => entry.includes('Delete failed'))).toBe(true)
      expect(logs.some((entry) => entry.includes('After delete complete'))).toBe(false)
    } finally {
      await deleteEntityIfExists(request, token, TODOS_API, successTodoId)
      await deleteEntityIfExists(request, token, TODOS_API, staleTodoId)
      await deleteUserIfExists(request, token, userId)
      await deleteRoleIfExists(request, token, roleId)
    }
  })

  test('keeps the Todo form available while hiding its widgets from a user without the widget feature', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const email = `tc-example-017-widget-${suffix}@example.com`
    const password = 'StrongSecret123!'
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `TC-EXAMPLE-017 widget gate ${suffix}`,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['example.todos.manage'],
        organizations: [scope.organizationId],
      })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: 'TC EXAMPLE 017 widget gate',
      })

      await loginWithCredentials(page, email, password)
      await page.goto('/backend/todos/create', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('[data-crud-field-id="title"] input').first()).toBeVisible()
      await expect(page.getByText('Example Injection Widget')).toHaveCount(0)
      await expect(page.getByTestId('widget-recursive-addon-host')).toHaveCount(0)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('the bound DataTable host resolves its bulk-action spot from the perspective table id', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    let todoId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', TODOS_API, {
        token,
        data: { title: `TC-EXAMPLE-017 table ${suffix}`, cf_priority: 1, cf_severity: 'low' },
      })
      expect(created.ok()).toBeTruthy()
      todoId = ((await created.json()) as { id?: string }).id ?? null

      await login(page, 'admin')
      await page.goto(TODOS_LIST_PATH, { waitUntil: 'domcontentloaded' })
      // Same two hazards as TC-EXAMPLE-003, handled the same way: scope to `main` so the
      // sidebar's own placeholder-"Search" input is not what gets typed into, and re-type on
      // every attempt, because DataTable's asynchronous view restore clears a search typed
      // before it lands.
      const searchInput = page.locator('main input[placeholder="Search"]').first()
      await expect(searchInput).toBeVisible({ timeout: 60_000 })
      await expect
        .poll(async () => {
          await searchInput.fill(suffix)
          await page.waitForTimeout(1500)
          return page.locator('tbody tr').count()
        }, { timeout: 60_000, intervals: [1000, 2000, 3000] })
        .toBe(1)

      // `TodosTable` sets `perspective.tableId`, `DataTable` derives `extensionTableId` from it,
      // and the bulk-action spot id is built from that. The selection column exists ONLY when a
      // bulk action resolved through that chain, so its presence is the binding assertion.
      await expect(page.locator('thead').getByRole('checkbox')).toBeVisible()
      await page.locator('tbody tr').first().getByRole('checkbox').check()
      await expect(page.getByRole('button', { name: /Mark selected todos done/i })).toBeVisible()
    } finally {
      await deleteEntityIfExists(request, token, TODOS_API, todoId)
    }
  })

  test('replace mode discards the host implementation and props mode reaches the replacement', async ({ page }) => {
    test.slow()
    await login(page, 'admin')
    await page.goto(COMPONENT_OVERRIDES_PATH, { waitUntil: 'domcontentloaded' })

    // `replace`: the base panel is GONE, not decorated. Asserting only that the replacement is
    // present would also pass for a wrapper, which is the distinction under test.
    await expect(page.getByTestId('example-override-showcase-replacement')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('example-override-showcase-base')).toHaveCount(0)

    // `props`: a second override on the SAME handle transformed the props the replacement then
    // received. The note is the only place that shows the transform ran end to end — the
    // replacement renders either way, so a transform that silently did nothing would be
    // invisible without it.
    const note = page.getByTestId('example-override-showcase-note')
    await expect(note).toBeVisible()
    await expect(note).toContainText('example')

    // And the replacement parsed its props rather than trusting them: the invalid-props branch
    // must not be what rendered.
    await expect(page.getByTestId('example-override-showcase-invalid')).toHaveCount(0)
  })

  test('wrapper mode keeps the host rendered inside the decoration, on a page another module owns', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    let personId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'TC-EXAMPLE-017',
        lastName: suffix,
        displayName: `TC-EXAMPLE-017 ${suffix}`,
      })

      await login(page, 'admin')
      await page.goto('/backend/umes-extensions', { waitUntil: 'commit' })
      await page.waitForLoadState('domcontentloaded')
      // The Phase H hint is the module's own statement about where to find this wrapper, so it
      // is read here rather than restated: the test and the guided demo cannot drift apart.
      await expect(page.getByText(/ExampleNotesSectionWrapper/).first()).toBeVisible({ timeout: 20_000 })

      await page.goto(`/backend/customers/people/${encodeURIComponent(personId)}`, { waitUntil: 'commit' })
      await page.waitForLoadState('domcontentloaded')
      const wrapper = page.getByTestId('example-notes-wrapper')
      await expect(wrapper).toBeVisible({ timeout: 30_000 })
      await expect(wrapper).toHaveClass(/border-dotted/)

      // Composition, not replacement — the distinction this test exists for. The wrapper sits
      // INSIDE the resolved handle (the registry resolves the component, then feeds it through
      // the wrapper), and the host's own section is still rendered inside the frame. A `replace`
      // on this handle would leave the wrapper empty of the host's markup, which is why the
      // assertion is about the host's content and not about the wrapper existing.
      await expect(
        page.locator('[data-component-handle="section:ui.detail.NotesSection"] [data-testid="example-notes-wrapper"]'),
      ).toHaveCount(1)
      await expect(wrapper.locator('*').first()).toBeVisible()
      await expect(wrapper).not.toBeEmpty()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('a spot this module declares nothing for stays empty', async ({ page }) => {
    test.slow()
    await login(page, 'admin')
    await page.goto('/backend/todos/create', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Example Injection Widget')).toBeVisible({ timeout: 20_000 })

    // The customer-priority field is bound to the CUSTOMERS form spots only. Rendering it here
    // would mean a widget reached a host it was never keyed to — the failure mode a registry
    // keyed by spot id exists to prevent, and one that no unit test over the table can see.
    await expect(page.locator('[data-crud-field-id="_example.priority"]')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: /^Priority$/ })).toHaveCount(0)
  })
})
