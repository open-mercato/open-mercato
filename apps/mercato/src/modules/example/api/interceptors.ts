import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'

export const interceptors: ApiInterceptor[] = [
  // 1. Logging interceptor (priority 10) - logs mutations to example/todos
  {
    id: 'example.audit-log',
    targetRoute: 'example/*',
    methods: ['POST', 'PUT', 'DELETE'],
    priority: 10,
    async before(request, context) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[example.audit-log] ${request.method} ${request.url} by user ${context.userId}`)
      }
      return { ok: true, metadata: { auditTimestamp: Date.now() } }
    },
  },

  // 2. Validation interceptor (priority 100) - rejects titles containing "BLOCKED"
  {
    id: 'example.block-test-todos',
    targetRoute: 'example/todos',
    methods: ['POST', 'PUT'],
    priority: 100,
    async before(request) {
      const title = request.body?.title
      if (typeof title === 'string' && title.includes('BLOCKED')) {
        return {
          ok: false,
          message: 'Todo titles containing "BLOCKED" are not allowed',
          statusCode: 422,
        }
      }
      return { ok: true }
    },
  },

  // 3. Response augmentation (priority 50) - adds server timestamp using metadata passthrough
  {
    id: 'example.add-server-timestamp',
    targetRoute: 'example/*',
    methods: ['GET'],
    priority: 50,
    async before(_request, _context) {
      return {
        ok: true,
        metadata: { processingStartedAt: Date.now() },
      }
    },
    async after(_request, _response, context) {
      const startedAt = context.metadata?.processingStartedAt as number | undefined
      const processingTimeMs = startedAt ? Date.now() - startedAt : undefined
      return {
        merge: {
          _example: {
            serverTimestamp: new Date().toISOString(),
            processingTimeMs,
            intercepted: true,
          },
        },
      }
    },
  },
]

export default interceptors
