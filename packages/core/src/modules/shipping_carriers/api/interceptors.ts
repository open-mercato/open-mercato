import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { getShippingAdapter } from '../lib/adapter-registry'

export const interceptors: ApiInterceptor[] = [
  {
    id: 'shipping_carriers.validate-provider',
    targetRoute: 'shipping-carriers/*',
    methods: ['POST', 'GET'],
    priority: 100,
    async before(request) {
      const providerKey = (request.body?.providerKey ?? request.query?.providerKey) as string | undefined
      if (!providerKey || providerKey.trim().length === 0) return { ok: true }
      if (!getShippingAdapter(providerKey.trim())) {
        return { ok: false, statusCode: 422, message: `Unknown shipping provider: ${providerKey}` }
      }
      return { ok: true }
    },
  },
]
