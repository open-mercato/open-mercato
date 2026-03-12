import { NextResponse } from 'next/server'
import { bootstrapTest } from '@open-mercato/shared/lib/testing/bootstrap'
import { POST as prepareChallenge } from '../prepare/route'
import { POST as verifyChallenge } from '../verify/route'
import { POST as verifyRecovery } from '../recovery/route'
import {
  issueVerifiedMfaToken,
  mapMfaError,
  resolveMfaRequestContext,
  setAuthCookie,
} from '../_shared'

jest.mock('../_shared', () => ({
  issueVerifiedMfaToken: jest.fn(() => 'verified-token'),
  mapMfaError: jest.fn((error: unknown) => {
    if (error instanceof Error && 'statusCode' in error) {
      return NextResponse.json({ error: error.message }, { status: (error as Error & { statusCode: number }).statusCode })
    }
    return NextResponse.json({ error: 'mapped-error' }, { status: 500 })
  }),
  readJsonRecord: jest.requireActual('../_shared').readJsonRecord,
  readString: jest.requireActual('../_shared').readString,
  resolveMfaRequestContext: jest.fn(),
  setAuthCookie: jest.fn(),
}))

const mockedResolveMfaRequestContext = resolveMfaRequestContext as jest.MockedFunction<typeof resolveMfaRequestContext>
const mockedIssueVerifiedMfaToken = issueVerifiedMfaToken as jest.MockedFunction<typeof issueVerifiedMfaToken>
const mockedSetAuthCookie = setAuthCookie as jest.MockedFunction<typeof setAuthCookie>
const mockedMapMfaError = mapMfaError as jest.MockedFunction<typeof mapMfaError>

function buildContext(overrides?: {
  auth?: Record<string, unknown>
  prepareChallenge?: jest.Mock
  verifyChallenge?: jest.Mock
  verifyRecoveryCode?: jest.Mock
  getUserMethods?: jest.Mock
}) {
  return {
    auth: {
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      roles: ['admin'],
      mfa_pending: true,
      ...overrides?.auth,
    },
    mfaVerificationService: {
      prepareChallenge: overrides?.prepareChallenge ?? jest.fn(async () => ({ clientData: { sent: true } })),
      verifyChallenge: overrides?.verifyChallenge ?? jest.fn(async () => true),
      verifyRecoveryCode: overrides?.verifyRecoveryCode ?? jest.fn(async () => true),
    },
    mfaService: {
      getUserMethods: overrides?.getUserMethods ?? jest.fn(async () => [{ type: 'totp' }, { type: 'otp_email' }]),
      confirmMethod: jest.fn(),
      setupMethod: jest.fn(),
    },
  } as never
}

describe('security MFA challenge routes', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    await bootstrapTest({ modules: [] })
  })

  test('prepare route rejects non-pending MFA auth context', async () => {
    mockedResolveMfaRequestContext.mockResolvedValue(buildContext({
      auth: { mfa_pending: false },
    }))

    const response = await prepareChallenge(new Request('https://example.test/api/security/mfa/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: 'challenge-1', methodType: 'totp' }),
    }))

    expect(response.status).toBe(403)
  })

  test('prepare route validates required payload fields', async () => {
    mockedResolveMfaRequestContext.mockResolvedValue(buildContext())

    const response = await prepareChallenge(new Request('https://example.test/api/security/mfa/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: '', methodType: '  ' }),
    }))

    expect(response.status).toBe(400)
  })

  test('verify route issues auth cookie on successful challenge verification', async () => {
    const context = buildContext()
    mockedResolveMfaRequestContext.mockResolvedValue(context)

    const response = await verifyChallenge(new Request('https://example.test/api/security/mfa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: 'challenge-1', methodType: 'totp', payload: { code: '123456' } }),
    }))

    expect(response.status).toBe(200)
    expect(context.mfaVerificationService.verifyChallenge).toHaveBeenCalledWith(
      'challenge-1',
      'totp',
      { code: '123456' },
      { request: expect.any(Request) },
    )
    expect(mockedIssueVerifiedMfaToken).toHaveBeenCalledWith(context.auth, ['totp', 'otp_email'])
    expect(mockedSetAuthCookie).toHaveBeenCalledWith(expect.any(NextResponse), 'verified-token')
  })

  test('verify route returns 401 when challenge verification fails', async () => {
    mockedResolveMfaRequestContext.mockResolvedValue(buildContext({
      verifyChallenge: jest.fn(async () => false),
    }))

    const response = await verifyChallenge(new Request('https://example.test/api/security/mfa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: 'challenge-1', methodType: 'totp' }),
    }))

    expect(response.status).toBe(401)
  })

  test('recovery route issues auth cookie on successful recovery verification', async () => {
    const context = buildContext()
    mockedResolveMfaRequestContext.mockResolvedValue(context)

    const response = await verifyRecovery(new Request('https://example.test/api/security/mfa/recovery', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'ABCDE12345' }),
    }))

    expect(response.status).toBe(200)
    expect(context.mfaVerificationService.verifyRecoveryCode).toHaveBeenCalledWith('user-1', 'ABCDE12345')
    expect(mockedSetAuthCookie).toHaveBeenCalledWith(expect.any(NextResponse), 'verified-token')
  })

  test('recovery route delegates service errors to MFA error mapper', async () => {
    mockedResolveMfaRequestContext.mockResolvedValue(buildContext({
      verifyRecoveryCode: jest.fn(async () => {
        throw Object.assign(new Error('MFA challenge expired'), { statusCode: 400, name: 'MfaVerificationServiceError' })
      }),
    }))

    const response = await verifyRecovery(new Request('https://example.test/api/security/mfa/recovery', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'ABCDE12345' }),
    }))

    expect(mockedMapMfaError).toHaveBeenCalled()
    expect(response.status).toBe(400)
  })
})
