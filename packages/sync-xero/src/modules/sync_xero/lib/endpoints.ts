import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { XERO_ENDPOINTS, type XeroEndpoints } from './constants'
import type { XeroScope } from './owner'

export type XeroEndpointResolutionInput = {
  scope: XeroScope
  credentialsService: Pick<CredentialsService, 'resolve'>
}

export async function resolveXeroEndpoints(_input: XeroEndpointResolutionInput): Promise<XeroEndpoints> {
  return { ...XERO_ENDPOINTS }
}
