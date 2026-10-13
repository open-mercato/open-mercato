import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { FakeAuthorizationServer } from '@open-mercato/core/modules/integrations/lib/oauth/testing/fakeAuthorizationServer'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { XERO_INTEGRATION_ID, type XeroEndpoints } from '../constants'
import type { XeroScope } from '../owner'
import type { FakeXeroApi } from './fakeXeroApi'

export const XERO_SEAM_CLIENT_ID_PREFIX = 'om_test_seam_'

const SEAM_GLOBAL_KEY = '__omSyncXeroTestFakes__'

export type XeroSeamFakes = {
  authorizationServer: FakeAuthorizationServer
  xeroApi: FakeXeroApi
}

type SeamGlobal = typeof globalThis & { [SEAM_GLOBAL_KEY]?: Map<string, XeroSeamFakes> }

export function isXeroSeamEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_ENABLE_TEST_OAUTH_GRANTS, false)
}

export function seamRegistry(): Map<string, XeroSeamFakes> {
  const slot = globalThis as SeamGlobal
  if (!slot[SEAM_GLOBAL_KEY]) slot[SEAM_GLOBAL_KEY] = new Map()
  return slot[SEAM_GLOBAL_KEY]
}

export function isSeamClientId(clientId: unknown): boolean {
  return typeof clientId === 'string' && clientId.startsWith(XERO_SEAM_CLIENT_ID_PREFIX)
}

export function seamEndpoints(fakes: XeroSeamFakes): XeroEndpoints {
  return {
    authorize: fakes.authorizationServer.authorizationEndpoint,
    token: fakes.authorizationServer.tokenEndpoint,
    ...(fakes.authorizationServer.revocationEndpoint ? { revoke: fakes.authorizationServer.revocationEndpoint } : {}),
    connections: fakes.xeroApi.endpoints.connections,
    accounting: fakes.xeroApi.endpoints.accounting,
  }
}

export async function isSeamOrganization(scope: XeroScope, credentialsService: Pick<CredentialsService, 'getRaw'>): Promise<boolean> {
  if (!isXeroSeamEnabled()) return false
  if (seamRegistry().has(scope.organizationId)) return true
  return isSeamClientId((await credentialsService.getRaw(XERO_INTEGRATION_ID, scope))?.clientId)
}
