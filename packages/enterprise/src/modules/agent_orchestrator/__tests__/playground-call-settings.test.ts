import {
  EMPTY_PLAYGROUND_CALL_SETTINGS,
  buildPlaygroundCallSettings,
  hasPlaygroundCallSettings,
} from '../components/playgroundCallSettings'
import { runErrorStateFromBody } from '../components/playgroundRunError'

describe('buildPlaygroundCallSettings', () => {
  it('returns null when every field is blank, so the agent defaults apply', () => {
    expect(buildPlaygroundCallSettings(EMPTY_PLAYGROUND_CALL_SETTINGS)).toEqual({ ok: true, callSettings: null })
    expect(hasPlaygroundCallSettings(EMPTY_PLAYGROUND_CALL_SETTINGS)).toBe(false)
  })

  it('sends only the fields the operator filled in', () => {
    const draft = { ...EMPTY_PLAYGROUND_CALL_SETTINGS, temperature: ' 0.2 ', seed: '42' }
    expect(buildPlaygroundCallSettings(draft)).toEqual({ ok: true, callSettings: { temperature: 0.2, seed: 42 } })
    expect(hasPlaygroundCallSettings(draft)).toBe(true)
  })

  it('names the field that is not a number', () => {
    expect(buildPlaygroundCallSettings({ ...EMPTY_PLAYGROUND_CALL_SETTINGS, topP: 'abc' })).toEqual({ ok: false, field: 'topP' })
  })

  it('rejects a fractional value on an integer field', () => {
    expect(buildPlaygroundCallSettings({ ...EMPTY_PLAYGROUND_CALL_SETTINGS, maxOutputTokens: '10.5' })).toEqual({
      ok: false,
      field: 'maxOutputTokens',
    })
  })
})

describe('buildPlaygroundCallSettings — server ranges', () => {
  it.each([
    ['temperature', '5'],
    ['topP', '1.5'],
    ['maxOutputTokens', '40000'],
    ['maxOutputTokens', '0'],
  ] as const)('names %s when %s is outside the route limits', (field, value) => {
    expect(buildPlaygroundCallSettings({ ...EMPTY_PLAYGROUND_CALL_SETTINGS, [field]: value })).toEqual({ ok: false, field })
  })
})

describe('runErrorStateFromBody — call_settings_unsupported', () => {
  it('maps the code to its locale key instead of the English route text', () => {
    expect(
      runErrorStateFromBody({ error: 'This agent does not accept per-call model settings', code: 'call_settings_unsupported' }),
    ).toEqual({ kind: 'generic', messageKey: 'agent_orchestrator.errors.call_settings_unsupported', message: null })
  })
})
