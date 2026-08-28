import {
  isHardenedAiRuntimeProfile,
  resolveAiRuntimeSecurityProfile,
} from '@open-mercato/shared/lib/ai/runtime-security-profile'

describe('AI runtime security profile', () => {
  it('keeps the compatibility default', () => {
    expect(resolveAiRuntimeSecurityProfile({})).toBe('standard')
    expect(isHardenedAiRuntimeProfile({})).toBe(false)
  })

  it('enables hardened enforcement explicitly', () => {
    const env = { OM_AI_RUNTIME_SECURITY_PROFILE: ' HARDENED ' }
    expect(resolveAiRuntimeSecurityProfile(env)).toBe('hardened')
    expect(isHardenedAiRuntimeProfile(env)).toBe(true)
  })

  it('treats unknown values as standard', () => {
    expect(resolveAiRuntimeSecurityProfile({ OM_AI_RUNTIME_SECURITY_PROFILE: 'strict' })).toBe(
      'standard',
    )
  })
})
