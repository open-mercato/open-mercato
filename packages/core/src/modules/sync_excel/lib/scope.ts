import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { isAllOrganizationsSelection } from '@open-mercato/core/modules/directory/constants'
import { getSelectedOrganizationFromRequest, resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { TenantScope } from '../../data_sync/lib/adapter'

export type SyncExcelConcreteScopeResult =
  | { ok: true; scope: TenantScope }
  | { ok: false; status: 401 | 422; error: string }

const CONCRETE_ORGANIZATION_REQUIRED_ERROR = 'Select a concrete organization before importing CSV.'

function normalizeSelectedOrganizationId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function resolveSyncExcelConcreteScope(params: {
  auth: AuthContext
  container: AwilixContainer
  request: Request
}): Promise<SyncExcelConcreteScopeResult> {
  const { auth, container, request } = params
  if (!auth?.tenantId) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const requestedSelectedId = normalizeSelectedOrganizationId(getSelectedOrganizationFromRequest(request))
  if (!requestedSelectedId || isAllOrganizationsSelection(requestedSelectedId)) {
    return { ok: false, status: 422, error: CONCRETE_ORGANIZATION_REQUIRED_ERROR }
  }

  const organizationScope = await resolveOrganizationScopeForRequest({
    container,
    auth,
    request,
    selectedId: requestedSelectedId,
  })

  const selectedId = organizationScope.selectedId
  const tenantId = organizationScope.tenantId ?? auth.tenantId
  const filterIds = organizationScope.filterIds
  const selectedIsResolvable = Boolean(
    selectedId
    && tenantId
    && Array.isArray(filterIds)
    && selectedId === requestedSelectedId
    && filterIds.includes(selectedId),
  )

  if (!selectedIsResolvable || !selectedId || !tenantId) {
    return { ok: false, status: 422, error: CONCRETE_ORGANIZATION_REQUIRED_ERROR }
  }

  return {
    ok: true,
    scope: {
      organizationId: selectedId,
      tenantId,
    },
  }
}
