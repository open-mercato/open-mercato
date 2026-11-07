/** @jest-environment node */
// Regression: timing-based account enumeration via the login password check (issue #2242).
// verifyPassword MUST run a bcrypt comparison on every path — including the
// missing-user and no-password-hash cases — so a failed login spends the same
// CPU time regardless of whether the account exists.
import { setPasswordHasher } from '@open-mercato/shared/lib/auth/passwordHasher'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'

const mockCompare = jest.fn()

jest.mock('bcryptjs', () => ({
  compare: (...args: unknown[]) => mockCompare(...args),
  hash: jest.fn(async () => 'hashed'),
}))

describe('AuthService.verifyPassword timing-safe (issue #2242)', () => {
  const REAL_HASH = '$2b$10$abcdefghijklmnopqrstuuJ8m5c2wY2q4Q3f1y0a0b0c0d0e0f0g0'

  beforeEach(() => {
    mockCompare.mockReset()
    setPasswordHasher(null)
  })

  it('runs a bcrypt comparison against a fixed dummy hash when the user is null', async () => {
    mockCompare.mockResolvedValue(false)
    const svc = new AuthService({} as any)
    const ok = await svc.verifyPassword(null, 'secret')
    expect(ok).toBe(false)
    expect(mockCompare).toHaveBeenCalledTimes(1)
    expect(mockCompare.mock.calls[0][0]).toBe('secret')
    expect(mockCompare.mock.calls[0][1]).toMatch(/^\$2[aby]\$/)
  })

  it('runs a bcrypt comparison even when the user has no password hash', async () => {
    mockCompare.mockResolvedValue(false)
    const svc = new AuthService({} as any)
    const ok = await svc.verifyPassword({ passwordHash: null } as any, 'secret')
    expect(ok).toBe(false)
    expect(mockCompare).toHaveBeenCalledTimes(1)
  })

  it('never authenticates a user without a hash even if the dummy comparison resolves true', async () => {
    mockCompare.mockResolvedValue(true)
    const svc = new AuthService({} as any)
    await expect(svc.verifyPassword(null, 'secret')).resolves.toBe(false)
    await expect(svc.verifyPassword({ passwordHash: null } as any, 'secret')).resolves.toBe(false)
  })

  it('spends the same single bcrypt comparison when the real hash does not match', async () => {
    mockCompare.mockResolvedValue(false)
    const svc = new AuthService({} as any)
    await expect(svc.verifyPassword({ passwordHash: REAL_HASH } as any, 'secret')).resolves.toBe(false)
    expect(mockCompare).toHaveBeenCalledTimes(1)
  })

  it('compares against the real hash and returns true on a match', async () => {
    mockCompare.mockResolvedValue(true)
    const svc = new AuthService({} as any)
    const ok = await svc.verifyPassword({ passwordHash: REAL_HASH } as any, 'secret')
    expect(ok).toBe(true)
    expect(mockCompare).toHaveBeenCalledWith('secret', REAL_HASH)
    expect(mockCompare).toHaveBeenCalledTimes(1)
  })
})
