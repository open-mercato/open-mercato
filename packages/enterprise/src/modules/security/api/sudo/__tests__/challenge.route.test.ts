import { NextResponse } from 'next/server'
import { bootstrapTest } from '@open-mercato/shared/lib/testing/bootstrap'
import { POST as prepareChallenge } from '../prepare/route'
import { POST as verifyChallenge } from '../verify/route'
import { mapSudoError, resolveSudoContext } from '../_shared'

jest.mock('../_shared', () => ({
  mapSudoError: jest.fn((error: unknown) => {
    if (error instanceof Error && 'statusCode' in error) {
      return NextResponse.json({ error: error.message }, { status: (error as Error & { statusCode: number }).statusCode })
    }
    return NextResponse.json({ error: 'mapped-error' }, { status: 500 })
  }),
  resolveSudoContext: jest.fn(),
}))

const mockedResolveSudoContext = resolveSudoContext as jest.MockedFunction<typeof resolveSudoContext>
const mockedMapSudoError = mapSudoError as jest.MockedFunction<typeof mapSudoError>

function buildContext() {
  return {
    auth: {
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    },
    sudoChallengeService: {
      prepare: jest.fn(async () => ({ clientData: { sent: true } })),
      verify: jest.fn(async () => ({
        sudoToken: 'sudo-token',
        expiresAt: new Date('2026-03-10T12:00:00.000Z'),
      })),
    },
  } as never
}

describe('security sudo challenge routes', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    await bootstrapTest({ modules: [] })
  })

  test('prepare route validates payload shape', async () => {
    mockedResolveSudoContext.mockResolvedValue(buildContext())

    const response = await prepareChallenge(new Request('https://example.test/api/security/sudo/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'not-a-uuid', methodType: '' }),
    }))

    expect(response.status).toBe(400)
  })

  test('prepare route forwards parsed payload to sudo service', async () => {
    const context = buildContext()
    mockedResolveSudoContext.mockResolvedValue(context)

    const response = await prepareChallenge(new Request('https://example.test/api/security/sudo/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: '11111111-1111-4111-8111-111111111111', methodType: 'totp' }),
    }))

    expect(response.status).toBe(200)
    expect(context.sudoChallengeService.prepare).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'totp',
      expect.any(Request),
    )
  })

  test('verify route serializes expiresAt and returns sudo token', async () => {
    const context = buildContext()
    mockedResolveSudoContext.mockResolvedValue(context)

    const response = await verifyChallenge(new Request('https://example.test/api/security/sudo/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: '11111111-1111-4111-8111-111111111111',
        targetIdentifier: 'security.sudo.manage',
        methodType: 'totp',
        payload: { code: '123456' },
      }),
    }))

    expect(response.status).toBe(200)
    expect(context.sudoChallengeService.verify).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'totp',
      { code: '123456' },
      expect.objectContaining({
        expectedUserId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        targetIdentifier: 'security.sudo.manage',
      }),
      expect.any(Request),
    )
    await expect(response.json()).resolves.toEqual({
      sudoToken: 'sudo-token',
      expiresAt: '2026-03-10T12:00:00.000Z',
    })
  })

  test('verify route delegates service errors to sudo error mapper', async () => {
    const context = buildContext()
    context.sudoChallengeService.verify.mockRejectedValueOnce(Object.assign(
      new Error('Unable to verify sudo challenge'),
      { statusCode: 401, name: 'SudoChallengeServiceError' },
    ))
    mockedResolveSudoContext.mockResolvedValue(context)

    const response = await verifyChallenge(new Request('https://example.test/api/security/sudo/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: '11111111-1111-4111-8111-111111111111',
        targetIdentifier: 'security.sudo.manage',
        methodType: 'totp',
        payload: { code: '123456' },
      }),
    }))

    expect(mockedMapSudoError).toHaveBeenCalled()
    expect(response.status).toBe(401)
  })
})
