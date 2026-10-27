import { z } from 'zod'
import type { ApiRouteManifestEntry } from '@open-mercato/shared/modules/registry'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { createOptimisticLockGuardService } from '@open-mercato/shared/lib/crud/optimistic-lock'
import {
  createAiApiOperationRunner,
  expectedRecordVersionFor,
  type AiToolExecutionContext,
} from '../ai-api-operation-runner'
import type { AiToolDefinition, McpToolContext } from '../types'

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VERSION = '2026-10-13T10:00:00.000Z'

function makeTool(): AiToolDefinition {
  return {
    name: 'catalog.bulk_update_products',
    description: 'bulk',
    inputSchema: z.object({}).passthrough(),
    requiredFeatures: ['catalog.products.manage'],
    handler: async () => ({ ok: true }),
  }
}

function makeCtx(expectedRecordVersions?: Record<string, string>): AiToolExecutionContext {
  const base: McpToolContext = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: {} as McpToolContext['container'],
    userFeatures: ['catalog.products.manage'],
    isSuperAdmin: false,
    ...(expectedRecordVersions ? { expectedRecordVersions } : {}),
  }
  return { ...base, tool: makeTool() }
}

function productsRoute(captured: Request[]): ApiRouteManifestEntry[] {
  const handler = jest.fn(async (req: Request) => {
    captured.push(req)
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return [
    {
      moduleId: 'catalog',
      kind: 'route-file',
      path: '/catalog/products',
      methods: ['PUT'],
      load: async () => ({
        PUT: handler,
        openApi: { tag: 'Catalog', methods: { PUT: {} } },
        metadata: { PUT: { requireAuth: true, requireFeatures: ['catalog.products.manage'] } },
      }),
    } as ApiRouteManifestEntry,
  ]
}

describe('ai-api-operation-runner — expected record version', () => {
  beforeEach(() => registerApiInterceptors([]))
  afterEach(() => registerApiInterceptors([]))

  it('expectedRecordVersionFor resolves the captured version by exact record id and null otherwise', () => {
    const ctx = makeCtx({ [PRODUCT_ID]: VERSION })
    expect(expectedRecordVersionFor(ctx, PRODUCT_ID)).toBe(VERSION)
    expect(expectedRecordVersionFor(ctx, PRODUCT_ID.toUpperCase())).toBeNull()
    expect(expectedRecordVersionFor(ctx, 'toString')).toBeNull()
    expect(expectedRecordVersionFor(ctx, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBeNull()
    expect(expectedRecordVersionFor(makeCtx(), PRODUCT_ID)).toBeNull()
  })

  it('sends the optimistic-lock header on the synthetic PUT', async () => {
    const captured: Request[] = []
    const ctx = makeCtx({ [PRODUCT_ID]: VERSION })
    const runner = createAiApiOperationRunner(ctx, { apiRoutes: productsRoute(captured) })

    const result = await runner.run({
      method: 'PUT',
      path: '/catalog/products',
      body: { id: PRODUCT_ID, title: 'AI title' },
      expectedUpdatedAt: expectedRecordVersionFor(ctx, PRODUCT_ID),
    })

    expect(result.success).toBe(true)
    expect(captured).toHaveLength(1)
    expect(captured[0].headers.get(OPTIMISTIC_LOCK_HEADER_NAME)).toBe(VERSION)
    expect(captured[0].headers.get('content-type')).toBe('application/json')
  })

  it('normalizes the token to the ISO form the CRUD guard compares', async () => {
    const captured: Request[] = []
    const runner = createAiApiOperationRunner(makeCtx(), { apiRoutes: productsRoute(captured) })

    await runner.run({
      method: 'PUT',
      path: '/catalog/products',
      body: { id: PRODUCT_ID },
      expectedUpdatedAt: '2026-10-13T12:00:00+02:00',
    })

    expect(captured[0].headers.get(OPTIMISTIC_LOCK_HEADER_NAME)).toBe(VERSION)
  })

  it('refuses an unparseable token instead of silently skipping the version check', async () => {
    const captured: Request[] = []
    const runner = createAiApiOperationRunner(makeCtx(), { apiRoutes: productsRoute(captured) })

    const result = await runner.run({
      method: 'PUT',
      path: '/catalog/products',
      body: { id: PRODUCT_ID },
      expectedUpdatedAt: 'not-a-date',
    })

    expect(result).toMatchObject({ success: false, statusCode: 400 })
    expect(captured).toHaveLength(0)
  })

  it('sends no optimistic-lock header when no version is given', async () => {
    const captured: Request[] = []
    const runner = createAiApiOperationRunner(makeCtx(), { apiRoutes: productsRoute(captured) })

    await runner.run({ method: 'PUT', path: '/catalog/products', body: { id: PRODUCT_ID } })
    await runner.run({ method: 'PUT', path: '/catalog/products', body: { id: PRODUCT_ID }, expectedUpdatedAt: null })

    expect(captured).toHaveLength(2)
    expect(captured[0].headers.get(OPTIMISTIC_LOCK_HEADER_NAME)).toBeNull()
    expect(captured[1].headers.get(OPTIMISTIC_LOCK_HEADER_NAME)).toBeNull()
  })
})

describe('ai-api-operation-runner — expected record version against the real CRUD guard', () => {
  beforeEach(() => registerApiInterceptors([]))
  afterEach(() => registerApiInterceptors([]))

  function guardedProductsRoute(currentVersion: { value: string }, writes: string[]): ApiRouteManifestEntry[] {
    const guard = createOptimisticLockGuardService({
      getEm: () => ({}) as never,
      envValue: 'all',
      readers: { 'catalog.product': async () => currentVersion.value },
    })
    const handler = async (req: Request) => {
      const body = (await req.json()) as { id: string; title: string }
      const verdict = await guard.validateMutation({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
        resourceKind: 'catalog.product',
        resourceId: body.id,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
      })
      if (!verdict.ok) {
        return new Response(JSON.stringify(verdict.body), {
          status: verdict.status,
          headers: { 'content-type': 'application/json' },
        })
      }
      writes.push(body.title)
      currentVersion.value = new Date(Date.parse(currentVersion.value) + 1000).toISOString()
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return [
      {
        moduleId: 'catalog',
        kind: 'route-file',
        path: '/catalog/products',
        methods: ['PUT'],
        load: async () => ({
          PUT: handler,
          openApi: { tag: 'Catalog', methods: { PUT: {} } },
          metadata: { PUT: { requireAuth: true, requireFeatures: ['catalog.products.manage'] } },
        }),
      } as ApiRouteManifestEntry,
    ]
  }

  it('writes when the record still has the previewed version and refuses with a conflict once it moved', async () => {
    const currentVersion = { value: VERSION }
    const writes: string[] = []
    const ctx = makeCtx({ [PRODUCT_ID]: VERSION })
    const runner = createAiApiOperationRunner(ctx, { apiRoutes: guardedProductsRoute(currentVersion, writes) })
    const write = (title: string) =>
      runner.run({
        method: 'PUT',
        path: '/catalog/products',
        body: { id: PRODUCT_ID, title },
        expectedUpdatedAt: expectedRecordVersionFor(ctx, PRODUCT_ID),
      })

    const first = await write('approved')
    const second = await write('after the record moved')

    expect(first.success).toBe(true)
    expect(second).toMatchObject({
      success: false,
      statusCode: 409,
      details: { code: 'optimistic_lock_conflict', expectedUpdatedAt: VERSION },
    })
    expect(writes).toEqual(['approved'])
  })

  it('without an expected version the guard lets the write through (last write wins)', async () => {
    const currentVersion = { value: '2026-10-13T11:00:00.000Z' }
    const writes: string[] = []
    const runner = createAiApiOperationRunner(makeCtx(), { apiRoutes: guardedProductsRoute(currentVersion, writes) })

    const result = await runner.run({ method: 'PUT', path: '/catalog/products', body: { id: PRODUCT_ID, title: 'blind' } })

    expect(result.success).toBe(true)
    expect(writes).toEqual(['blind'])
  })
})
