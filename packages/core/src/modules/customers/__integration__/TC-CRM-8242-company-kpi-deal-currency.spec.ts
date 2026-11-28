import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createOrganizationFixture, createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { customerTestPassword } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { createOrganizationInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'currencies', 'auth', 'directory'] }

/**
 * TC-CRM-8242: company detail "Active deals" KPI currency (#8242).
 *
 * The KPI bar used to fall back to a hard-coded PLN when no deal carried a currency, so a
 * company with no deals showed "PLN 0" in every tenant. `GET /api/customers/companies/[id]`
 * now reports `kpis.dealCurrency` as: active deal currency → any deal currency → the company
 * organization's base currency → null, and the tile formats a plain number when it is null.
 * The base-currency fallback is resolved on every read (also on a CRUD-cache hit), so a base
 * currency change shows up immediately rather than after the detail cache TTL.
 *
 * Every test builds its own organizations, base currencies, companies and deals through the API.
 * The database is touched only for what the API cannot express: the foreign tenant (tenant row,
 * organization, user ACL), and retiring base-currency fixtures, which the API refuses to delete.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

type CompanyKpis = {
  activeDealsCount: number
  dealCurrency: string | null
  ltvValue: number | null
  ltvCurrency?: string | null
}

type Fixtures = {
  token: string
  tenantId: string
  organizationIds: string[]
  currencyIds: string[]
  companyIds: string[]
  dealIds: string[]
  userIds: string[]
  foreignTenantIds: string[]
  foreignOrganizationIds: string[]
}

async function createOrganization(request: APIRequestContext, fixtures: Fixtures, label: string): Promise<string> {
  const id = await createOrganizationFixture(request, fixtures.token, {
    name: `TC-CRM-8242 ${label} ${randomUUID().slice(0, 8)}`,
    tenantId: fixtures.tenantId,
  })
  fixtures.organizationIds.push(id)
  return id
}

async function createBaseCurrency(request: APIRequestContext, fixtures: Fixtures, organizationId: string, code: string) {
  const response = await apiRequest(request, 'POST', '/api/currencies/currencies', {
    token: fixtures.token,
    data: { organizationId, tenantId: fixtures.tenantId, code, name: `TC-CRM-8242 ${code}`, isBase: true },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `create base ${code} currency in ${organizationId}`).toBe(201)
  fixtures.currencyIds.push(expectId(body?.id, 'currency id'))
}

async function createCompany(request: APIRequestContext, fixtures: Fixtures, organizationId: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/companies', {
    token: fixtures.token,
    headers: { Cookie: `om_selected_tenant=${fixtures.tenantId}; om_selected_org=${organizationId}` },
    data: { displayName: `TC-CRM-8242 company ${randomUUID().slice(0, 8)}`, organizationId, tenantId: fixtures.tenantId },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `create company in ${organizationId}`).toBe(201)
  const id = expectId(body?.id, 'company id')
  fixtures.companyIds.push(id)
  return id
}

async function createDeal(
  request: APIRequestContext,
  fixtures: Fixtures,
  input: { organizationId: string; companyId: string; valueAmount: number; valueCurrency?: string; status?: 'open' | 'win' },
) {
  const response = await apiRequest(request, 'POST', '/api/customers/deals', {
    token: fixtures.token,
    headers: { Cookie: `om_selected_tenant=${fixtures.tenantId}; om_selected_org=${input.organizationId}` },
    data: {
      title: `TC-CRM-8242 deal ${input.valueAmount} ${input.valueCurrency ?? 'no-currency'} ${randomUUID().slice(0, 8)}`,
      organizationId: input.organizationId,
      companyIds: [input.companyId],
      valueAmount: input.valueAmount,
      status: input.status ?? 'open',
      ...(input.valueCurrency ? { valueCurrency: input.valueCurrency } : {}),
    },
  })
  const body = await readJsonSafe<{ id?: string; dealId?: string }>(response)
  expect(response.status(), 'create deal fixture').toBe(201)
  fixtures.dealIds.push(expectId(body?.id ?? body?.dealId, 'deal id'))
}

async function readCompany(
  request: APIRequestContext,
  token: string,
  companyId: string,
  cookie: string,
) {
  return apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token, headers: { Cookie: cookie } })
}

async function readKpis(request: APIRequestContext, fixtures: Fixtures, companyId: string, organizationId: string): Promise<CompanyKpis> {
  const response = await readCompany(
    request,
    fixtures.token,
    companyId,
    `om_selected_tenant=${fixtures.tenantId}; om_selected_org=${organizationId}`,
  )
  expect(response.status(), `GET company ${companyId}`).toBe(200)
  const body = await readJsonSafe<{ kpis?: CompanyKpis }>(response)
  expect(body?.kpis, 'detail response carries kpis').toBeTruthy()
  return body?.kpis as CompanyKpis
}

async function readKpiTile(
  page: Page,
  input: { organizationId: string; tenantId: string; companyId: string; title: RegExp },
): Promise<string> {
  await page.context().addCookies([
    { name: 'om_selected_tenant', value: input.tenantId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_org', value: input.organizationId, url: BASE_URL, sameSite: 'Lax' },
  ])
  if (!page.url().endsWith(`/backend/customers/companies-v2/${input.companyId}`)) {
    await page.goto(`/backend/customers/companies-v2/${input.companyId}`, { waitUntil: 'domcontentloaded' })
  }
  const tile = page.getByTestId('company-kpi-tile').filter({ hasText: input.title })
  await expect(tile).toBeVisible({ timeout: 20_000 })
  const value = tile.locator('p > span').first()
  await expect(value).toBeVisible()
  return ((await value.textContent()) ?? '').trim()
}

async function readActiveDealsTile(page: Page, organizationId: string, tenantId: string, companyId: string): Promise<string> {
  return readKpiTile(page, { organizationId, tenantId, companyId, title: /ACTIVE DEALS/i })
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type FixtureTable = 'customer_deals' | 'customer_entities' | 'organizations'

async function isFixtureLive(table: FixtureTable, id: string, tenantId: string): Promise<boolean> {
  const result = await withClient((client) => client.query<{ count: string }>(
    `select count(*) from ${table} where id = $1 and tenant_id = $2 and deleted_at is null`,
    [id, tenantId],
  ))
  return Number(result.rows[0].count) > 0
}

/**
 * Deletes a tracked fixture through the API and requires a 2xx. Scoped CRM commands also answer
 * 404 for an out-of-scope target, so a 404 only counts as success once the database confirms the
 * fixture is gone (or soft-deleted) in its own tenant.
 */
async function deleteViaApi(
  request: APIRequestContext,
  token: string,
  fixture: { label: string; path: string; data?: unknown; table: FixtureTable; id: string; tenantId: string },
): Promise<string | null> {
  try {
    const response = await apiRequest(request, 'DELETE', fixture.path, { token, data: fixture.data })
    if (response.ok()) return null
    if (response.status() !== 404) return `${fixture.label}: HTTP ${response.status()}`
    return (await isFixtureLive(fixture.table, fixture.id, fixture.tenantId))
      ? `${fixture.label}: HTTP 404 but the fixture is still live`
      : null
  } catch (error) {
    return `${fixture.label}: ${describeError(error)}`
  }
}

/**
 * Attempts every owned cleanup step — a failed step never skips the ones after it — and
 * returns the failures so the caller can surface leftover fixtures instead of passing silently.
 */
async function cleanup(request: APIRequestContext, fixtures: Fixtures): Promise<string[]> {
  const failures: string[] = []
  const record = (failure: string | null) => {
    if (failure) failures.push(failure)
  }

  for (const id of fixtures.dealIds) {
    record(await deleteViaApi(request, fixtures.token, {
      label: `deal ${id}`,
      path: `/api/customers/deals?id=${encodeURIComponent(id)}`,
      table: 'customer_deals',
      id,
      tenantId: fixtures.tenantId,
    }))
  }
  for (const id of fixtures.companyIds) {
    record(await deleteViaApi(request, fixtures.token, {
      label: `company ${id}`,
      path: `/api/customers/companies?id=${encodeURIComponent(id)}`,
      table: 'customer_entities',
      id,
      tenantId: fixtures.tenantId,
    }))
  }

  const statements: Array<{ label: string; sql: string; ids: string[] }> = [
    { label: 'currencies', sql: 'delete from currencies where id = any($1::uuid[])', ids: fixtures.currencyIds },
    { label: 'foreign customer_companies', sql: 'delete from customer_companies where tenant_id = any($1::uuid[])', ids: fixtures.foreignTenantIds },
    { label: 'foreign customer_entities', sql: 'delete from customer_entities where tenant_id = any($1::uuid[])', ids: fixtures.foreignTenantIds },
    { label: 'foreign entity_indexes', sql: 'delete from entity_indexes where tenant_id = any($1::uuid[])', ids: fixtures.foreignTenantIds },
    { label: 'foreign search_tokens', sql: 'delete from search_tokens where tenant_id = any($1::uuid[])', ids: fixtures.foreignTenantIds },
    { label: 'foreign action_logs', sql: 'delete from action_logs where tenant_id = any($1::uuid[])', ids: fixtures.foreignTenantIds },
    { label: 'user action_logs', sql: 'delete from action_logs where actor_user_id = any($1::uuid[])', ids: fixtures.userIds },
    { label: 'sessions', sql: 'delete from sessions where user_id = any($1::uuid[])', ids: fixtures.userIds },
    { label: 'user_acls', sql: 'delete from user_acls where user_id = any($1::uuid[])', ids: fixtures.userIds },
    { label: 'user_roles', sql: 'delete from user_roles where user_id = any($1::uuid[])', ids: fixtures.userIds },
    { label: 'users', sql: 'delete from users where id = any($1::uuid[])', ids: fixtures.userIds },
    { label: 'foreign organizations', sql: 'delete from organizations where id = any($1::uuid[])', ids: fixtures.foreignOrganizationIds },
    { label: 'foreign tenants', sql: 'delete from tenants where id = any($1::uuid[])', ids: fixtures.foreignTenantIds },
  ].filter((statement) => statement.ids.length > 0)
  if (statements.length > 0) {
    try {
      await withClient(async (client) => {
        for (const statement of statements) {
          try {
            await client.query(statement.sql, [statement.ids])
          } catch (error) {
            failures.push(`db ${statement.label}: ${describeError(error)}`)
          }
        }
      })
    } catch (error) {
      failures.push(`db connection: ${describeError(error)}`)
    }
  }

  for (const id of [...fixtures.organizationIds].reverse()) {
    record(await deleteViaApi(request, fixtures.token, {
      label: `organization ${id}`,
      path: '/api/directory/organizations',
      data: { id },
      table: 'organizations',
      id,
      tenantId: fixtures.tenantId,
    }))
  }
  return failures
}

async function withFixtures(request: APIRequestContext, run: (fixtures: Fixtures) => Promise<void>) {
  const token = await getAuthToken(request, 'superadmin')
  const fixtures: Fixtures = {
    token,
    tenantId: getTokenContext(token).tenantId,
    organizationIds: [],
    currencyIds: [],
    companyIds: [],
    dealIds: [],
    userIds: [],
    foreignTenantIds: [],
    foreignOrganizationIds: [],
  }
  expect(fixtures.tenantId, 'superadmin token carries a tenant').toBeTruthy()
  let testFailed = true
  try {
    await run(fixtures)
    testFailed = false
  } finally {
    const cleanupFailures = await cleanup(request, fixtures)
    if (cleanupFailures.length > 0) {
      test.info().annotations.push({ type: 'cleanup-failures', description: cleanupFailures.join('; ') })
      if (!testFailed) throw new Error(`[internal] TC-CRM-8242 fixture cleanup failed: ${cleanupFailures.join('; ')}`)
    }
  }
}

async function createScopedUser(
  request: APIRequestContext,
  fixtures: Fixtures,
  input: { tenantId: string; organizationId: string },
): Promise<string> {
  const email = `tc-crm-8242-${randomUUID()}@example.com`
  const password = customerTestPassword()
  const userId = await createUserFixture(request, fixtures.token, {
    email,
    password,
    organizationId: input.organizationId,
    roles: [],
  })
  fixtures.userIds.push(userId)
  await setUserAclInDb({ userId, tenantId: input.tenantId, features: ['customers.*'], organizations: null })
  return getAuthToken(request, email, password)
}

test.describe('TC-CRM-8242: company Active deals KPI currency', () => {
  test('uses the organization base currency for a company without deals, and the deal currency when a deal exists', async ({ page, request }) => {
    test.slow()
    await withFixtures(request, async (fixtures) => {
      const organizationId = await createOrganization(request, fixtures, 'usd-base')
      await createBaseCurrency(request, fixtures, organizationId, 'USD')
      const emptyCompanyId = await createCompany(request, fixtures, organizationId)
      const eurCompanyId = await createCompany(request, fixtures, organizationId)
      await createDeal(request, fixtures, { organizationId, companyId: eurCompanyId, valueAmount: 1234, valueCurrency: 'EUR' })

      const emptyKpis = await readKpis(request, fixtures, emptyCompanyId, organizationId)
      expect(emptyKpis.activeDealsCount).toBe(0)
      expect(emptyKpis.dealCurrency, 'no deals → organization base currency').toBe('USD')

      const eurKpis = await readKpis(request, fixtures, eurCompanyId, organizationId)
      expect(eurKpis.activeDealsCount).toBe(1)
      expect(eurKpis.dealCurrency, 'deal currency wins over the base currency').toBe('EUR')

      await login(page, 'superadmin')
      const emptyTile = await readActiveDealsTile(page, organizationId, fixtures.tenantId, emptyCompanyId)
      expect(emptyTile, 'empty company tile is a USD amount').toMatch(/\$/)
      expect(emptyTile).toMatch(/0/)
      expect(emptyTile).not.toMatch(/PLN|zł/)

      const eurTile = await readActiveDealsTile(page, organizationId, fixtures.tenantId, eurCompanyId)
      expect(eurTile, 'EUR deal tile is a EUR amount').toMatch(/€/)
      expect(eurTile).toMatch(/1[,.\s  ]?234/)
      expect(eurTile).not.toMatch(/PLN|zł|\$/)

      await createBaseCurrency(request, fixtures, organizationId, 'GBP')
      const afterBaseChange = await readKpis(request, fixtures, emptyCompanyId, organizationId)
      expect(afterBaseChange.dealCurrency, 'a base-currency change is visible within the detail cache TTL').toBe('GBP')
      const eurAfterBaseChange = await readKpis(request, fixtures, eurCompanyId, organizationId)
      expect(eurAfterBaseChange.dealCurrency, 'the deal currency still wins after the base changes').toBe('EUR')
    })
  })

  test('labels the won total with the won deals currency, independent of the active deals currency', async ({ page, request }) => {
    test.slow()
    await withFixtures(request, async (fixtures) => {
      const organizationId = await createOrganization(request, fixtures, 'mixed-currencies')
      await createBaseCurrency(request, fixtures, organizationId, 'USD')
      const companyId = await createCompany(request, fixtures, organizationId)
      await createDeal(request, fixtures, { organizationId, companyId, valueAmount: 4000, valueCurrency: 'GBP', status: 'win' })
      await createDeal(request, fixtures, { organizationId, companyId, valueAmount: 500 })
      await createDeal(request, fixtures, { organizationId, companyId, valueAmount: 700, valueCurrency: 'EUR' })

      const kpis = await readKpis(request, fixtures, companyId, organizationId)
      expect(kpis.activeDealsCount).toBe(2)
      expect(kpis.dealCurrency, 'active deals → the only active currency').toBe('EUR')
      expect(kpis.ltvValue).toBe(4000)
      expect(kpis.ltvCurrency, 'won total keeps the won deal currency').toBe('GBP')

      await login(page, 'superadmin')
      const tileInput = { organizationId, tenantId: fixtures.tenantId, companyId }
      const activeTile = await readKpiTile(page, { ...tileInput, title: /ACTIVE DEALS/i })
      expect(activeTile).toMatch(/€/)
      expect(activeTile).toMatch(/1[,.\s\u00a0\u202f]?200/)
      const ltvTile = await readKpiTile(page, { ...tileInput, title: /CUSTOMER VALUE/i })
      expect(ltvTile, 'LTV tile is a GBP amount').toMatch(/£/)
      expect(ltvTile).toMatch(/4[,.\s\u00a0\u202f]?000/)
      expect(ltvTile).not.toMatch(/€|\$|PLN|zł/)
    })
  })

  test('formats a plain number when neither the deal nor the organization has a currency', async ({ page, request }) => {
    test.slow()
    await withFixtures(request, async (fixtures) => {
      const organizationId = await createOrganization(request, fixtures, 'no-base')
      const baseCurrencies = await withClient((client) => client.query<{ count: string }>(
        'select count(*) from currencies where organization_id = $1 and is_base = true and deleted_at is null',
        [organizationId],
      ))
      expect(Number(baseCurrencies.rows[0].count), 'precondition: the organization has no base currency').toBe(0)
      const companyId = await createCompany(request, fixtures, organizationId)
      await createDeal(request, fixtures, { organizationId, companyId, valueAmount: 2345 })

      const kpis = await readKpis(request, fixtures, companyId, organizationId)
      expect(kpis.activeDealsCount).toBe(1)
      expect(kpis.dealCurrency, 'no currency anywhere → null, not a made-up code').toBeNull()

      await login(page, 'superadmin')
      const tile = await readActiveDealsTile(page, organizationId, fixtures.tenantId, companyId)
      expect(tile, 'plain number without any currency').toMatch(/^2[,.\s  ]?345$/)
    })
  })

  test('keeps the company detail readable in its own tenant and hidden from a foreign tenant', async ({ request }) => {
    test.slow()
    await withFixtures(request, async (fixtures) => {
      const organizationId = await createOrganization(request, fixtures, 'isolation')
      await createBaseCurrency(request, fixtures, organizationId, 'USD')
      const companyId = await createCompany(request, fixtures, organizationId)

      const ownToken = await createScopedUser(request, fixtures, { tenantId: fixtures.tenantId, organizationId })
      const ownRead = await readCompany(request, ownToken, companyId, '')
      expect(ownRead.status(), 'own-tenant user reads the company').toBe(200)
      const ownBody = await readJsonSafe<{ kpis?: CompanyKpis }>(ownRead)
      expect(ownBody?.kpis?.dealCurrency).toBe('USD')

      const foreignTenantId = randomUUID()
      await withClient((client) => client.query(
        'insert into tenants (id, name, is_active, created_at, updated_at) values ($1, $2, true, now(), now())',
        [foreignTenantId, `TC-CRM-8242 foreign ${foreignTenantId.slice(0, 8)}`],
      ))
      fixtures.foreignTenantIds.push(foreignTenantId)
      const foreignOrganizationId = await createOrganizationInDb({ name: 'TC-CRM-8242 foreign org', tenantId: foreignTenantId })
      fixtures.foreignOrganizationIds.push(foreignOrganizationId)
      const foreignToken = await createScopedUser(request, fixtures, {
        tenantId: foreignTenantId,
        organizationId: foreignOrganizationId,
      })

      const foreignCreate = await apiRequest(request, 'POST', '/api/customers/companies', {
        token: foreignToken,
        headers: { Cookie: '' },
        data: { displayName: `TC-CRM-8242 foreign company ${randomUUID().slice(0, 8)}` },
      })
      expect(foreignCreate.status(), 'foreign user creates its own company').toBe(201)
      const foreignCompanyId = expectId((await readJsonSafe<{ id?: string }>(foreignCreate))?.id, 'foreign company id')

      const foreignOwnRead = await readCompany(request, foreignToken, foreignCompanyId, '')
      expect(foreignOwnRead.status(), 'positive control: foreign user reads its own company').toBe(200)

      const crossTenantRead = await readCompany(request, foreignToken, companyId, '')
      expect([403, 404], 'foreign tenant must not read the company').toContain(crossTenantRead.status())
      const crossTenantBody = await crossTenantRead.text()
      expect(crossTenantBody).not.toContain(companyId)
      expect(crossTenantBody).not.toContain('dealCurrency')
    })
  })
})
