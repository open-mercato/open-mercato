import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { requireMfaEnrollmentSudo } from '../mfa-sudo'
import { requireSudo, SudoRequiredError } from '../sudo-middleware'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('../sudo-middleware', () => ({
  ...jest.requireActual('../sudo-middleware'),
  requireSudo: jest.fn(),
}))

const request = new Request('https://example.test/api/security/mfa/provider/totp')
const checkUserCompliance = jest.fn()

describe('MFA enrollment sudo exemption', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1' } as never)
    jest.mocked(createRequestContainer).mockResolvedValue({ resolve: () => ({ checkUserCompliance }) } as never)
    checkUserCompliance.mockResolvedValue({ enforced: false, compliant: true })
    jest.mocked(requireSudo).mockRejectedValue(new SudoRequiredError('security.mfa.self.manage'))
  })

  test('requires sudo for voluntary first enrollment', async () => {
    await expect(requireMfaEnrollmentSudo(request, 'user-1', false)).rejects.toBeInstanceOf(SudoRequiredError)
  })

  test('exempts compelled first enrollment', async () => {
    checkUserCompliance.mockResolvedValue({ enforced: true, compliant: false })
    await expect(requireMfaEnrollmentSudo(request, 'user-1', false)).resolves.toBeUndefined()
    expect(requireSudo).not.toHaveBeenCalled()
  })

  test('requires sudo for existing factors even when policy is unsatisfied', async () => {
    checkUserCompliance.mockResolvedValue({ enforced: true, compliant: false })
    await expect(requireMfaEnrollmentSudo(request, 'user-1', true)).rejects.toBeInstanceOf(SudoRequiredError)
    expect(checkUserCompliance).not.toHaveBeenCalled()
  })

  test('allows a valid sudo token through the existing middleware', async () => {
    jest.mocked(requireSudo).mockResolvedValue(undefined)
    await expect(requireMfaEnrollmentSudo(request, 'user-1', true)).resolves.toBeUndefined()
    expect(requireSudo).toHaveBeenCalledWith(request, 'security.mfa.self.manage')
  })

  test('does not exempt another user or an unavailable policy', async () => {
    await expect(requireMfaEnrollmentSudo(request, 'other-user', false)).rejects.toBeInstanceOf(SudoRequiredError)
    checkUserCompliance.mockRejectedValue(new Error('[internal] unavailable'))
    await expect(requireMfaEnrollmentSudo(request, 'user-1', false)).rejects.toThrow('unavailable')
    expect(requireSudo).not.toHaveBeenCalled()
  })
})
