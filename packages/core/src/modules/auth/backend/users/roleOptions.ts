import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'

type RoleListResponse = {
  items?: Array<{ id?: string | null; name?: string | null }>
}

type FetchRoleOptionsParams = {
  tenantId?: string | null
}

export async function fetchRoleOptions(query?: string, params?: FetchRoleOptionsParams): Promise<CrudFieldOption[]> {
  const searchParams = new URLSearchParams({ page: '1', pageSize: '20' })
  if (query && query.trim()) searchParams.set('search', query.trim())
  const tenantId = typeof params?.tenantId === 'string' && params.tenantId.trim().length ? params.tenantId.trim() : null
  if (tenantId) searchParams.set('tenantId', tenantId)

  try {
    const call = await apiCall<RoleListResponse>(
      `/api/auth/roles?${searchParams.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok || !Array.isArray(call.result?.items)) return []
    const { items } = call.result
    return items
      .map((item) => {
        const name = typeof item?.name === 'string' ? item?.name.trim() : ''
        if (!name) return null
        if (name === 'superadmin') return null
        return { value: name, label: name }
      })
      .filter((opt): opt is CrudFieldOption => !!opt)
  } catch {
    return []
  }
}
