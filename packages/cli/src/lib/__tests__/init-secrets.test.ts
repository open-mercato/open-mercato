import { resolveInitDerivedSecrets } from '../init-secrets'

describe('resolveInitDerivedSecrets', () => {
  it('defaults derived passwords to secret', () => {
    const env: NodeJS.ProcessEnv = {}
    const result = resolveInitDerivedSecrets({ email: 'piotr@gmail.com', env })
    expect(result.adminEmail).toBe('admin@gmail.com')
    expect(result.employeeEmail).toBe('employee@gmail.com')
    expect(result.adminPassword).toBe('secret')
    expect(result.employeePassword).toBe('secret')
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

  it('generates random secrets when enabled', () => {
    const env: NodeJS.ProcessEnv = {
      OM_INIT_GENERATE_RANDOM_PASSWORD: 'true',
    }
    const randomBuffer = Buffer.from('abcdefghi')
    const randomSource = () => randomBuffer
    const expected = randomBuffer.toString('base64url')
    const result = resolveInitDerivedSecrets({ email: 'boss@acme.com', env, randomSource })
    expect(result.adminPassword).toBe(expected)
    expect(result.employeePassword).toBe(expected)
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

