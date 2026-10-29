import { getPasswordPolicy, validatePassword } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { resolveEphemeralSuperadminPassword } from '../bootstrap-password'

describe('ephemeral bootstrap superadmin credentials', () => {
  it('generates a unique password satisfying the normal policy for each new runtime', () => {
    const firstPassword = resolveEphemeralSuperadminPassword({})
    const secondPassword = resolveEphemeralSuperadminPassword({})

    expect(firstPassword).not.toBe(secondPassword)
    expect(firstPassword.length).toBeGreaterThanOrEqual(64)
    expect(validatePassword(firstPassword, getPasswordPolicy({})).ok).toBe(true)
    expect(validatePassword(secondPassword, getPasswordPolicy({})).ok).toBe(true)
  })

  it.each(['Operator-8sW!k3zR', 'password', ''])('preserves an explicit credential for CLI validation', (password) => {
    expect(resolveEphemeralSuperadminPassword({ OM_INIT_SUPERADMIN_PASSWORD: password })).toBe(password)
  })
})
