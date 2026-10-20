import { registerTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { foldScopeSettings } from '../compute'
import { AnalyticsIndividualsDeniedError } from '../errors'
import {
  XRAY_INDIVIDUALS_RESOURCE_KIND,
  assertIndividualsAllowed,
  checkIndividualsGate,
  isAccessLogWriter,
  recordIndividualsAccess,
  type XrayAccessLogEntry,
} from '../privacy'
import type { AnalyticsOrgSettings, AnalyticsViewer } from '../types'
import { ANALYTICS_ORG, ANALYTICS_OTHER_ORG } from './analyticsTestSupport'

const TENANT = '11111111-0000-4000-8000-000000000001'
const VIEWER: AnalyticsViewer = { userId: '33333333-0000-4000-8000-000000000001', features: ['insights.xray.view'], canViewIndividuals: true }
const WINDOW_VIEW = { from: 'from', to: 'to', windowKey: null, timeZone: 'UTC' }

function settingsFor(entries: Array<[string, Partial<AnalyticsOrgSettings>]>) {
  return new Map(entries.map(([organizationId, values]) => [organizationId, { kAnonymity: 10, debounceSeconds: 120, individualsEnabled: false, ...values }]))
}

async function denialOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run()
    return null
  } catch (error) {
    return error instanceof AnalyticsIndividualsDeniedError ? error.reason : 'unexpected'
  }
}

describe('X-Ray per-person privacy gate', () => {
  it('requires the feature, a known viewer, an organization and the setting in every organization', () => {
    const enabled = foldScopeSettings([ANALYTICS_ORG], settingsFor([[ANALYTICS_ORG, { individualsEnabled: true }]]))
    expect(checkIndividualsGate(VIEWER, enabled)).toEqual({ allowed: true })
    expect(checkIndividualsGate({ ...VIEWER, canViewIndividuals: false }, enabled)).toEqual({ allowed: false, reason: 'feature_missing' })
    expect(checkIndividualsGate({ ...VIEWER, userId: null }, enabled)).toEqual({ allowed: false, reason: 'viewer_unknown' })
    expect(checkIndividualsGate(VIEWER, foldScopeSettings([], new Map()))).toEqual({ allowed: false, reason: 'no_organization' })
    const mixed = foldScopeSettings([ANALYTICS_ORG, ANALYTICS_OTHER_ORG], settingsFor([[ANALYTICS_ORG, { individualsEnabled: true }]]))
    expect(checkIndividualsGate(VIEWER, mixed)).toEqual({ allowed: false, reason: 'setting_disabled' })
    expect(() => assertIndividualsAllowed(VIEWER, mixed)).toThrow(AnalyticsIndividualsDeniedError)
  })

  it('folds organization settings to the strictest k, per-organization debounce and a settings fingerprint', () => {
    const folded = foldScopeSettings([ANALYTICS_OTHER_ORG, ANALYTICS_ORG], settingsFor([
      [ANALYTICS_ORG, { kAnonymity: 7, debounceSeconds: 60 }],
      [ANALYTICS_OTHER_ORG, { kAnonymity: 3, debounceSeconds: 0 }],
    ]))
    expect(folded.organizationIds).toEqual([ANALYTICS_ORG, ANALYTICS_OTHER_ORG])
    expect(folded.kAnonymity).toBe(7)
    expect(folded.debounceMsByOrganization.get(ANALYTICS_ORG)).toBe(60_000)
    expect(folded.debounceMsByOrganization.get(ANALYTICS_OTHER_ORG)).toBe(0)
    const changed = foldScopeSettings([ANALYTICS_ORG, ANALYTICS_OTHER_ORG], settingsFor([
      [ANALYTICS_ORG, { kAnonymity: 8, debounceSeconds: 60 }],
      [ANALYTICS_OTHER_ORG, { kAnonymity: 3, debounceSeconds: 0 }],
    ]))
    expect(changed.fingerprint).not.toBe(folded.fingerprint)
    expect(foldScopeSettings([ANALYTICS_ORG], new Map()).kAnonymity).toBe(10)
  })

  it('writes one access log row per organization before the data is returned', async () => {
    const entries: XrayAccessLogEntry[] = []
    const writer = { log: async (entry: XrayAccessLogEntry) => { entries.push(entry); return { id: 'row' } } }
    expect(isAccessLogWriter(writer)).toBe(true)
    expect(isAccessLogWriter({})).toBe(false)
    await recordIndividualsAccess(writer, {
      tenantId: TENANT,
      organizationIds: [ANALYTICS_ORG, ANALYTICS_OTHER_ORG],
      viewer: VIEWER,
      processKey: 'test.deal',
      purpose: 'breakdown:user',
      window: WINDOW_VIEW,
    })
    expect(entries).toEqual([ANALYTICS_ORG, ANALYTICS_OTHER_ORG].map((organizationId) => expect.objectContaining({
      tenantId: TENANT,
      organizationId,
      actorUserId: VIEWER.userId,
      resourceKind: XRAY_INDIVIDUALS_RESOURCE_KIND,
      resourceId: 'test.deal',
      accessType: 'read',
      fields: ['actor_pseudonym'],
    })))
  })

  it('fails closed when the access log is missing, fails or writes nothing', async () => {
    const reported: unknown[] = []
    const runtime: TelemetryRuntime = {
      canUseGlobalTracePropagation: () => false,
      captureTraceContext: () => ({}),
      continueTrace: (_carrier, _name, fn) => fn(),
      recordHttpDuration: () => undefined,
      reportError: (error) => { reported.push(error) },
      shutdown: async () => undefined,
    }
    const unregister = registerTelemetryRuntime(runtime)
    try {
      const input = { tenantId: TENANT, organizationIds: [ANALYTICS_ORG], viewer: VIEWER, processKey: 'test.deal', purpose: 'breakdown:user', window: WINDOW_VIEW }
      expect(await denialOf(() => recordIndividualsAccess(null, input))).toBe('access_log_unavailable')
      expect(await denialOf(() => recordIndividualsAccess({ log: async () => { throw new Error('[internal] database down') } }, input))).toBe('access_log_failed')
      expect(reported).toHaveLength(1)
      expect(await denialOf(() => recordIndividualsAccess({ log: async () => null }, input))).toBe('access_log_failed')
      expect(await denialOf(() => recordIndividualsAccess({ log: async () => ({ id: 'row' }) }, { ...input, organizationIds: [] }))).toBe('no_organization')
      expect(await denialOf(() => recordIndividualsAccess({ log: async () => ({ id: 'row' }) }, { ...input, viewer: { ...VIEWER, userId: null } }))).toBe('viewer_unknown')
    } finally {
      unregister()
    }
  })
})
