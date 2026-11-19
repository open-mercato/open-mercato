import type { OAuthGrantInspection } from './grant-service'

/** Health codes of an OAuth grant (App Spec §1.4.4); additive-only, consumers keep a default branch. */
export const OAUTH_HEALTH_CODES = {
  platformUnavailable: 'oauth.platform_unavailable',
  notConnected: 'oauth.not_connected',
  invalidated: 'oauth.invalidated',
  clientChanged: 'oauth.client_changed',
  clientMisconfigured: 'oauth.client_misconfigured',
  transient: 'oauth.transient',
  scopeDrift: 'oauth.scope_drift',
  connected: 'oauth.connected',
  scopeInsufficient: 'oauth.scope_insufficient',
} as const

export type OAuthHealthCode = (typeof OAUTH_HEALTH_CODES)[keyof typeof OAUTH_HEALTH_CODES]

function unhealthy(code: OAuthHealthCode): { status: 'unhealthy'; details: { code: OAuthHealthCode } } {
  return { status: 'unhealthy', details: { code } }
}

function degraded(code: OAuthHealthCode): { status: 'degraded'; details: { code: OAuthHealthCode } } {
  return { status: 'degraded', details: { code } }
}

/**
 * Pure and network-free: maps an `inspectGrant` result to a health result in the App Spec §1.4.4
 * precedence (`oauth.platform_unavailable` also when `connectionState` is `unavailable` because the
 * Client Configuration can't be read; `oauth.client_misconfigured` also when a grant exists but the
 * Client Configuration has no client ID or secret). `details` holds only `{ code }`, never a token.
 * `oauth.scope_insufficient` never comes from here: only the provider's own resource call reports it.
 */
export function mapInspectionToHealth(
  inspection: OAuthGrantInspection,
): { status: 'healthy' | 'degraded' | 'unhealthy'; details: { code: OAuthHealthCode } } {
  if (inspection.status === 'unavailable' || inspection.connectionState === 'unavailable') {
    return unhealthy(OAUTH_HEALTH_CODES.platformUnavailable)
  }
  if (inspection.status === 'none') return unhealthy(OAUTH_HEALTH_CODES.notConnected)
  if (inspection.status === 'invalidated') return unhealthy(OAUTH_HEALTH_CODES.invalidated)
  if (inspection.connectionState === 'not_configured') return unhealthy(OAUTH_HEALTH_CODES.clientMisconfigured)
  if (inspection.clientChanged) return unhealthy(OAUTH_HEALTH_CODES.clientChanged)
  if (inspection.lastFailureClass === 'client_misconfigured') return unhealthy(OAUTH_HEALTH_CODES.clientMisconfigured)
  if (inspection.lastFailureClass === 'transient') return degraded(OAUTH_HEALTH_CODES.transient)
  if (inspection.missingScopes.length > 0) return degraded(OAUTH_HEALTH_CODES.scopeDrift)
  return { status: 'healthy', details: { code: OAUTH_HEALTH_CODES.connected } }
}
