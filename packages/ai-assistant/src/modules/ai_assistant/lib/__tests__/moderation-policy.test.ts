import {
  isModerationActive,
  resolveModerationPolicy,
  shouldFailClosed,
} from '../moderation-policy'

describe('resolveModerationPolicy — 5-step precedence', () => {
  it('1. untrustedInput wins over everything → enforced', () => {
    expect(
      resolveModerationPolicy({
        untrustedInput: true,
        perAgentOverride: false,
        tenantWideOverride: false,
        env: { OM_AI_INPUT_MODERATION: 'false' },
      }),
    ).toBe('enforced')
  })

  it('2. per-agent override wins over tenant-wide + env', () => {
    expect(
      resolveModerationPolicy({
        perAgentOverride: true,
        tenantWideOverride: false,
        env: { OM_AI_INPUT_MODERATION: 'false' },
      }),
    ).toBe('on')
    expect(
      resolveModerationPolicy({
        perAgentOverride: false,
        tenantWideOverride: true,
        env: { OM_AI_INPUT_MODERATION: 'true' },
      }),
    ).toBe('off')
  })

  it('3. tenant-wide override wins over env when per-agent is inherit', () => {
    expect(
      resolveModerationPolicy({
        perAgentOverride: null,
        tenantWideOverride: true,
        env: { OM_AI_INPUT_MODERATION: 'false' },
      }),
    ).toBe('on')
    expect(
      resolveModerationPolicy({
        perAgentOverride: undefined,
        tenantWideOverride: false,
        env: { OM_AI_INPUT_MODERATION: 'true' },
      }),
    ).toBe('off')
  })

  it('4. env default applies when both overrides inherit', () => {
    expect(
      resolveModerationPolicy({ perAgentOverride: null, tenantWideOverride: null, env: { OM_AI_INPUT_MODERATION: 'true' } }),
    ).toBe('on')
    expect(
      resolveModerationPolicy({ env: { OM_AI_INPUT_MODERATION: '1' } }),
    ).toBe('on')
  })

  it('5. defaults to off when nothing is set', () => {
    expect(resolveModerationPolicy({ env: {} })).toBe('off')
    expect(resolveModerationPolicy({ perAgentOverride: null, tenantWideOverride: null, env: {} })).toBe('off')
  })

  it('treats untrustedInput=false the same as unset (falls through)', () => {
    expect(
      resolveModerationPolicy({ untrustedInput: false, tenantWideOverride: true, env: {} }),
    ).toBe('on')
  })
})

describe('moderation policy helpers', () => {
  it('isModerationActive is true for enforced and on, false for off', () => {
    expect(isModerationActive('enforced')).toBe(true)
    expect(isModerationActive('on')).toBe(true)
    expect(isModerationActive('off')).toBe(false)
  })

  it('shouldFailClosed is true only for enforced (opt-in on fails open)', () => {
    expect(shouldFailClosed('enforced')).toBe(true)
    expect(shouldFailClosed('on')).toBe(false)
    expect(shouldFailClosed('off')).toBe(false)
  })
})
