import { NextResponse } from 'next/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { PrivacyScope } from '@open-mercato/shared/lib/privacy'
import type { PrivacyPolicyService } from '../services/policyService'
import type { PrivacyLegalHoldService } from '../services/legalHoldService'
import type { PrivacyGovernanceService } from '../services/governanceService'

export type PrivacyApiContext = {
  actorId: string
  scope: PrivacyScope
  container: Awaited<ReturnType<typeof createRequestContainer>>
  commandContext: CommandRuntimeContext
  privacyPolicyService: PrivacyPolicyService
  privacyLegalHoldService: PrivacyLegalHoldService
  privacyGovernanceService: PrivacyGovernanceService
}

export async function resolvePrivacyApiContext(request: Request): Promise<PrivacyApiContext | Response> {
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const container = await createRequestContainer()
  const featureContext = await resolveFeatureCheckContext({ container, auth, request })
  if (!featureContext.organizationId) {
    return NextResponse.json(
      { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
      { status: 400 },
    )
  }
  const scope = { tenantId: auth.tenantId, organizationId: featureContext.organizationId }
  return {
    actorId: auth.sub,
    scope,
    container,
    commandContext: {
      container,
      auth,
      organizationScope: featureContext.scope,
      selectedOrganizationId: featureContext.organizationId,
      organizationIds: featureContext.allowedOrganizationIds,
      request,
    },
    privacyPolicyService: container.resolve('privacyPolicyService'),
    privacyLegalHoldService: container.resolve('privacyLegalHoldService'),
    privacyGovernanceService: container.resolve('privacyGovernanceService'),
  }
}
