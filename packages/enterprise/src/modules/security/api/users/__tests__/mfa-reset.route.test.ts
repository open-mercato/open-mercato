import { NextResponse } from 'next/server'
import { POST } from '../[id]/mfa/reset/route'
import { requireSudo, SudoRequiredError } from '../../../lib/sudo-middleware'
import { resolveSecurityUsersContext } from '../_shared'

jest.mock('../_shared', () => ({
  resolveSecurityUsersContext: jest.fn(),
  mapSecurityUsersError: jest.fn((error: unknown) => {
    if (error instanceof Error && 'statusCode' in error) {
      const statusCode = (error as Error & { statusCode: number }).statusCode
      const body = 'body' in error ? (error as Error & { body?: unknown }).body : { error: error.message }
      return NextResponse.json(body, { status: statusCode })
    }
    return NextResponse.json({ error: 'Failed to process user security request.' }, { status: 500 })
  }),
}))

jest.mock('../../../lib/sudo-middleware', () => ({
  requireSudo: jest.fn(),
  SudoRequiredError: class SudoRequiredError extends Error {
    statusCode = 403
    body = { error: 'sudo_required', message: 'Sudo authentication required', challengeUrl: '/api/security/sudo/challenge' }
  },
}))

const mockedRequireSudo = requireSudo as jest.MockedFunction<typeof requireSudo>
const mockedResolveSecurityUsersContext = resolveSecurityUsersContext as jest.MockedFunction<typeof resolveSecurityUsersContext>

describe('security user mfa reset route', () => {
  const userId = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('requires sudo before executing the reset command', async () => {
    const execute = jest.fn(async () => ({ result: { ok: true } }))
    mockedResolveSecurityUsersContext.mockResolvedValue({
      auth: { sub: 'admin-1', tenantId: 'tenant-1', orgId: 'org-1' },
      container: {
        resolve: (name: string) => {
          if (name === 'commandBus') return { execute }
          throw new Error(`Unexpected dependency: ${name}`)
        },
      },
      commandContext: {} as never,
      mfaAdminService: {} as never,
    } as never)

    const req = new Request(`https://example.test/api/security/users/${userId}/mfa/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sudo-token': 'sudo-token' },
      body: JSON.stringify({ reason: 'security incident' }),
    })

    const response = await POST(req, {
      params: Promise.resolve({ id: userId }),
    })

    expect(response.status).toBe(200)
    expect(mockedRequireSudo).toHaveBeenCalledWith(req, 'security.admin.mfa.reset')
    expect(execute).toHaveBeenCalledWith('security.admin.mfa.reset', expect.any(Object))
  })

  test('returns 403 when sudo validation fails', async () => {
    mockedResolveSecurityUsersContext.mockResolvedValue({
      auth: { sub: 'admin-1', tenantId: 'tenant-1', orgId: 'org-1' },
      container: { resolve: jest.fn() },
      commandContext: {} as never,
      mfaAdminService: {} as never,
    } as never)
    mockedRequireSudo.mockRejectedValueOnce(new SudoRequiredError('security.admin.mfa.reset') as never)

    const req = new Request(`https://example.test/api/security/users/${userId}/mfa/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'security incident' }),
    })

    const response = await POST(req, {
      params: Promise.resolve({ id: userId }),
    })

    expect(response.status).toBe(403)
  })
})
