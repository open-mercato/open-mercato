import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { getGatewayAdapter } from '@open-mercato/shared/modules/payment_gateways/types'

export const interceptors: ApiInterceptor[] = [
  {
    id: 'payment_gateways.validate-provider',
    targetRoute: 'sessions',
    methods: ['POST'],
    priority: 100,
    async before(request) {
      const providerKey = request.body?.providerKey
      if (typeof providerKey !== 'string' || providerKey.trim().length === 0) {
        return { ok: false, statusCode: 422, message: 'providerKey is required' }
      }
      const adapter = getGatewayAdapter(providerKey.trim())
      if (!adapter) {
        return { ok: false, statusCode: 422, message: `Unknown payment provider: ${providerKey}` }
      }
      return { ok: true }
    },
  },
]
