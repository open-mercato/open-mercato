import {
  addAllowlistAgent,
  canAddAllowlistAgent,
  canEditContentMode,
  canEditDestination,
  classifyOtelExportSaveError,
  isOtelExportDestinationErrorCode,
  OTEL_EXPORT_INTEGRATION_HREF,
  OTEL_EXPORT_TENANT_ENDPOINTS_NOT_ALLOWED,
  formSignature,
  formToSettings,
  parseOtelExportSettingsResponse,
  parseOtelExportTestResponse,
  removeAllowlistAgent,
  settingsToForm,
} from '../lib/trace/otel/exportSettingsForm'
import { OTEL_EXPORT_AGENT_ALLOWLIST_MAX } from '../data/validators'
import { OTEL_EXPORT_DESTINATION_ERRORS } from '../lib/trace/otel/exportDestination'
import { OTEL_EXPORT_DESTINATION_SETTING_ERRORS } from '../commands/otelExport'

const RESPONSE = {
  settings: { enabled: true, content: 'none', exportUserIds: false, agentAllowlist: ['support.triage', 'claims.assess'] },
  source: 'tenant',
  updatedAt: '2026-10-27T10:00:00.000Z',
  deployment: {
    enabled: true,
    switchOn: true,
    endpointConfigured: true,
    protocol: 'http/json',
    protocolSupported: true,
    contentAllowed: false,
    traceLinkConfigured: false,
  },
  health: { lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null },
}

describe('otel export settings form mapping', () => {
  it('parses the settings response and rejects a malformed one', () => {
    const parsed = parseOtelExportSettingsResponse(RESPONSE)
    expect(parsed?.updatedAt).toBe('2026-10-27T10:00:00.000Z')
    expect(parsed?.deployment.protocol).toBe('http/json')
    expect(parseOtelExportSettingsResponse({ ...RESPONSE, deployment: null })).toBeNull()
    expect(parseOtelExportSettingsResponse({ ...RESPONSE, updatedAt: undefined })?.updatedAt).toBeNull()
    expect(parseOtelExportSettingsResponse({ ...RESPONSE, source: 'instance' })?.source).toBe('instance')
  })

  it('round-trips settings through the form with a sorted allowlist', () => {
    const form = settingsToForm(parseOtelExportSettingsResponse(RESPONSE)!.settings)
    expect(form.agentAllowlist).toEqual(['claims.assess', 'support.triage'])
    expect(formToSettings(form)).toEqual({
      ok: true,
      settings: {
        enabled: true,
        content: 'none',
        exportUserIds: false,
        agentAllowlist: ['claims.assess', 'support.triage'],
        destination: 'deployment',
      },
    })
  })

  it('sends an empty allowlist as absent (every agent)', () => {
    const form = settingsToForm({ enabled: false, content: 'none', exportUserIds: true, destination: 'deployment' })
    expect(form.agentAllowlist).toEqual([])
    const result = formToSettings(form)
    expect(result).toEqual({ ok: true, settings: { enabled: false, content: 'none', exportUserIds: true, destination: 'deployment' } })
  })

  it('keeps a stored integration destination and treats rows without one as deployment', () => {
    const form = settingsToForm({ enabled: true, content: 'none', exportUserIds: false, destination: 'integration' })
    expect(form.destination).toBe('integration')
    expect(formToSettings(form)).toMatchObject({ ok: true, settings: { destination: 'integration' } })
    expect(formSignature(form)).not.toBe(formSignature({ ...form, destination: 'deployment' }))
    expect(parseOtelExportSettingsResponse(RESPONSE)?.settings.destination).toBe('deployment')
    expect(parseOtelExportSettingsResponse(RESPONSE)?.deployment.tenantEndpointsAllowed).toBe(false)
  })

  it('adds and removes allowlist agents without duplicates', () => {
    const base = settingsToForm({ enabled: true, content: 'none', exportUserIds: false, destination: 'deployment' })
    const added = addAllowlistAgent(addAllowlistAgent(base, 'b.agent'), 'a.agent')
    expect(added.agentAllowlist).toEqual(['a.agent', 'b.agent'])
    expect(addAllowlistAgent(added, 'a.agent')).toBe(added)
    expect(addAllowlistAgent(added, '  ')).toBe(added)
    expect(removeAllowlistAgent(added, 'a.agent').agentAllowlist).toEqual(['b.agent'])
  })

  it('stops adding agents at the allowlist cap', () => {
    const full = settingsToForm({
      enabled: true,
      content: 'none',
      exportUserIds: false,
      destination: 'deployment',
      agentAllowlist: Array.from({ length: OTEL_EXPORT_AGENT_ALLOWLIST_MAX }, (_, index) => `agent.${index}`),
    })
    expect(canAddAllowlistAgent(full)).toBe(false)
    expect(addAllowlistAgent(full, 'agent.extra')).toBe(full)
  })

  it('signs the form independently of allowlist order', () => {
    const left = settingsToForm({ enabled: true, content: 'none', exportUserIds: false, agentAllowlist: ['a', 'b'], destination: 'deployment' })
    const right = { ...left, agentAllowlist: ['b', 'a'] }
    expect(formSignature(left)).toBe(formSignature(right))
    expect(formSignature(left)).not.toBe(formSignature({ ...left, enabled: false }))
  })

  it('parses the test-span response', () => {
    expect(parseOtelExportTestResponse({ ok: true, httpStatus: 200, latencyMs: 12, errorCode: null })).toEqual({
      ok: true,
      httpStatus: 200,
      latencyMs: 12,
      errorCode: null,
    })
    expect(parseOtelExportTestResponse({ ok: 'yes' })).toBeNull()
  })

  it('enables the content mode only when every lock the editor controls is open', () => {
    const cases: Array<[boolean, boolean, boolean, boolean]> = [
      [true, true, true, true],
      [false, true, true, false],
      [true, false, true, false],
      [true, true, false, false],
      [false, false, false, false],
    ]
    for (const [canManage, canViewContent, contentAllowed, expected] of cases) {
      expect(canEditContentMode({ canManage, canViewContent, contentAllowed })).toBe(expected)
    }
  })

  it('classifies content save errors by status only for content exports', () => {
    expect(classifyOtelExportSaveError({ status: 403 }, 'full')).toBe('contentForbidden')
    expect(classifyOtelExportSaveError({ status: 422 }, 'full')).toBe('contentNotAllowed')
    expect(classifyOtelExportSaveError({ status: 500 }, 'full')).toBe('generic')
    expect(classifyOtelExportSaveError(new Error('boom'), 'full')).toBe('generic')
    expect(classifyOtelExportSaveError({ status: '422' }, 'full')).toBe('generic')
    expect(classifyOtelExportSaveError({ status: 403 }, 'none')).toBe('generic')
    expect(classifyOtelExportSaveError(null, 'full')).toBe('generic')
  })

  it('classifies a refused integration destination before the content checks', () => {
    const refused = { status: 422, error: OTEL_EXPORT_TENANT_ENDPOINTS_NOT_ALLOWED }
    expect(OTEL_EXPORT_TENANT_ENDPOINTS_NOT_ALLOWED).toBe(OTEL_EXPORT_DESTINATION_SETTING_ERRORS.tenantEndpointsNotAllowed)
    expect(classifyOtelExportSaveError(refused, 'none')).toBe('tenantEndpointsNotAllowed')
    expect(classifyOtelExportSaveError(refused, 'full')).toBe('tenantEndpointsNotAllowed')
    expect(classifyOtelExportSaveError({ status: 400, error: OTEL_EXPORT_TENANT_ENDPOINTS_NOT_ALLOWED }, 'none')).toBe('generic')
    expect(classifyOtelExportSaveError({ status: 422, error: 'content_export_not_allowed' }, 'full')).toBe('contentNotAllowed')
  })

  it('lets only managers pick the destination, and only while tenant endpoints are allowed', () => {
    const cases: Array<[boolean, boolean, 'deployment' | 'integration', boolean]> = [
      [true, true, 'deployment', true],
      [true, true, 'integration', true],
      [true, false, 'deployment', false],
      [true, false, 'integration', true],
      [false, true, 'deployment', false],
      [false, false, 'integration', false],
    ]
    for (const [canManage, tenantEndpointsAllowed, destination, expected] of cases) {
      expect(canEditDestination({ canManage, tenantEndpointsAllowed, destination })).toBe(expected)
    }
  })

  it('recognizes exactly the destination error codes', () => {
    for (const code of Object.values(OTEL_EXPORT_DESTINATION_ERRORS)) {
      expect(isOtelExportDestinationErrorCode(code)).toBe(true)
    }
    expect(isOtelExportDestinationErrorCode('http_401')).toBe(false)
    expect(isOtelExportDestinationErrorCode(null)).toBe(false)
  })

  it('parses the integration status and defaults it when absent', () => {
    expect(parseOtelExportSettingsResponse(RESPONSE)?.integration).toEqual({ configured: false, enabled: false })
    expect(
      parseOtelExportSettingsResponse({ ...RESPONSE, integration: { configured: true, enabled: true } })?.integration,
    ).toEqual({ configured: true, enabled: true })
    expect(parseOtelExportSettingsResponse({ ...RESPONSE, integration: { configured: 'yes' } })).toBeNull()
  })

  it('links to the export integration detail page', () => {
    expect(OTEL_EXPORT_INTEGRATION_HREF).toBe('/backend/integrations/agent_orchestrator_otel_export')
  })
})
