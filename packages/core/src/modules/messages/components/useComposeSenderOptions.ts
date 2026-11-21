import { useQuery } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { toComposeSenderOptions } from '../lib/composeSenderOptions'

export function useComposeSenderOptions(enabled = true) {
  const scopeVersion = useOrganizationScopeVersion()
  const { data } = useQuery({
    queryKey: ['messages', 'composeSenderOptions', scopeVersion],
    enabled,
    queryFn: async () => {
      try {
        const response = await apiCall<{ items?: unknown[] }>('/api/communication_channels/me/channels', {
          method: 'GET',
          headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
        })
        return response.ok ? toComposeSenderOptions(response.result?.items) : []
      } catch {
        return []
      }
    },
  })
  return enabled ? data : undefined
}
