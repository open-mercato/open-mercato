import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { ExampleCustomerPriority } from '../data/entities'

type UnknownRecord = Record<string, unknown>

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export const interceptors: ApiInterceptor[] = [
  {
    id: 'example.block-test-todos',
    targetRoute: 'example/todos',
    methods: ['POST', 'PUT'],
    features: ['example.todos.manage'],
    priority: 100,
    async before(request) {
      const title = request.body?.title
      if (typeof title === 'string' && title.includes('BLOCKED')) {
        return {
          ok: false,
          statusCode: 422,
          message: 'Todo titles containing "BLOCKED" are blocked by interceptor.',
        }
      }
      return { ok: true }
    },
  },
  {
    id: 'example.todos-probe-timeout',
    targetRoute: 'example/todos',
    methods: ['GET'],
    features: ['example.todos.view'],
    priority: 90,
    timeoutMs: 100,
    async before(request) {
      const probe = readString(request.query?.interceptorProbe)
      if (probe !== 'timeout') return { ok: true }
      await new Promise((resolve) => setTimeout(resolve, 200))
      return { ok: true }
    },
  },
  {
    id: 'example.todos-probe-crash',
    targetRoute: 'example/todos',
    methods: ['GET'],
    features: ['example.todos.view'],
    priority: 89,
    async before(request) {
      const probe = readString(request.query?.interceptorProbe)
      if (probe !== 'crash') return { ok: true }
      throw new Error('Interceptor crash probe')
    },
  },
  {
    id: 'example.todos-probe-bad-query',
    targetRoute: 'example/todos',
    methods: ['GET'],
    features: ['example.todos.view'],
    priority: 88,
    async before(request) {
      const probe = readString(request.query?.interceptorProbe)
      if (probe !== 'bad-query') return { ok: true }
      return {
        ok: true,
        query: {
          ...(request.query ?? {}),
          interceptorProbe: undefined,
          page: 'not-a-number',
        },
      }
    },
  },
  {
    id: 'example.wildcard-probe',
    targetRoute: 'example/*',
    methods: ['GET'],
    features: ['example.todos.view'],
    priority: 60,
    async before(request) {
      const probe = readString(request.query?.interceptorProbe)
      if (probe !== 'wildcard') return { ok: true }
      return {
        ok: true,
        metadata: { wildcardProbe: true },
      }
    },
    async after(_request, response, context) {
      if (!context.metadata?.wildcardProbe) return {}
      return {
        merge: {
          _example: {
            ...((response.body._example as Record<string, unknown> | undefined) ?? {}),
            wildcardProbe: true,
          },
        },
      }
    },
  },
  {
    id: 'example.todos-response-meta',
    targetRoute: 'example/todos',
    methods: ['GET'],
    features: ['example.todos.view'],
    priority: 10,
    async before() {
      return {
        ok: true,
        metadata: { startedAt: Date.now() },
      }
    },
    async after(_request, response, context) {
      return {
        merge: {
          _example: {
            ...((response.body._example as Record<string, unknown> | undefined) ?? {}),
            interceptor: {
              processedAt: new Date().toISOString(),
              processingTimeMs: Math.max(0, Date.now() - Number(context.metadata?.startedAt ?? Date.now())),
            },
          },
        },
      }
    },
  },
  {
    id: 'example.customer-priority-filter',
    targetRoute: 'customers/people',
    methods: ['GET'],
    features: ['example.view'],
    priority: 70,
    async before(request) {
      const priority = readString(request.query?.examplePriority)
      if (!priority) return { ok: true }
      return {
        ok: true,
        query: {
          ...(request.query ?? {}),
          examplePriority: undefined,
        },
        metadata: {
          examplePriority: priority,
        },
      }
    },
    async after(_request, response, context) {
      const priority = readString(context.metadata?.examplePriority)
      if (!priority) return {}
      const responseBody = response.body as UnknownRecord
      const items = Array.isArray(responseBody.items)
        ? responseBody.items
        : (Array.isArray(responseBody.data) ? responseBody.data : [])
      if (items.length === 0) return {}
      const customerIds = items
        .map((item) => (item && typeof item === 'object' ? readString((item as UnknownRecord).id) : null))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (customerIds.length === 0) return {}

      const matches = await context.em.find(ExampleCustomerPriority, {
        customerId: { $in: customerIds },
        priority,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        deletedAt: null,
      }, { fields: ['customerId'] })
      const matchedIds = new Set(matches.map((entry) => entry.customerId))
      const filtered = items.filter((item) => {
        if (!item || typeof item !== 'object') return false
        const id = readString((item as UnknownRecord).id)
        return id ? matchedIds.has(id) : false
      })
      return {
        replace: {
          ...responseBody,
          items: filtered,
          total: filtered.length,
        },
      }
    },
  },
]
