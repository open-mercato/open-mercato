import { requireMfaEnrollmentSudo } from '../mfa-sudo'
import { requireSudo, SudoRequiredError } from '../sudo-middleware'

jest.mock('../sudo-middleware', () => ({
  ...jest.requireActual('../sudo-middleware'),
  requireSudo: jest.fn(),
}))

const request = new Request('https://example.test/api/security/mfa/provider/totp')
const checkUserCompliance = jest.fn()
const context = {
  auth: { sub: 'user-1', tenantId: 'tenant-1' },
  container: { resolve: () => ({ checkUserCompliance }) },
} as never

describe('MFA enrollment sudo exemption', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    checkUserCompliance.mockResolvedValue({ enforced: false, compliant: true })
    jest.mocked(requireSudo).mockRejectedValue(new SudoRequiredError('security.mfa.self.manage'))
  })

  test('requires sudo for voluntary first enrollment', async () => {
    await expect(requireMfaEnrollmentSudo(request, 'user-1', false, context)).rejects.toBeInstanceOf(SudoRequiredError)
  })

  test('exempts compelled first enrollment', async () => {
    checkUserCompliance.mockResolvedValue({ enforced: true, compliant: false })
    await expect(requireMfaEnrollmentSudo(request, 'user-1', false, context)).resolves.toBeUndefined()
    expect(requireSudo).not.toHaveBeenCalled()
  })

  test('requires sudo for existing factors even when policy is unsatisfied', async () => {
    checkUserCompliance.mockResolvedValue({ enforced: true, compliant: false })
    await expect(requireMfaEnrollmentSudo(request, 'user-1', true, context)).rejects.toBeInstanceOf(SudoRequiredError)
    expect(checkUserCompliance).not.toHaveBeenCalled()
  })

  test('allows a valid sudo token through the existing middleware', async () => {
    jest.mocked(requireSudo).mockResolvedValue(undefined)
    await expect(requireMfaEnrollmentSudo(request, 'user-1', true, context)).resolves.toBeUndefined()
    expect(requireSudo).toHaveBeenCalledWith(request, 'security.mfa.self.manage', context)
  })

  test('does not exempt another user or an unavailable policy', async () => {
    await expect(requireMfaEnrollmentSudo(request, 'other-user', false, context)).rejects.toBeInstanceOf(SudoRequiredError)
    checkUserCompliance.mockRejectedValue(new Error('[internal] unavailable'))
    await expect(requireMfaEnrollmentSudo(request, 'user-1', false, context)).rejects.toThrow('unavailable')
    expect(requireSudo).not.toHaveBeenCalled()
  })
})
