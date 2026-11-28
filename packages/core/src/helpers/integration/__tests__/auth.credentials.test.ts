/** @jest-environment node */
import { readFileSync } from 'fs'
import type { APIRequestContext } from '@playwright/test'

jest.mock('fs', () => ({ readFileSync: jest.fn() }))
jest.mock('@playwright/test', () => ({ request: {} }))

let mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>
const originalEnv = process.env
const credentialKeys = [
  'OM_INIT_SUPERADMIN_EMAIL', 'OM_INIT_SUPERADMIN_PASSWORD',
  'OM_INIT_ADMIN_EMAIL', 'OM_INIT_ADMIN_PASSWORD',
  'OM_INIT_EMPLOYEE_EMAIL', 'OM_INIT_EMPLOYEE_PASSWORD',
] as const

function loadAuth() {
  return require('../auth') as typeof import('../auth')
}

beforeEach(() => {
  jest.resetModules()
  mockReadFileSync = (require('fs') as typeof import('fs')).readFileSync as jest.MockedFunction<typeof readFileSync>
  process.env = { ...originalEnv }
  credentialKeys.forEach((key) => { delete process.env[key] })
  mockReadFileSync.mockReset()
  mockReadFileSync.mockReturnValue('')
})

afterEach(() => {
  process.env = originalEnv
})

describe('native role credentials', () => {
  it('preserves seeded defaults when no configuration exists', () => {
    expect(loadAuth().DEFAULT_CREDENTIALS).toEqual({
      superadmin: { email: 'superadmin@acme.com', password: 'secret' },
      admin: { email: 'admin@acme.com', password: 'secret' },
      employee: { email: 'employee@acme.com', password: 'secret' },
    })
  })

  it('uses configured admin and employee actors', () => {
    process.env.OM_INIT_ADMIN_EMAIL = 'configured-admin@example.test'
    process.env.OM_INIT_ADMIN_PASSWORD = 'synthetic-admin-password'
    process.env.OM_INIT_EMPLOYEE_EMAIL = 'configured-employee@example.test'
    process.env.OM_INIT_EMPLOYEE_PASSWORD = 'synthetic-employee-password'
    expect(loadAuth().DEFAULT_CREDENTIALS).toMatchObject({
      admin: { email: 'configured-admin@example.test', password: 'synthetic-admin-password' },
      employee: { email: 'configured-employee@example.test', password: 'synthetic-employee-password' },
    })
  })

  it('uses the existing env-file fallback for role configuration', () => {
    mockReadFileSync.mockReturnValue([
      'OM_INIT_ADMIN_EMAIL=file-admin@example.test',
      'OM_INIT_ADMIN_PASSWORD=synthetic-file-admin',
      'OM_INIT_EMPLOYEE_EMAIL=file-employee@example.test',
      'OM_INIT_EMPLOYEE_PASSWORD=synthetic-file-employee',
    ].join(String.fromCharCode(10)))
    expect(loadAuth().DEFAULT_CREDENTIALS).toMatchObject({
      admin: { email: 'file-admin@example.test', password: 'synthetic-file-admin' },
      employee: { email: 'file-employee@example.test', password: 'synthetic-file-employee' },
    })
  })

  it('gives process configuration precedence over env-file configuration', () => {
    process.env.OM_INIT_ADMIN_EMAIL = 'process-admin@example.test'
    mockReadFileSync.mockReturnValue('OM_INIT_ADMIN_EMAIL=file-admin@example.test')
    expect(loadAuth().DEFAULT_CREDENTIALS.admin.email).toBe('process-admin@example.test')
  })

  it('resolves fields independently and keeps defaults for empty values', () => {
    process.env.OM_INIT_ADMIN_EMAIL = 'partial-admin@example.test'
    process.env.OM_INIT_ADMIN_PASSWORD = ''
    process.env.OM_INIT_EMPLOYEE_PASSWORD = 'synthetic-partial-employee'
    expect(loadAuth().DEFAULT_CREDENTIALS).toMatchObject({
      admin: { email: 'partial-admin@example.test', password: 'secret' },
      employee: { email: 'employee@acme.com', password: 'synthetic-partial-employee' },
    })
  })

  it('preserves configured superadmin resolution', () => {
    process.env.OM_INIT_SUPERADMIN_EMAIL = 'configured-superadmin@example.test'
    process.env.OM_INIT_SUPERADMIN_PASSWORD = 'synthetic-superadmin-password'
    expect(loadAuth().DEFAULT_CREDENTIALS.superadmin).toEqual({
      email: 'configured-superadmin@example.test', password: 'synthetic-superadmin-password',
    })
  })

  it.each(['admin', 'employee'] as const)('sends configured %s credentials to the native login endpoint', async (role) => {
    process.env['OM_INIT_' + role.toUpperCase() + '_EMAIL'] = role + '@configured.example.test'
    process.env['OM_INIT_' + role.toUpperCase() + '_PASSWORD'] = 'synthetic-configured-password'
    const { getAuthToken } = require('../api') as typeof import('../api')
    const post = jest.fn().mockResolvedValue({
      ok: () => true, status: () => 200, text: async () => JSON.stringify({ token: 'synthetic-token' }),
    })
    await expect(getAuthToken({ post } as unknown as APIRequestContext, role)).resolves.toBe('synthetic-token')
    const [requestUrl, options] = post.mock.calls[0] as [string, { data: string }]
    expect(requestUrl).toMatch(/\/api\/auth\/login$/)
    const form = new URLSearchParams(options.data)
    expect(form.get('email')).toBe(role + '@configured.example.test')
    expect(form.get('password')).toBe('synthetic-configured-password')
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('preserves an explicit API login password override', async () => {
    process.env.OM_INIT_ADMIN_PASSWORD = 'synthetic-configured-password'
    const { getAuthToken } = require('../api') as typeof import('../api')
    const post = jest.fn().mockResolvedValue({
      ok: () => true, status: () => 200, text: async () => JSON.stringify({ token: 'synthetic-token' }),
    })
    await getAuthToken({ post } as unknown as APIRequestContext, 'admin', 'synthetic-explicit-password')
    const options = post.mock.calls[0][1] as { data: string }
    expect(new URLSearchParams(options.data).get('password')).toBe('synthetic-explicit-password')
  })
})
