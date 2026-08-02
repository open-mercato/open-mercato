import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'

function hasValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export const interceptors: ApiInterceptor[] = [
  {
    id: 'reference_module.link-filter-pair',
    targetRoute: 'reference_module/tasks',
    methods: ['GET'],
    features: ['reference_module.view'],
    priority: 10,
    async before(request) {
      const hasKind = hasValue(request.query?.linkTargetKind)
      const hasId = hasValue(request.query?.linkTargetId)
      if (hasKind !== hasId) {
        return { ok: false, statusCode: 400, message: 'Link target kind and id must be supplied together' }
      }
      return { ok: true, metadata: { scopedReferenceList: true } }
    },
    async after(_request, response, context) {
      if (!context.metadata?.scopedReferenceList) return {}
      return {
        merge: {
          _reference_module: {
            ...((response.body._reference_module as Record<string, unknown> | undefined) ?? {}),
            scoped: true,
          },
        },
      }
    },
  },
]
