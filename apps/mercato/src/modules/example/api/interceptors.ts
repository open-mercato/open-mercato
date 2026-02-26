import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'

export const interceptors: ApiInterceptor[] = [
  {
    id: 'example.audit-log',
    targetRoute: 'example/*',
    methods: ['POST', 'PUT', 'DELETE'],
    priority: 100,
    async before(request, context) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[example.audit-log] ${request.method} ${request.url} by user ${context.userId}`)
      }
      return { ok: true }
    },
  },
  {
    id: 'example.enrich-list',
    targetRoute: 'example/*',
    methods: ['GET'],
    priority: 0,
    async after(_request, _response, _context) {
      return {
        merge: {
          _example: { intercepted: true, interceptedAt: new Date().toISOString() },
        },
      }
    },
  },
]

export default interceptors
