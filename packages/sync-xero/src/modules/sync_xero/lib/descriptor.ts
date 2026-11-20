import type { OAuthProviderDescriptor } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import { XERO_ACCESS_TOKEN_TTL_SEC, XERO_INTEGRATION_ID, XERO_SCOPES, type XeroEndpoints } from './constants'

export function createXeroDescriptor(endpoints: Pick<XeroEndpoints, 'authorize' | 'token' | 'revoke'>): OAuthProviderDescriptor {
  return {
    integrationId: XERO_INTEGRATION_ID,
    authorizationEndpoint: endpoints.authorize,
    tokenEndpoint: endpoints.token,
    ...(endpoints.revoke ? { revocationEndpoint: endpoints.revoke } : {}),
    clientAuthMethod: 'client_secret_basic',
    pkce: 'S256',
    defaultScopes: [...XERO_SCOPES],
    defaultAccessTokenTtlSec: XERO_ACCESS_TOKEN_TTL_SEC,
  }
}
