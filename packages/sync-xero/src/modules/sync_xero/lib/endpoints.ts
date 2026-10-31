import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { XERO_ENDPOINTS, XERO_INTEGRATION_ID, type XeroEndpoints } from './constants'
import type { XeroScope } from './owner'
import { isSeamClientId, isXeroSeamEnabled, seamEndpoints, seamRegistry } from './testing/seam'

export type XeroEndpointResolutionInput = {
  scope: XeroScope
  credentialsService: Pick<CredentialsService, 'resolve'>
}

export class XeroTestFakesUnavailableError extends Error {
  readonly code = 'xero.test_fakes_unavailable'

  constructor() {
    super('[internal] xero.test_fakes_unavailable: the Xero test fakes of this organization are not running in this process')
    this.name = 'XeroTestFakesUnavailableError'
  }
}

/**
 * Xero's endpoints, or the test seam's loopback fakes when OM_ENABLE_TEST_OAUTH_GRANTS is on and
 * the organization's fakes run in this process. With the flag on, an organization whose Client ID
 * carries the seam mark but whose fakes are not running throws instead of reaching Xero.
 */
export async function resolveXeroEndpoints(input: XeroEndpointResolutionInput): Promise<XeroEndpoints> {
  if (!isXeroSeamEnabled()) return { ...XERO_ENDPOINTS }
  const fakes = seamRegistry().get(input.scope.organizationId)
  if (fakes) return seamEndpoints(fakes)
  const credentials = await input.credentialsService.resolve(XERO_INTEGRATION_ID, input.scope)
  if (isSeamClientId(credentials?.clientId)) throw new XeroTestFakesUnavailableError()
  return { ...XERO_ENDPOINTS }
}
