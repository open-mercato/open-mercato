/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: () => false,
  isEncryptionDebugEnabled: () => false,
}))

import {
  deactivateDemoUsersIfSelfOnboardingEnabled,
  resolveDemoUserEmails,
} from '@open-mercato/core/modules/auth/lib/setup-app'
import { User } from '@open-mercato/core/modules/auth/data/entities'

jest.setTimeout(30_000)

type DemoUserRow = {
  email: string
  passwordHash: string | null
  isConfirmed: boolean
}

const ENV_KEYS = [
  'SELF_SERVICE_ONBOARDING_ENABLED',
  'OM_INIT_FLOW',
  'OM_INIT_SUPERADMIN_EMAIL',
  'DEMO_MODE',
  'OM_INIT_ADMIN_EMAIL',
  'OM_INIT_EMPLOYEE_EMAIL',
]

function buildEm(initialRows: DemoUserRow[], options: { throwForEmails?: Set<string> } = {}) {
  const throwForEmails = options.throwForEmails ?? new Set<string>()
  const rows = initialRows.map((row) => ({ ...row }))
  const queriedEmails: string[] = []
  const findOne = jest.fn(async (Entity: any, where: any) => {
    if (Entity !== User) return null
    const email = where?.email
    if (typeof email !== 'string') return null
    queriedEmails.push(email)
    if (throwForEmails.has(email)) {
      throw new Error(`SIMULATED_DECRYPTION_FAILURE for ${email}`)
    }
    return rows.find((row) => row.email === email) ?? null
  })
  const flush = jest.fn(async () => undefined)
  const persist = jest.fn(function persist(this: any) {
    return this
  })
  const em: any = { findOne, persist, flush }
  return { em, rows, queriedEmails, findOne, persist, flush }
}

describe('deactivateDemoUsersIfSelfOnboardingEnabled', () => {
  const savedEnv: Record<string, string | undefined> = {}
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    consoleErrorSpy.mockRestore()
  })

  it('A — neutralizes all three demo users (superadmin + admin + employee) when SELF_SERVICE_ONBOARDING_ENABLED=true', async () => {
    process.env.SELF_SERVICE_ONBOARDING_ENABLED = 'true'
    const { em, rows, flush } = buildEm([
      { email: 'superadmin@acme.com', passwordHash: 'hash-super', isConfirmed: true },
      { email: 'admin@acme.com', passwordHash: 'hash-admin', isConfirmed: true },
      { email: 'employee@acme.com', passwordHash: 'hash-emp', isConfirmed: true },
    ])

    await deactivateDemoUsersIfSelfOnboardingEnabled(em)

    for (const row of rows) {
      expect(row.passwordHash).toBeNull()
      expect(row.isConfirmed).toBe(false)
    }
    expect(flush).toHaveBeenCalledTimes(3)
  })

  it('B — honors OM_INIT_ADMIN_EMAIL / OM_INIT_EMPLOYEE_EMAIL overrides instead of acme.com defaults', async () => {
    process.env.SELF_SERVICE_ONBOARDING_ENABLED = 'true'
    process.env.OM_INIT_ADMIN_EMAIL = 'override-admin@example.com'
    process.env.OM_INIT_EMPLOYEE_EMAIL = 'override-employee@example.com'

    const { em, rows, queriedEmails, flush } = buildEm([
      { email: 'superadmin@acme.com', passwordHash: 'hash-super', isConfirmed: true },
      { email: 'override-admin@example.com', passwordHash: 'hash-admin', isConfirmed: true },
      { email: 'override-employee@example.com', passwordHash: 'hash-emp', isConfirmed: true },
    ])

    await deactivateDemoUsersIfSelfOnboardingEnabled(em)

    expect(queriedEmails).toEqual(
      expect.arrayContaining([
        'superadmin@acme.com',
        'override-admin@example.com',
        'override-employee@example.com',
      ]),
    )
    expect(queriedEmails).not.toContain('admin@acme.com')
    expect(queriedEmails).not.toContain('employee@acme.com')
    for (const row of rows) {
      expect(row.passwordHash).toBeNull()
      expect(row.isConfirmed).toBe(false)
    }
    expect(flush).toHaveBeenCalledTimes(3)
  })

  it('C — is a no-op when SELF_SERVICE_ONBOARDING_ENABLED is unset', async () => {
    delete process.env.SELF_SERVICE_ONBOARDING_ENABLED
    const { em, findOne, flush } = buildEm([
      { email: 'superadmin@acme.com', passwordHash: 'hash-super', isConfirmed: true },
    ])

    await deactivateDemoUsersIfSelfOnboardingEnabled(em)

    expect(findOne).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('C — is a no-op when SELF_SERVICE_ONBOARDING_ENABLED=false (non-"true" string)', async () => {
    process.env.SELF_SERVICE_ONBOARDING_ENABLED = 'false'
    const { em, findOne, flush } = buildEm([
      { email: 'superadmin@acme.com', passwordHash: 'hash-super', isConfirmed: true },
    ])

    await deactivateDemoUsersIfSelfOnboardingEnabled(em)

    expect(findOne).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('D — keeps ALL demo users (not just superadmin) when shouldKeepDemoSuperadminDuringInit() fires', async () => {
    process.env.SELF_SERVICE_ONBOARDING_ENABLED = 'true'
    process.env.OM_INIT_FLOW = 'true'
    process.env.OM_INIT_SUPERADMIN_EMAIL = 'customized-super@example.com'
    // DEMO_MODE unset → isDemoModeEnabled() returns true by default

    const { em, findOne, flush } = buildEm([
      { email: 'superadmin@acme.com', passwordHash: 'hash-super', isConfirmed: true },
      { email: 'admin@acme.com', passwordHash: 'hash-admin', isConfirmed: true },
      { email: 'employee@acme.com', passwordHash: 'hash-emp', isConfirmed: true },
    ])

    await deactivateDemoUsersIfSelfOnboardingEnabled(em)

    expect(findOne).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('E — per-user error isolation: superadmin lookup throws but admin + employee still get neutralized', async () => {
    process.env.SELF_SERVICE_ONBOARDING_ENABLED = 'true'

    const { em, rows, flush } = buildEm(
      [
        { email: 'superadmin@acme.com', passwordHash: 'hash-super', isConfirmed: true },
        { email: 'admin@acme.com', passwordHash: 'hash-admin', isConfirmed: true },
        { email: 'employee@acme.com', passwordHash: 'hash-emp', isConfirmed: true },
      ],
      { throwForEmails: new Set(['superadmin@acme.com']) },
    )

    await deactivateDemoUsersIfSelfOnboardingEnabled(em)

    const superadminRow = rows.find((row) => row.email === 'superadmin@acme.com')!
    const adminRow = rows.find((row) => row.email === 'admin@acme.com')!
    const employeeRow = rows.find((row) => row.email === 'employee@acme.com')!

    // Superadmin lookup threw before we touched the row.
    expect(superadminRow.passwordHash).toBe('hash-super')
    expect(superadminRow.isConfirmed).toBe(true)

    // Admin + employee still neutralized.
    expect(adminRow.passwordHash).toBeNull()
    expect(adminRow.isConfirmed).toBe(false)
    expect(employeeRow.passwordHash).toBeNull()
    expect(employeeRow.isConfirmed).toBe(false)
    expect(flush).toHaveBeenCalledTimes(2)

    // Error was logged with the role + email context.
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const [message] = consoleErrorSpy.mock.calls[0]
    expect(String(message)).toContain('superadmin')
    expect(String(message)).toContain('superadmin@acme.com')
  })

  it('skips missing rows (returns null) without touching anything else', async () => {
    process.env.SELF_SERVICE_ONBOARDING_ENABLED = 'true'

    const { em, rows, flush } = buildEm([
      // Only admin exists; superadmin and employee never seeded.
      { email: 'admin@acme.com', passwordHash: 'hash-admin', isConfirmed: true },
    ])

    await deactivateDemoUsersIfSelfOnboardingEnabled(em)

    const adminRow = rows.find((row) => row.email === 'admin@acme.com')!
    expect(adminRow.passwordHash).toBeNull()
    expect(adminRow.isConfirmed).toBe(false)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('is idempotent: already-neutralized users do not re-flush', async () => {
    process.env.SELF_SERVICE_ONBOARDING_ENABLED = 'true'

    const { em, flush } = buildEm([
      { email: 'superadmin@acme.com', passwordHash: null, isConfirmed: false },
      { email: 'admin@acme.com', passwordHash: null, isConfirmed: false },
      { email: 'employee@acme.com', passwordHash: null, isConfirmed: false },
    ])

    await deactivateDemoUsersIfSelfOnboardingEnabled(em)

    // Nothing was dirty → no flush at all.
    expect(flush).not.toHaveBeenCalled()
  })
})

describe('resolveDemoUserEmails', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
  })

  it('returns acme.com defaults when no env overrides are set', () => {
    const result = resolveDemoUserEmails()
    expect(result).toEqual([
      { role: 'superadmin', email: 'superadmin@acme.com' },
      { role: 'admin', email: 'admin@acme.com' },
      { role: 'employee', email: 'employee@acme.com' },
    ])
  })

  it('applies OM_INIT_ADMIN_EMAIL / OM_INIT_EMPLOYEE_EMAIL overrides without affecting the superadmin entry', () => {
    process.env.OM_INIT_ADMIN_EMAIL = 'custom-admin@x.test'
    process.env.OM_INIT_EMPLOYEE_EMAIL = 'custom-employee@x.test'
    const result = resolveDemoUserEmails()
    expect(result).toEqual([
      { role: 'superadmin', email: 'superadmin@acme.com' },
      { role: 'admin', email: 'custom-admin@x.test' },
      { role: 'employee', email: 'custom-employee@x.test' },
    ])
  })

  it('treats whitespace-only env values as unset (matches readEnvValue trim semantics)', () => {
    process.env.OM_INIT_ADMIN_EMAIL = '   '
    process.env.OM_INIT_EMPLOYEE_EMAIL = '\t\n'
    const result = resolveDemoUserEmails()
    expect(result.find((row) => row.role === 'admin')?.email).toBe('admin@acme.com')
    expect(result.find((row) => row.role === 'employee')?.email).toBe('employee@acme.com')
  })
})
