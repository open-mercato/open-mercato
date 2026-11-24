import type { OAuthGrantOwner } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import { XERO_INTEGRATION_ID } from './constants'

export type XeroScope = { tenantId: string; organizationId: string }

export function buildXeroGrantOwner(scope: XeroScope): OAuthGrantOwner {
  return { integrationId: XERO_INTEGRATION_ID, tenantId: scope.tenantId, organizationId: scope.organizationId, userId: null }
}
