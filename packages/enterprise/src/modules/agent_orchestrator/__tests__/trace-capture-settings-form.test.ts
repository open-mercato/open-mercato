import {
  INHERIT_EVAL_LEVEL,
  exceedsCeiling,
  formExceedsCeiling,
  formRequestsFullCapture,
  formSignature,
  formToPolicy,
  isOverrideExpired,
  parseAgentOptions,
  parseTraceCaptureSettingsResponse,
  policyToForm,
  withMissingAgentOptions,
  type TraceCaptureSettingsForm,
} from '../lib/trace/captureSettingsForm'
import { DEFAULT_TRACE_CAPTURE_POLICY } from '../lib/trace/capturePolicy'
import type { TraceCapturePolicy } from '../data/validators'

const POLICY: TraceCapturePolicy = {
  level: 'metadata',
  evalLevel: 'full',
  perAgent: {
    'support.triage': { level: 'off' },
    'claims.assess': { level: 'full', until: '2026-12-01T10:00:00.000Z' },
  },
  retentionDays: 14,
  redactPii: true,
  includeProviderBody: false,
}

function baseForm(): TraceCaptureSettingsForm {
  return policyToForm(DEFAULT_TRACE_CAPTURE_POLICY)
}

describe('trace capture settings form mapping', () => {
  it('round-trips a policy through the form unchanged', () => {
    const form = policyToForm(POLICY)
    expect(form.overrides.map((row) => row.agentId)).toEqual(['claims.assess', 'support.triage'])
    expect(form.retentionDays).toBe('14')
    const result = formToPolicy(form)
    expect(result).toEqual({ ok: true, policy: POLICY })
  })

  it('maps an absent eval level to inherit and back to absent', () => {
    const form = baseForm()
    expect(form.evalLevel).toBe(INHERIT_EVAL_LEVEL)
    const result = formToPolicy(form)
    expect(result.ok).toBe(true)
    if (result.ok) expect('evalLevel' in result.policy).toBe(false)
  })

  it('rejects retention outside 1..3650 or not a whole number', () => {
    for (const retentionDays of ['0', '3651', '1.5', 'abc', '']) {
      const result = formToPolicy({ ...baseForm(), retentionDays })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.retentionDays).toBe('retentionInvalid')
    }
  })

  it('flags overrides without an agent and duplicate agents per row', () => {
    const form: TraceCaptureSettingsForm = {
      ...baseForm(),
      overrides: [
        { key: 'first', agentId: 'claims.assess', level: 'full', until: null },
        { key: 'second', agentId: ' claims.assess ', level: 'off', until: null },
        { key: 'third', agentId: '', level: 'off', until: null },
      ],
    }
    const result = formToPolicy(form)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.overrides).toEqual({ second: 'agentDuplicate', third: 'agentRequired' })
  })

  it('writes until as an ISO datetime and omits it when cleared', () => {
    const until = new Date('2027-01-02T03:04:05.000Z')
    const form: TraceCaptureSettingsForm = {
      ...baseForm(),
      overrides: [
        { key: 'first', agentId: 'claims.assess', level: 'full', until },
        { key: 'second', agentId: 'support.triage', level: 'off', until: null },
      ],
    }
    const result = formToPolicy(form)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.policy.perAgent).toEqual({
        'claims.assess': { level: 'full', until: '2027-01-02T03:04:05.000Z' },
        'support.triage': { level: 'off' },
      })
    }
  })

  it('changes the signature only when an edit changes the saved policy', () => {
    const form = policyToForm(POLICY)
    expect(formSignature({ ...form, retentionDays: ' 14 ' })).toBe(formSignature(form))
    expect(formSignature({ ...form, redactPii: false })).not.toBe(formSignature(form))
  })

  it('detects full capture requests and levels above the ceiling', () => {
    const form = baseForm()
    expect(formRequestsFullCapture(form)).toBe(false)
    expect(formRequestsFullCapture({ ...form, evalLevel: 'full' })).toBe(true)
    expect(exceedsCeiling('full', 'metadata')).toBe(true)
    expect(exceedsCeiling('metadata', 'metadata')).toBe(false)
    expect(formExceedsCeiling(policyToForm(POLICY), 'metadata')).toBe(true)
    expect(formExceedsCeiling(form, 'metadata')).toBe(false)
  })

  it('reports expired overrides', () => {
    const now = new Date('2026-10-27T12:00:00.000Z')
    const row = { key: 'row', agentId: 'a', level: 'full' as const, until: new Date('2026-10-27T11:00:00.000Z') }
    expect(isOverrideExpired(row, now)).toBe(true)
    expect(isOverrideExpired({ ...row, until: null }, now)).toBe(false)
  })
})

describe('trace capture settings response parsing', () => {
  it('accepts the GET shape and normalizes a missing updatedAt to null', () => {
    const parsed = parseTraceCaptureSettingsResponse({
      policy: POLICY,
      source: 'tenant',
      deploymentDefault: 'metadata',
      deploymentCeiling: 'full',
    })
    expect(parsed).toEqual({
      policy: POLICY,
      source: 'tenant',
      deploymentDefault: 'metadata',
      deploymentCeiling: 'full',
      updatedAt: null,
    })
  })

  it('rejects malformed responses', () => {
    expect(parseTraceCaptureSettingsResponse(null)).toBeNull()
    expect(parseTraceCaptureSettingsResponse({ policy: POLICY, source: 'x' })).toBeNull()
  })

  it('builds sorted agent options and keeps unknown override ids selectable', () => {
    const options = parseAgentOptions({
      items: [
        { id: 'support.triage', label: 'Support triage' },
        { id: 'claims.assess', label: 'Assess claims' },
        { id: 'unlabelled', label: ' ' },
      ],
    })
    expect(options.map((option) => option.label)).toEqual(['Assess claims', 'Support triage', 'unlabelled'])
    expect(parseAgentOptions({ nope: true })).toEqual([])
    expect(withMissingAgentOptions(options, ['retired.agent', '', 'claims.assess']).map((option) => option.id)).toEqual([
      'claims.assess',
      'support.triage',
      'unlabelled',
      'retired.agent',
    ])
  })
})
