import { resolveInitDerivedSecrets } from '../init-secrets'

describe('resolveInitDerivedSecrets', () => {
  it("seeds the well-known 'secret' password in non-production when no env overrides are set", () => {
    const env: NodeJS.ProcessEnv = {}
    const result = resolveInitDerivedSecrets({ email: 'piotr@gmail.com', env })
    expect(result.adminEmail).toBe('admin@gmail.com')
    expect(result.employeeEmail).toBe('employee@gmail.com')
    // Dev/test default: the documented demo password, so `yarn dev` /
    // `mercato init` workflows stay predictable across runs.
    expect(result.adminPassword).toBe('secret')
    expect(result.employeePassword).toBe('secret')
  })

  it('generates random derived passwords in production when no env overrides are set', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' }
    const result = resolveInitDerivedSecrets({ email: 'piotr@gmail.com', env })
    expect(result.adminEmail).toBe('admin@gmail.com')
    expect(result.employeeEmail).toBe('employee@gmail.com')
    // Production must never seed the hardcoded default — that was the bug.
    expect(result.adminPassword).not.toBe('secret')
    expect(result.employeePassword).not.toBe('secret')
    expect(typeof result.adminPassword).toBe('string')
    expect(typeof result.employeePassword).toBe('string')
    expect(result.adminPassword!.length).toBeGreaterThanOrEqual(16)
    expect(result.employeePassword!.length).toBeGreaterThanOrEqual(16)
    // 96 bits of entropy: two independently generated secrets must not collide.
    expect(result.adminPassword).not.toBe(result.employeePassword)
  })

  it('respects explicit derived overrides', () => {
    const env: NodeJS.ProcessEnv = {
      OM_INIT_ADMIN_EMAIL: 'admin@acme.com',
      OM_INIT_EMPLOYEE_EMAIL: 'staff@acme.com',
      OM_INIT_ADMIN_PASSWORD: 'AdminSecret',
      OM_INIT_EMPLOYEE_PASSWORD: 'EmployeeSecret',
    }
    const result = resolveInitDerivedSecrets({ email: 'owner@company.test', env })
    expect(result.adminEmail).toBe('admin@acme.com')
    expect(result.employeeEmail).toBe('staff@acme.com')
    expect(result.adminPassword).toBe('AdminSecret')
    expect(result.employeePassword).toBe('EmployeeSecret')
  })

  it('uses the provided randomSource (base64url-encoded 12 bytes) in production', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' }
    const randomBuffer = Buffer.from('abcdefghijkl')
    const randomSource = () => randomBuffer
    const expected = randomBuffer.toString('base64url')
    const result = resolveInitDerivedSecrets({ email: 'boss@acme.com', env, randomSource })
    expect(result.adminPassword).toBe(expected)
    expect(result.employeePassword).toBe(expected)
  })

  it('ignores the deprecated OM_INIT_GENERATE_RANDOM_PASSWORD toggle in production (randomization is unconditional)', () => {
    // The toggle was a partial mitigation when 'secret' was still the default.
    // Now production randomization is always-on when env vars are unset, so the
    // flag is a no-op — setting it should not change the output shape.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', OM_INIT_GENERATE_RANDOM_PASSWORD: 'true' }
      const result = resolveInitDerivedSecrets({ email: 'boss@acme.com', env })
      expect(result.adminPassword).not.toBe('secret')
      expect(typeof result.adminPassword).toBe('string')
    } finally {
      warn.mockRestore()
    }
  })

  it('skips derived accounts without a domain', () => {
    const env: NodeJS.ProcessEnv = {}
    const result = resolveInitDerivedSecrets({ email: 'local', env })
    expect(result.adminEmail).toBeNull()
    expect(result.employeeEmail).toBeNull()
    expect(result.adminPassword).toBeNull()
    expect(result.employeePassword).toBeNull()
  })
})

