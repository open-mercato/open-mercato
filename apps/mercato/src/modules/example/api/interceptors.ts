import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'

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
]
