import type { OAuthGrantInspection } from '../grant-service'
import { mapInspectionToHealth, OAUTH_HEALTH_CODES, type OAuthHealthCode } from '../health'

type ReadableInspection = Extract<OAuthGrantInspection, { status: 'active' | 'invalidated' }>

function readableInspection(overrides: Partial<ReadableInspection> = {}): ReadableInspection {
  const at = new Date('2026-10-12T10:00:00.000Z')
  return {
    status: 'active',
    connectionState: 'active',
    unavailableReason: null,
    baseUrlMissing: false,
    expiresAt: new Date(at.getTime() + 3600 * 1000),
    refreshedAt: null,
    obtainedAt: at,
    revisedAt: at,
    lastFailureClass: null,
    lastFailureAt: null,
    clientChanged: false,
    missingScopes: [],
    hasExternalAccount: true,
    providerData: { externalAccountId: 'acct-1' },
    previousProviderData: null,
    ...overrides,
  }
}

const everyFailure: Partial<ReadableInspection> = {
  status: 'invalidated',
  connectionState: 'invalidated',
  clientChanged: true,
  lastFailureClass: 'client_misconfigured',
  lastFailureAt: new Date('2026-10-12T10:30:00.000Z'),
  missingScopes: ['test.write'],
}

describe('mapInspectionToHealth', () => {
  it('maps a grant that can not be read to oauth.platform_unavailable before anything else', () => {
    const cases: OAuthGrantInspection[] = [
      { status: 'unavailable', connectionState: 'unavailable', unavailableReason: 'unreadable', baseUrlMissing: false },
      { status: 'unavailable', connectionState: 'unavailable', unavailableReason: 'platform', baseUrlMissing: true },
      { status: 'unavailable', connectionState: 'not_configured', unavailableReason: null, baseUrlMissing: false },
      { status: 'none', connectionState: 'unavailable', unavailableReason: 'platform', baseUrlMissing: false, lastDisconnect: null },
      readableInspection({ ...everyFailure, connectionState: 'unavailable', unavailableReason: 'platform' }),
    ]

    for (const inspection of cases) {
      expect(mapInspectionToHealth(inspection)).toEqual({
        status: 'unhealthy',
        details: { code: OAUTH_HEALTH_CODES.platformUnavailable },
      })
    }
  })

  it('maps a missing grant to oauth.not_connected, also when the Client Configuration is missing', () => {
    const lastDisconnect = { at: new Date(), disconnectId: 'disconnect-1', revocation: 'pending' as const }
    for (const connectionState of ['not_connected', 'not_configured'] as const) {
      expect(mapInspectionToHealth({
        status: 'none',
        connectionState,
        unavailableReason: null,
        baseUrlMissing: false,
        lastDisconnect,
      })).toEqual({ status: 'unhealthy', details: { code: OAUTH_HEALTH_CODES.notConnected } })
    }
  })

  it('follows the App Spec precedence from oauth.invalidated down to oauth.connected', () => {
    const ladder: Array<[Partial<ReadableInspection>, 'healthy' | 'degraded' | 'unhealthy', OAuthHealthCode]> = [
      [everyFailure, 'unhealthy', OAUTH_HEALTH_CODES.invalidated],
      [{ ...everyFailure, status: 'active', connectionState: 'not_configured' }, 'unhealthy', OAUTH_HEALTH_CODES.clientMisconfigured],
      [{ ...everyFailure, status: 'active', connectionState: 'active' }, 'unhealthy', OAUTH_HEALTH_CODES.clientChanged],
      [{ ...everyFailure, status: 'active', connectionState: 'active', clientChanged: false }, 'unhealthy', OAUTH_HEALTH_CODES.clientMisconfigured],
      [
        { ...everyFailure, status: 'active', connectionState: 'active', clientChanged: false, lastFailureClass: 'transient' },
        'degraded',
        OAUTH_HEALTH_CODES.transient,
      ],
      [
        { ...everyFailure, status: 'active', connectionState: 'active', clientChanged: false, lastFailureClass: null, lastFailureAt: null },
        'degraded',
        OAUTH_HEALTH_CODES.scopeDrift,
      ],
      [{}, 'healthy', OAUTH_HEALTH_CODES.connected],
    ]

    for (const [overrides, status, code] of ladder) {
      expect(mapInspectionToHealth(readableInspection(overrides))).toEqual({ status, details: { code } })
    }
  })

  it('keeps an account-pending grant and a missing APP_URL at oauth.connected', () => {
    const pending = readableInspection({ hasExternalAccount: false, providerData: null, baseUrlMissing: true })

    expect(mapInspectionToHealth(pending)).toEqual({ status: 'healthy', details: { code: OAUTH_HEALTH_CODES.connected } })
  })

  it('never returns oauth.scope_insufficient, which only a resource call can observe', () => {
    const inspections: OAuthGrantInspection[] = [
      readableInspection(),
      readableInspection(everyFailure),
      readableInspection({ missingScopes: ['test.write'] }),
      { status: 'none', connectionState: 'not_connected', unavailableReason: null, baseUrlMissing: false, lastDisconnect: null },
    ]

    for (const inspection of inspections) {
      expect(mapInspectionToHealth(inspection).details.code).not.toBe(OAUTH_HEALTH_CODES.scopeInsufficient)
    }
  })

  it('puts only the code into details, never provider data', () => {
    const inspections = [readableInspection(), readableInspection(everyFailure), readableInspection({ lastFailureClass: 'transient' })]

    for (const inspection of inspections) {
      const result = mapInspectionToHealth(inspection)
      expect(Object.keys(result.details)).toEqual(['code'])
      expect(JSON.stringify(result)).not.toContain('acct-1')
    }
  })

  it('exposes every App Spec health code', () => {
    expect(Object.values(OAUTH_HEALTH_CODES).sort()).toEqual([
      'oauth.client_changed',
      'oauth.client_misconfigured',
      'oauth.connected',
      'oauth.invalidated',
      'oauth.not_connected',
      'oauth.platform_unavailable',
      'oauth.scope_drift',
      'oauth.scope_insufficient',
      'oauth.transient',
    ])
  })
})
