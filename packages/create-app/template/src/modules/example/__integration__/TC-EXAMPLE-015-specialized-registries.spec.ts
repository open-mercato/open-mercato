import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  getBundle,
  getIntegration,
} from '@open-mercato/shared/modules/integrations/types'
import { getGatewayAdapter } from '@open-mercato/shared/modules/payment_gateways/types'
import type { VectorModuleConfig } from '@open-mercato/shared/modules/vector'
import { getShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import type { RateProvider } from '@open-mercato/core/modules/currencies/services/providers/base'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { extractModuleFacts } from '@open-mercato/cli/lib/generators/module-facts'
import {
  VectorIndexService,
  type EmbeddingService,
  type VectorDriver,
  type VectorDriverDocument,
} from '@open-mercato/search/vector'
import { EXAMPLE_CURRENCY_RATE_PROVIDER } from '../di'

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

const APP_ROOT = path.resolve(process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato'))
const EXAMPLE_MODULE_ROOT = path.join(APP_ROOT, 'src', 'modules', 'example')
const TODOS_API = '/api/example/todos'
const WORKFLOW_ID = 'example.todo-created-reference'

type ModuleLike = {
  id: string
  vector?: VectorModuleConfig
}

type WorkflowLike = {
  workflowId: string
  moduleId: string
}

type BootstrapResult = {
  modules: ModuleLike[]
  codeWorkflows?: WorkflowLike[]
}

type WorkflowInstance = {
  id: string
  status: string
  organizationId?: string
  metadata?: { entityId?: string; entityType?: string }
}

type SearchResponse = {
  results?: Array<{ entityId?: unknown; recordId?: unknown }>
}

let bootstrapPromise: Promise<BootstrapResult> | null = null

async function bootstrapReferenceApp(): Promise<BootstrapResult> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapFromAppRoot(APP_ROOT) as Promise<BootstrapResult>
  }
  return bootstrapPromise
}

function createVectorDriver() {
  const documents = new Map<string, VectorDriverDocument>()
  const keyOf = (entityId: string, recordId: string, tenantId: string) => `${tenantId}:${entityId}:${recordId}`
  const driver: VectorDriver = {
    id: 'pgvector',
    async ensureReady() {},
    async upsert(document) {
      documents.set(keyOf(document.entityId, document.recordId, document.tenantId), document)
    },
    async delete(entityId, recordId, tenantId) {
      documents.delete(keyOf(entityId, recordId, tenantId))
    },
    async query() {
      return []
    },
    async getChecksum(entityId, recordId, tenantId) {
      return documents.get(keyOf(entityId, recordId, tenantId))?.checksum ?? null
    },
  }
  return { documents, driver }
}

function createEmbeddingService(): EmbeddingService {
  return {
    available: true,
    async createEmbedding(input: string | string[]) {
      const text = Array.isArray(input) ? input.join('\n') : input
      const total = [...text].reduce((sum, character) => sum + character.codePointAt(0)!, 0)
      return [text.length, total % 997, 1]
    },
  } as unknown as EmbeddingService
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

test.describe('TC-EXAMPLE-015: the nine specialized registries have real local callers', () => {
  test('the canonical fact extractor emits every specialized registry kind', () => {
    const facts = extractModuleFacts({
      moduleId: 'example',
      moduleRoot: EXAMPLE_MODULE_ROOT,
      portableSourceRoot: 'src/modules/example',
    })
    const registries = new Set(
      (facts.extensionSurfaces?.contributions ?? [])
        .filter((contribution) => contribution.kind === 'specialized-registry')
        .map((contribution) => contribution.details.registry),
    )
    expect([...registries].sort()).toEqual([
      'ai',
      'currency',
      'integration',
      'notification',
      'payment',
      'search',
      'shipping',
      'vector',
      'workflow',
    ])
  })

  test('bootstrap registers the bundle, mock adapters, deterministic currency provider, and workflow', async () => {
    const bootstrap = await bootstrapReferenceApp()
    const bundle = getBundle('example_reference_bundle')
    expect(bundle?.credentials.fields).toEqual([])

    expect(getIntegration('example_mock_payment')).toMatchObject({
      bundleId: bundle?.id,
      category: 'payment',
      providerKey: 'mock',
    })
    expect(getIntegration('example_mock_shipping')).toMatchObject({
      bundleId: bundle?.id,
      category: 'shipping',
      providerKey: 'mock_carrier',
    })
    expect(getIntegration('example_fixed_currency')).toMatchObject({
      bundleId: bundle?.id,
      category: 'currency',
      providerKey: 'example_fixed_rates',
    })

    const paymentAdapter = getGatewayAdapter('mock')
    expect(paymentAdapter).toBeDefined()
    const payment = await paymentAdapter!.createSession({
      paymentId: randomUUID(),
      tenantId: randomUUID(),
      organizationId: randomUUID(),
      amount: 12.34,
      currencyCode: 'USD',
      credentials: {},
    })
    expect(payment.status).toBe('captured')

    const shippingAdapter = getShippingAdapter('mock_carrier')
    expect(shippingAdapter).toBeDefined()
    const rates = await shippingAdapter!.calculateRates({
      origin: { countryCode: 'US', city: 'New York', postalCode: '10001', line1: '1 Main St' },
      destination: { countryCode: 'US', city: 'Boston', postalCode: '02108', line1: '1 Beacon St' },
      packages: [{ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 }],
      credentials: {},
    })
    expect(rates.map((rate) => rate.serviceCode)).toEqual(['standard', 'express'])

    const container = await createRequestContainer()
    const currencyProvider = container.resolve<RateProvider>(EXAMPLE_CURRENCY_RATE_PROVIDER)
    const date = new Date('2026-08-10T00:00:00.000Z')
    const currencyRates = await currencyProvider.fetchRates(
      date,
      { tenantId: randomUUID(), organizationId: randomUUID() },
      new Set(['USD', 'EUR']),
    )
    expect(currencyRates).toEqual([
      expect.objectContaining({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR', rate: '0.9200', date }),
      expect.objectContaining({ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.0870', date }),
    ])

    expect(bootstrap.codeWorkflows).toEqual(expect.arrayContaining([
      expect.objectContaining({ workflowId: WORKFLOW_ID, moduleId: 'example' }),
    ]))
  })

  test('the generated vector config indexes a real scoped Todo deterministically without credentials', async ({ request }) => {
    const bootstrap = await bootstrapReferenceApp()
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    let todoId: string | null = null
    let foreignOrgId: string | null = null
    let foreignTodoId: string | null = null

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

      const exampleModule = bootstrap.modules.find((module) => module.id === 'example')
      expect(exampleModule?.vector?.entities.map((entity) => entity.entityId)).toContain('example:todo')
      const container = await createRequestContainer()
      const queryEngine = container.resolve<QueryEngine>('queryEngine')
      const { documents, driver } = createVectorDriver()
      const service = new VectorIndexService({
        drivers: [driver],
        embeddingService: createEmbeddingService(),
        queryEngine,
        moduleConfigs: [exampleModule!.vector!],
      })

      const first = await service.indexRecord({
        entityId: 'example:todo',
        recordId: todoId!,
        tenantId,
        organizationId,
      })
      expect(first.action).toBe('indexed')
      const document = [...documents.values()].find((candidate) => candidate.recordId === todoId)
      expect(document).toMatchObject({ tenantId, organizationId, entityId: 'example:todo' })
      expect(JSON.stringify(document)).toContain(`TC-EXAMPLE-015 vector ${suffix}`)
      expect(JSON.stringify(document)).not.toContain(`private-${suffix}`)

      const repeated = await service.indexRecord({
        entityId: 'example:todo',
        recordId: todoId!,
        tenantId,
        organizationId,
      })
      expect(repeated).toMatchObject({ action: 'skipped', reason: 'checksum_match', existed: true })
      expect(documents.size).toBe(1)

      const wrongScope = await service.indexRecord({
        entityId: 'example:todo',
        recordId: foreignTodoId!,
        tenantId,
        organizationId,
      })
      expect(wrongScope).toMatchObject({ action: 'skipped', reason: 'missing_record', existed: false })
      expect([...documents.values()].map((candidate) => candidate.recordId)).not.toContain(foreignTodoId)
    } finally {
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

  test('one scoped Todo event starts exactly one workflow instance in its organization', async ({ request }) => {
    await bootstrapReferenceApp()
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(token)
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
      }, { timeout: 30_000 }).toEqual(['COMPLETED'])
      expect(await readWorkflowInstances(request, token, homeTodoId!)).toHaveLength(1)

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
      }, { timeout: 30_000 }).toEqual(['COMPLETED'])

      expect(await readWorkflowInstances(request, token, foreignTodoId!)).toEqual([])
      expect(await readWorkflowInstances(request, token, foreignTodoId!, foreignOrgId!)).toHaveLength(1)
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
