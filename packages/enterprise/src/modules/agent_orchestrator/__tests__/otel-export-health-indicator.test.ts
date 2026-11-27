import {
  deriveOtelExportIndicator,
  isOtelExportHealthPayload,
  rollupHealth,
  type OtelExportHealthPayload,
} from '../lib/systemHealth'

function payload(
  overrides: Partial<OtelExportHealthPayload['deployment']> = {},
  health: Partial<OtelExportHealthPayload['health']> = {},
): OtelExportHealthPayload {
  return {
    deployment: { enabled: true, switchOn: true, ...overrides },
    health: { lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null, ...health },
  }
}

describe('deriveOtelExportIndicator', () => {
  it('is hidden without a payload or while the deployment switch is off', () => {
    expect(deriveOtelExportIndicator(null)).toBeNull()
    expect(deriveOtelExportIndicator(payload({ switchOn: false, enabled: false }))).toBeNull()
  })

  it('is down when switched on without a usable endpoint or protocol', () => {
    expect(deriveOtelExportIndicator(payload({ enabled: false }))).toEqual({ id: 'otelExport', state: 'down', detail: null })
  })

  it('is unknown when the tenant never exported', () => {
    expect(deriveOtelExportIndicator(payload())?.state).toBe('unknown')
  })

  it.each([
    ['success only', '2026-10-27T10:00:00.000Z', null, 'ok'],
    ['success newer than error', '2026-10-27T11:00:00.000Z', '2026-10-27T10:00:00.000Z', 'ok'],
    ['error newer than success', '2026-10-27T10:00:00.000Z', '2026-10-27T11:00:00.000Z', 'degraded'],
    ['error only', null, '2026-10-27T10:00:00.000Z', 'degraded'],
    ['unparseable success with an error', 'not-a-date', '2026-10-27T10:00:00.000Z', 'degraded'],
  ] as const)('%s → %s', (_label, lastSuccessAt, lastErrorAt, expected) => {
    const indicator = deriveOtelExportIndicator(
      payload({}, { lastSuccessAt, lastErrorAt, lastErrorCode: lastErrorAt ? 'http_503' : null }),
    )
    expect(indicator?.state).toBe(expected)
    expect(indicator?.detail).toBe(expected === 'degraded' ? 'http_503' : null)
  })

  it('feeds the worst-of rollup', () => {
    const indicator = deriveOtelExportIndicator(payload({}, { lastErrorAt: '2026-10-27T10:00:00.000Z' }))
    expect(rollupHealth([{ id: 'mcp', state: 'ok', detail: null }, indicator!])).toBe('degraded')
  })
})

describe('isOtelExportHealthPayload', () => {
  it('accepts the settings GET shape and rejects others', () => {
    expect(isOtelExportHealthPayload({ settings: {}, ...payload() })).toBe(true)
    expect(isOtelExportHealthPayload({ deployment: { enabled: true }, health: {} })).toBe(false)
    expect(isOtelExportHealthPayload(null)).toBe(false)
    expect(isOtelExportHealthPayload({ error: 'Forbidden' })).toBe(false)
  })
})
