import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import type { QueryEngine, QueryOptions } from '@open-mercato/shared/lib/query/types'
import {
  createPgVectorDriver,
  EmbeddingService,
  VectorIndexService,
} from '@open-mercato/search/vector'
import { vectorConfig } from '../vector'

export const integrationMeta = {
  dependsOnModules: [
    'example',
    'search',
    'query_index',
    'integrations',
    'payment_gateways',
    'shipping_carriers',
    'currencies',
    'workflows',
    'events',
  ],
}

const TODOS_API = '/api/example/todos'
const WORKFLOW_ID = 'example.todo-created-reference'

type WorkflowInstance = {
  id: string
  status: string
  organizationId?: string
  metadata?: { entityId?: string; entityType?: string }
}

type SearchResponse = {
  results?: Array<{ entityId?: unknown; recordId?: unknown }>
}

type IntegrationListResponse = {
  items?: Array<{ id?: string; providerKey?: string; bundleId?: string }>
  bundles?: Array<{ id?: string; integrationCount?: number }>
}

type PgPool = NonNullable<NonNullable<Parameters<typeof createPgVectorDriver>[0]>['pool']>

async function queryIntegrationDatabase<Row = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<{ rows: Row[]; rowCount?: number }> {
  const result = await withClient((client) => client.query<Row>(text, params))
  return {
    rows: result.rows,
    ...(result.rowCount === null ? {} : { rowCount: result.rowCount }),
  }
}

function createIntegrationPgPool(): PgPool {
  return {
    async connect() {
      return {
        query: queryIntegrationDatabase,
        release() {},
      }
    },
    query: queryIntegrationDatabase,
    async end() {},
  }
}

class DeterministicEmbeddingService extends EmbeddingService {
  override get available(): boolean {
    return true
  }

  override async createEmbedding(input: string | string[]): Promise<number[]> {
    const text = Array.isArray(input) ? input.join('\n\n') : input
    const embedding = Array.from({ length: 1_536 }, () => 0)
    Array.from(text).forEach((character, index) => {
      const codePoint = character.codePointAt(0) ?? 0
      embedding[(codePoint + (index * 131)) % 1_535] += 1
    })
    embedding[1_535] = 1
    return embedding
  }
}

function readRequestedIds(options?: QueryOptions): string[] {
  const filters = options?.filters
  if (!filters || Array.isArray(filters)) return []
  const idFilter = filters.id
  if (!idFilter || typeof idFilter !== 'object' || Array.isArray(idFilter)) return []
  const requestedIds = (idFilter as { $in?: unknown }).$in
  return Array.isArray(requestedIds)
    ? requestedIds.filter((value): value is string => typeof value === 'string')
    : []
}

function createLiveTodoQueryEngine(observedScopes: string[]): QueryEngine {
  return {
    async query<Result = unknown>(entityId: string, options?: QueryOptions) {
      expect(entityId).toBe('example:todo')
      expect(options?.tenantId).toBeTruthy()
      expect(options?.organizationId).toBeTruthy()
      const tenantId = options?.tenantId ?? ''
      const organizationId = options?.organizationId ?? ''
      const recordIds = readRequestedIds(options)
      observedScopes.push(organizationId)
      const result = await queryIntegrationDatabase<Record<string, unknown>>(
        `SELECT id, title, notes, is_done, tenant_id, organization_id
           FROM todos
          WHERE id = ANY($1::uuid[])
            AND tenant_id = $2::uuid
            AND organization_id = $3::uuid
            AND deleted_at IS NULL`,
        [recordIds, tenantId, organizationId],
      )
      return {
        items: result.rows as Result[],
        page: 1,
        pageSize: Math.max(1, recordIds.length),
        total: result.rows.length,
      }
    },
  }
}


async function readWorkflowInstances(
  request: APIRequestContext,
  token: string,
  todoId: string,
  selectedOrgId?: string,
): Promise<WorkflowInstance[]> {
  const query = new URLSearchParams({
    workflowId: WORKFLOW_ID,
    entityType: 'example:todo',
    entityId: todoId,
    limit: '10',
  })
  const requestPath = `/api/workflows/instances?${query.toString()}`
  const response = selectedOrgId
    ? await apiRequestWithSelectedOrg(request, 'GET', requestPath, { token, selectedOrgId })
    : await apiRequest(request, 'GET', requestPath, { token })
  expect(response.ok(), `workflow list failed: ${response.status()}`).toBeTruthy()
  return ((await response.json()) as { data?: WorkflowInstance[] }).data ?? []
}

async function searchTodoIds(
  request: APIRequestContext,
  token: string,
  query: string,
  selectedOrgId?: string,
): Promise<string[]> {
  const search = new URLSearchParams({
    q: query,
    limit: '20',
    strategies: 'tokens',
    entityTypes: 'example:todo',
  })
  const requestPath = `/api/search/search?${search.toString()}`
  const response = selectedOrgId
    ? await apiRequestWithSelectedOrg(request, 'GET', requestPath, { token, selectedOrgId })
    : await apiRequest(request, 'GET', requestPath, { token })
  expect(response.ok(), `Todo search failed: ${response.status()}`).toBeTruthy()
  const body = await response.json() as SearchResponse
  return (body.results ?? [])
    .filter((result) => result.entityId === 'example:todo')
    .map((result) => String(result.recordId))
}

async function deleteWorkflowInstances(instanceIds: string[]): Promise<void> {
  if (instanceIds.length === 0) return
  await withClient(async (client) => {
    await client.query(
      'DELETE FROM workflow_events WHERE workflow_instance_id = ANY($1::uuid[])',
      [instanceIds],
    )
    await client.query(
      'DELETE FROM step_instances WHERE workflow_instance_id = ANY($1::uuid[])',
      [instanceIds],
    )
    await client.query(
      'DELETE FROM workflow_branch_instances WHERE workflow_instance_id = ANY($1::uuid[])',
      [instanceIds],
    )
    await client.query(
      'DELETE FROM workflow_instances WHERE id = ANY($1::uuid[])',
      [instanceIds],
    )
  })
}

async function expectSingleWorkflowInstanceToRemainStable(
  request: APIRequestContext,
  token: string,
  todoId: string,
  expectedOrganizationId: string,
  collectInstanceId: (instanceId: string) => void,
  selectedOrgId?: string,
): Promise<void> {
  const observationDeadline = Date.now() + 5_000
  do {
    const instances = await readWorkflowInstances(request, token, todoId, selectedOrgId)
    instances.forEach((instance) => collectInstanceId(instance.id))
    expect(instances).toHaveLength(1)
    expect(instances[0]).toMatchObject({
      status: 'COMPLETED',
      organizationId: expectedOrganizationId,
      metadata: { entityId: todoId, entityType: 'example:todo' },
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
  } while (Date.now() < observationDeadline)
}

test.describe('TC-EXAMPLE-015: the nine specialized registries have real local callers', () => {
  test('resolves and executes the credential-free integration, payment, shipping, and currency identities', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)
    const dateOffsetMs = Number.parseInt(randomUUID().slice(0, 8), 16)
    const fetchDate = new Date(Date.UTC(2090, 0, 1) + dateOffsetMs).toISOString()
    let transactionId: string | null = null

    try {
      const integrationsResponse = await apiRequest(
        request,
        'GET',
        '/api/integrations?page=1&pageSize=100&bundleId=example_reference_bundle',
        { token },
      )
      expect(integrationsResponse.ok(), `integration list failed: ${integrationsResponse.status()}`).toBeTruthy()
      const integrationList = await integrationsResponse.json() as IntegrationListResponse
      expect((integrationList.items ?? []).map((item) => ({
        id: item.id,
        providerKey: item.providerKey,
        bundleId: item.bundleId,
      })).sort((left, right) => String(left.id).localeCompare(String(right.id)))).toEqual([
        { id: 'example_fixed_currency', providerKey: 'example_fixed_rates', bundleId: 'example_reference_bundle' },
        { id: 'example_mock_payment', providerKey: 'mock', bundleId: 'example_reference_bundle' },
        { id: 'example_mock_shipping', providerKey: 'mock_carrier', bundleId: 'example_reference_bundle' },
      ])
      expect(integrationList.bundles).toContainEqual(expect.objectContaining({
        id: 'example_reference_bundle',
        integrationCount: 3,
      }))

      const paymentProviders = await apiRequest(request, 'GET', '/api/payment_gateways/providers', { token })
      expect(paymentProviders.ok()).toBeTruthy()
      expect(JSON.stringify(await paymentProviders.json())).toContain('mock')

      const paymentSession = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
        token,
        data: { providerKey: 'mock', amount: 12.34, currencyCode: 'USD' },
      })
      expect(paymentSession.status()).toBe(201)
      const paymentBody = await paymentSession.json() as { transactionId?: string; status?: string; providerKey?: string }
      transactionId = paymentBody.transactionId ?? null
      expect(paymentBody).toMatchObject({ providerKey: 'mock', status: 'captured' })
      expect(transactionId).toBeTruthy()

      const shippingProviders = await apiRequest(request, 'GET', '/api/shipping-carriers/providers', { token })
      expect(shippingProviders.ok()).toBeTruthy()
      expect(JSON.stringify(await shippingProviders.json())).toContain('mock_carrier')
      const shippingRates = await apiRequest(request, 'POST', '/api/shipping-carriers/rates', {
        token,
        data: {
          providerKey: 'mock_carrier',
          origin: { countryCode: 'US', city: 'New York', postalCode: '10001', line1: '1 Main St' },
          destination: { countryCode: 'US', city: 'Boston', postalCode: '02108', line1: '1 Beacon St' },
          packages: [{ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 }],
        },
      })
      expect(shippingRates.ok(), `shipping rates failed: ${shippingRates.status()}`).toBeTruthy()
      const shippingBody = await shippingRates.json() as { rates?: Array<{ serviceCode?: string }> }
      expect((shippingBody.rates ?? []).map((rate) => rate.serviceCode)).toEqual(['standard', 'express'])

      const currencyRates = await apiRequest(request, 'POST', '/api/currencies/fetch-rates', {
        token,
        data: { date: fetchDate, providers: ['example_fixed_rates'] },
      })
      expect(currencyRates.ok(), `currency fetch failed: ${currencyRates.status()}`).toBeTruthy()
      expect(await currencyRates.json()).toMatchObject({
        totalFetched: 2,
        byProvider: { example_fixed_rates: { count: 2 } },
        errors: [],
      })
    } finally {
      await withClient(async (client) => {
        if (transactionId) {
          await client.query('DELETE FROM gateway_transactions WHERE id = $1', [transactionId])
        }
        await client.query(
          'DELETE FROM exchange_rates WHERE tenant_id = $1 AND organization_id = $2 AND source = $3 AND date = $4',
          [tenantId, organizationId, 'example_fixed_rates', fetchDate],
        )
      })
    }
  })

  test('token search and live deterministic pgvector indexing preserve Todo organization scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    let todoId: string | null = null
    let foreignOrgId: string | null = null
    let foreignTodoId: string | null = null
    const vectorTableName = `vector_search_tc015_${suffix}`
    const vectorMigrationsTableName = `vector_migrations_tc015_${suffix}`
    const observedVectorQueryScopes: string[] = []
    const vectorDriver = createPgVectorDriver({
      pool: createIntegrationPgPool(),
      tableName: vectorTableName,
      migrationsTable: vectorMigrationsTableName,
      dimension: 1_536,
    })
    const vectorService = new VectorIndexService({
      drivers: [vectorDriver],
      embeddingService: new DeterministicEmbeddingService(),
      queryEngine: createLiveTodoQueryEngine(observedVectorQueryScopes),
      moduleConfigs: [vectorConfig],
    })

    try {
      const created = await apiRequest(request, 'POST', TODOS_API, {
        token,
        data: {
          title: `TC-EXAMPLE-015 vector ${suffix}`,
          notes: `private-${suffix}`,
          cf_priority: 2,
          cf_severity: 'low',
        },
      })
      expect(created.ok()).toBeTruthy()
      todoId = ((await created.json()) as { id?: string }).id ?? null
      expect(todoId).toBeTruthy()

      foreignOrgId = await createOrganizationFixture(request, token, {
        name: `TC-EXAMPLE-015 vector org ${suffix}`,
        tenantId,
      })
      const foreign = await apiRequestWithSelectedOrg(request, 'POST', TODOS_API, {
        token,
        selectedOrgId: foreignOrgId,
        data: {
          title: `TC-EXAMPLE-015 foreign vector ${suffix}`,
          cf_priority: 2,
          cf_severity: 'low',
        },
      })
      expect(foreign.ok()).toBeTruthy()
      foreignTodoId = ((await foreign.json()) as { id?: string }).id ?? null
      expect(foreignTodoId).toBeTruthy()

      await expect.poll(
        () => searchTodoIds(request, token, `TC-EXAMPLE-015 vector ${suffix}`),
        { timeout: 20_000 },
      ).toContain(todoId)
      await expect.poll(
        () => searchTodoIds(request, token, `TC-EXAMPLE-015 foreign vector ${suffix}`, foreignOrgId!),
        { timeout: 20_000 },
      ).toContain(foreignTodoId)
      expect(await searchTodoIds(request, token, `TC-EXAMPLE-015 foreign vector ${suffix}`))
        .not.toContain(foreignTodoId)

      await expect(vectorService.indexRecord({
        entityId: 'example:todo',
        recordId: todoId!,
        tenantId,
        organizationId,
      })).resolves.toMatchObject({
        action: 'indexed',
        created: true,
        organizationId,
      })
      await expect(vectorService.indexRecord({
        entityId: 'example:todo',
        recordId: foreignTodoId!,
        tenantId,
        organizationId: foreignOrgId,
      })).resolves.toMatchObject({
        action: 'indexed',
        created: true,
        organizationId: foreignOrgId,
      })
      await expect(vectorService.indexRecord({
        entityId: 'example:todo',
        recordId: todoId!,
        tenantId,
        organizationId,
      })).resolves.toMatchObject({
        action: 'skipped',
        reason: 'checksum_match',
      })

      const homeEntries = await vectorDriver.list!({
        tenantId,
        organizationId,
        entityId: 'example:todo',
      })
      const foreignEntries = await vectorDriver.list!({
        tenantId,
        organizationId: foreignOrgId,
        entityId: 'example:todo',
      })
      expect(homeEntries.map((entry) => entry.recordId)).toEqual([todoId])
      expect(foreignEntries.map((entry) => entry.recordId)).toEqual([foreignTodoId])

      const homeHits = await vectorService.search({
        query: `TC-EXAMPLE-015 vector ${suffix}`,
        tenantId,
        organizationId,
        limit: 10,
      })
      const foreignHits = await vectorService.search({
        query: `TC-EXAMPLE-015 foreign vector ${suffix}`,
        tenantId,
        organizationId: foreignOrgId,
        limit: 10,
      })
      expect(homeHits.map((hit) => hit.recordId)).toEqual([todoId])
      expect(foreignHits.map((hit) => hit.recordId)).toEqual([foreignTodoId])
      expect(observedVectorQueryScopes).toEqual(expect.arrayContaining([
        organizationId,
        foreignOrgId,
      ]))

    } finally {
      await withClient(async (client) => {
        await client.query(`DROP TABLE IF EXISTS "${vectorTableName}"`)
        await client.query(`DROP TABLE IF EXISTS "${vectorMigrationsTableName}"`)
      }).catch(() => undefined)
      await deleteEntityIfExists(request, token, TODOS_API, todoId)
      if (foreignOrgId && foreignTodoId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', TODOS_API, {
          token,
          selectedOrgId: foreignOrgId,
          data: { id: foreignTodoId },
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, token, foreignOrgId)
    }
  })

  test('one persisted scoped Todo event remains one workflow instance after the queued delivery is drained', async ({ request }) => {
    // The waits this test declares did not fit the budget it ran under: two workflow polls
    // (20s ceiling each), a queue drain that spawns the CLI from the app root, and a 5s
    // stability observation per scope, all inside the suite's flat 20s test timeout. On an
    // unloaded machine the polls resolve in well under a second and it passed; on a loaded
    // CI worker it could only ever end in "Test timeout of 20000ms exceeded".
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    let homeTodoId: string | null = null
    let foreignTodoId: string | null = null
    let foreignOrgId: string | null = null
    const workflowInstanceIds = new Set<string>()

    try {
      const home = await apiRequest(request, 'POST', TODOS_API, {
        token,
        data: {
          title: `TC-EXAMPLE-015 workflow home ${suffix}`,
          cf_priority: 2,
          cf_severity: 'low',
        },
      })
      expect(home.ok()).toBeTruthy()
      homeTodoId = ((await home.json()) as { id?: string }).id ?? null
      expect(homeTodoId).toBeTruthy()

      await expect.poll(async () => {
        const instances = await readWorkflowInstances(request, token, homeTodoId!)
        instances.forEach((instance) => workflowInstanceIds.add(instance.id))
        return instances.map((instance) => instance.status)
      }, { timeout: 20_000 }).toEqual(['COMPLETED'])

      foreignOrgId = await createOrganizationFixture(request, token, {
        name: `TC-EXAMPLE-015 workflow org ${suffix}`,
        tenantId,
      })
      const foreign = await apiRequestWithSelectedOrg(request, 'POST', TODOS_API, {
        token,
        selectedOrgId: foreignOrgId,
        data: {
          title: `TC-EXAMPLE-015 workflow foreign ${suffix}`,
          cf_priority: 2,
          cf_severity: 'low',
        },
      })
      expect(foreign.ok()).toBeTruthy()
      foreignTodoId = ((await foreign.json()) as { id?: string }).id ?? null
      expect(foreignTodoId).toBeTruthy()

      await expect.poll(async () => {
        const instances = await readWorkflowInstances(request, token, foreignTodoId!, foreignOrgId!)
        instances.forEach((instance) => workflowInstanceIds.add(instance.id))
        return instances.map((instance) => instance.status)
      }, { timeout: 20_000 }).toEqual(['COMPLETED'])

      expect(await readWorkflowInstances(request, token, foreignTodoId!)).toEqual([])
      const processedEventDeliveries = await drainIntegrationQueue('events')
      expect(Number.isSafeInteger(processedEventDeliveries)).toBe(true)
      expect(processedEventDeliveries).toBeGreaterThanOrEqual(0)
      await Promise.all([
        expectSingleWorkflowInstanceToRemainStable(
          request,
          token,
          homeTodoId!,
          organizationId,
          (instanceId) => workflowInstanceIds.add(instanceId),
        ),
        expectSingleWorkflowInstanceToRemainStable(
          request,
          token,
          foreignTodoId!,
          foreignOrgId!,
          (instanceId) => workflowInstanceIds.add(instanceId),
          foreignOrgId!,
        ),
      ])
    } finally {
      await deleteEntityIfExists(request, token, TODOS_API, homeTodoId)
      if (foreignOrgId && foreignTodoId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', TODOS_API, {
          token,
          selectedOrgId: foreignOrgId,
          data: { id: foreignTodoId },
        }).catch(() => undefined)
      }
      await deleteWorkflowInstances([...workflowInstanceIds])
      await deleteOrganizationIfExists(request, token, foreignOrgId)
    }
  })
})
