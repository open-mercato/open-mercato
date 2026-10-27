import {
  addAllowlistAgent,
  canAddAllowlistAgent,
  formSignature,
  formToSettings,
  parseOtelExportSettingsResponse,
  parseOtelExportTestResponse,
  removeAllowlistAgent,
  settingsToForm,
} from '../lib/trace/otel/exportSettingsForm'
import { OTEL_EXPORT_AGENT_ALLOWLIST_MAX } from '../data/validators'

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
  })

  it('round-trips settings through the form with a sorted allowlist', () => {
    const form = settingsToForm(parseOtelExportSettingsResponse(RESPONSE)!.settings)
    expect(form.agentAllowlist).toEqual(['claims.assess', 'support.triage'])
    expect(formToSettings(form)).toEqual({
      ok: true,
      settings: { enabled: true, content: 'none', exportUserIds: false, agentAllowlist: ['claims.assess', 'support.triage'] },
    })
  })

  it('sends an empty allowlist as absent (every agent)', () => {
    const form = settingsToForm({ enabled: false, content: 'none', exportUserIds: true })
    expect(form.agentAllowlist).toEqual([])
    const result = formToSettings(form)
    expect(result).toEqual({ ok: true, settings: { enabled: false, content: 'none', exportUserIds: true } })
  })

  it('adds and removes allowlist agents without duplicates', () => {
    const base = settingsToForm({ enabled: true, content: 'none', exportUserIds: false })
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
      agentAllowlist: Array.from({ length: OTEL_EXPORT_AGENT_ALLOWLIST_MAX }, (_, index) => `agent.${index}`),
    })
    expect(canAddAllowlistAgent(full)).toBe(false)
    expect(addAllowlistAgent(full, 'agent.extra')).toBe(full)
  })

  it('signs the form independently of allowlist order', () => {
    const left = settingsToForm({ enabled: true, content: 'none', exportUserIds: false, agentAllowlist: ['a', 'b'] })
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
})
