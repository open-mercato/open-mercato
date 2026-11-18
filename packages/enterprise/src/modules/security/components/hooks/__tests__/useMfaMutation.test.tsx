/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useSudoChallenge } from '../useSudoChallenge'
import { useMfaMutation } from '../useMfaMutation'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn(), readApiResultOrThrow: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({ raiseCrudError: jest.fn() }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(), retryLastMutation: jest.fn() }),
}))
jest.mock('../useSudoChallenge', () => ({ useSudoChallenge: jest.fn() }))
const requireSudo = jest.fn()

describe('MFA client sudo retry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(useSudoChallenge).mockReturnValue({ requireSudo, isSudoActive: false })
    jest.mocked(raiseCrudError).mockRejectedValue(new Error('[internal] original rejection'))
  })

  test('compelled first enrollment succeeds without opening a sudo challenge', async () => {
    jest.mocked(apiCall).mockResolvedValue({ ok: true, status: 200, result: { ok: true } } as never)
    const { result } = renderHook(() => useMfaMutation())
    await act(async () => { await expect(result.current('/api/security/mfa/provider/totp', { method: 'PUT' })).resolves.toEqual({ ok: true }) })
    expect(requireSudo).not.toHaveBeenCalled()
    expect(readApiResultOrThrow).not.toHaveBeenCalled()
  })

  test('retries only sudo_required with the self-management token and original body', async () => {
    jest.mocked(apiCall).mockResolvedValue({ ok: false, status: 403, result: { error: 'sudo_required' } } as never)
    requireSudo.mockResolvedValue('sudo-token')
    jest.mocked(readApiResultOrThrow).mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useMfaMutation())
    await act(async () => { await result.current('/api/security/mfa/provider/totp', { method: 'PUT', body: '{"setupId":"pending"}' }) })
    expect(requireSudo).toHaveBeenCalledWith('security.mfa.self.manage')
    const [, retry] = jest.mocked(readApiResultOrThrow).mock.calls[0]
    expect(retry?.method).toBe('PUT')
    expect(retry?.body).toBe('{"setupId":"pending"}')
    expect((retry?.headers as Headers).get('x-sudo-token')).toBe('sudo-token')
  })

  test.each(['sudo_required', 'Forbidden'])('cancellation or unrelated %s rejection never retries a mutation', async (error) => {
    jest.mocked(apiCall).mockResolvedValue({ ok: false, status: 403, result: { error }, response: {} } as never)
    requireSudo.mockResolvedValue(null)
    const { result } = renderHook(() => useMfaMutation())
    await act(async () => { await expect(result.current('/api/security/mfa/recovery-codes/regenerate', { method: 'POST' })).rejects.toThrow('original rejection') })
    expect(readApiResultOrThrow).not.toHaveBeenCalled()
    expect(requireSudo).toHaveBeenCalledTimes(error === 'sudo_required' ? 1 : 0)
  })
})
