import { readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveInitDerivedSecrets, resolveInitSuperadminCredentials } from '../init-secrets'

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


describe('production bootstrap superadmin credentials', () => {
  const production = { NODE_ENV: 'production' }

  it.each([undefined, '', '   ', 'secret', 'password', ' PASSWORD ', 'changeme', 'change-me', 'replace_me'])(
    'rejects an absent or placeholder production password: %s', (password) => {
      expect(() => resolveInitSuperadminCredentials([], {
        ...production, OM_INIT_SUPERADMIN_PASSWORD: password,
      })).toThrow('requires a unique superadmin password')
    },
  )

  it.each(['--skip-password-policy', '--skip-password-policy=true', '--allow-weak-password', '--allow-weak-password=true'])(
    'enforces production policy despite %s', (flag) => {
      expect(() => resolveInitSuperadminCredentials([flag, '--password=weak'], production))
        .toThrow('does not meet the configured password policy')
      expect(resolveInitSuperadminCredentials([flag, '--password=Unique-Owner-937!'], production).skipPasswordPolicy).toBe(false)
    },
  )

  it('uses the configured policy and never includes the password in errors', () => {
    const password = 'Unique-Owner-937!'
    expect(() => resolveInitSuperadminCredentials([`--password=${password}`], {
      ...production, OM_PASSWORD_MIN_LENGTH: '40',
    })).toThrow('does not meet the configured password policy')
    try {
      resolveInitSuperadminCredentials([`--password=${password}`], { ...production, OM_PASSWORD_MIN_LENGTH: '40' })
    } catch (error) {
      expect(String(error)).not.toContain(password)
    }
  })

  it('rejects placeholders even with a relaxed policy', () => {
    expect(() => resolveInitSuperadminCredentials([], {
      ...production, OM_INIT_SUPERADMIN_PASSWORD: 'password', OM_PASSWORD_REQUIRE_DIGIT: 'false',
      OM_PASSWORD_REQUIRE_UPPERCASE: 'false', OM_PASSWORD_REQUIRE_SPECIAL: 'false',
    })).toThrow('requires a unique superadmin password')
  })

  it('prefers command arguments over environment overrides', () => {
    expect(resolveInitSuperadminCredentials(['--email=owner@example.test', '--password=Unique-Owner-937!'], {
      NODE_ENV: ' Production ', OM_INIT_SUPERADMIN_PASSWORD: 'password', OM_INIT_SUPERADMIN_EMAIL: 'other@example.test',
    })).toEqual({ email: 'owner@example.test', password: 'Unique-Owner-937!', skipPasswordPolicy: false })
  })

  it('uses the CLI locale for operator-facing production diagnostics', () => {
    expect(() => resolveInitSuperadminCredentials([], { ...production, LC_ALL: 'pl_PL.UTF-8' }))
      .toThrow('Inicjalizacja produkcyjna wymaga')
    expect(() => resolveInitSuperadminCredentials([], { ...production, LC_ALL: 'unknown' }))
      .toThrow('Production initialization requires')
  })

  it('accepts a policy-compliant environment password', () => {
    expect(resolveInitSuperadminCredentials([], {
      ...production, OM_INIT_SUPERADMIN_PASSWORD: 'Unique-Owner-937!',
    }).password).toBe('Unique-Owner-937!')
  })

  it.each([undefined, 'development', 'test', 'staging'])('preserves non-production defaults for %s', (nodeEnv) => {
    expect(resolveInitSuperadminCredentials([], { NODE_ENV: nodeEnv })).toEqual({
      email: 'superadmin@acme.com', password: 'secret', skipPasswordPolicy: true,
    })
    expect(resolveInitSuperadminCredentials([], { NODE_ENV: nodeEnv, OM_INIT_SUPERADMIN_PASSWORD: 'password' }).password).toBe('password')
    expect(resolveInitSuperadminCredentials(['--skip-password-policy=false'], { NODE_ENV: nodeEnv }).skipPasswordPolicy).toBe(false)
  })
})

describe('full-app Compose bootstrap defaults', () => {
  it.each(['starters/docker/compose.fullapp.yml', 'packages/create-app/template/docker-compose.fullapp.yml'])(
    '%s cannot bootstrap predictable production credentials', (composePath) => {
      const compose = readFileSync(path.resolve(__dirname, '../../../../..', composePath), 'utf8')
      const fallback = compose.match(/OM_INIT_SUPERADMIN_PASSWORD: \$\{OM_INIT_SUPERADMIN_PASSWORD:-(.*?)\}/)?.[1]
      expect(fallback).toBeDefined()
      expect(() => resolveInitSuperadminCredentials([], {
        NODE_ENV: 'production', OM_INIT_SUPERADMIN_PASSWORD: fallback,
      })).toThrow('requires a unique superadmin password')
      expect(resolveInitSuperadminCredentials([], {
        NODE_ENV: 'development', OM_INIT_SUPERADMIN_PASSWORD: fallback,
      }).password).toBe(fallback)
    },
  )
})
