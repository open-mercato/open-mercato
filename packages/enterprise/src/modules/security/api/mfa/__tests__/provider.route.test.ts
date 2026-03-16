import { NextResponse } from 'next/server'
import { POST, PUT } from '../provider/[providername]/route'
import { mapMfaError, resolveMfaRequestContext } from '../_shared'

jest.mock('../_shared', () => ({
  mapMfaError: jest.fn((error: unknown) => {
    if (error instanceof Error && 'statusCode' in error) {
      return NextResponse.json({ error: error.message }, { status: (error as Error & { statusCode: number }).statusCode })
    }
    return NextResponse.json({ error: 'mapped-error' }, { status: 500 })
  }),
  readJsonRecord: jest.requireActual('../_shared').readJsonRecord,
  readString: jest.requireActual('../_shared').readString,
  resolveMfaRequestContext: jest.fn(),
}))

const mockedResolveMfaRequestContext = resolveMfaRequestContext as jest.MockedFunction<typeof resolveMfaRequestContext>
const mockedMapMfaError = mapMfaError as jest.MockedFunction<typeof mapMfaError>

function buildContext() {
  return {
    auth: {
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    },
    mfaService: {
      setupMethod: jest.fn(async (_userId, providerType, payload) => ({
        setupId: `${providerType}-setup-1`,
        clientData: payload as Record<string, unknown>,
      })),
      confirmMethod: jest.fn(async () => ({ recoveryCodes: ['ABCDE12345'] })),
    },
    mfaVerificationService: {} as never,
  } as never
}

describe('security MFA provider route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('POST starts provider setup for the path provider type', async () => {
    const context = buildContext()
    mockedResolveMfaRequestContext.mockResolvedValue(context)

    const response = await POST(new Request('https://example.test/api/security/mfa/provider/totp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Phone' }),
    }), {
      params: Promise.resolve({ providername: 'totp' }),
    })

    expect(response.status).toBe(200)
    expect(context.mfaService.setupMethod).toHaveBeenCalledWith(
      'user-1',
      'totp',
      { label: 'Phone' },
      { request: expect.any(Request) },
    )
  })

  test('PUT passes provider type through to confirmMethod', async () => {
    const context = buildContext()
    mockedResolveMfaRequestContext.mockResolvedValue(context)

    const response = await PUT(new Request('https://example.test/api/security/mfa/provider/totp', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupId: 'setup-1', payload: { code: '123456' } }),
    }), {
      params: Promise.resolve({ providername: 'totp' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(context.mfaService.confirmMethod).toHaveBeenCalledWith(
      'user-1',
      'setup-1',
      { code: '123456' },
      'totp',
      { request: expect.any(Request) },
    )
  })

  test('PUT falls back to derived payload when payload field is missing', async () => {
    const context = buildContext()
    mockedResolveMfaRequestContext.mockResolvedValue(context)

    const response = await PUT(new Request('https://example.test/api/security/mfa/provider/totp', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupId: 'setup-1', code: '123456', label: 'Phone' }),
    }), {
      params: Promise.resolve({ providername: 'totp' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(context.mfaService.confirmMethod).toHaveBeenCalledWith(
      'user-1',
      'setup-1',
      { code: '123456', label: 'Phone' },
      'totp',
      { request: expect.any(Request) },
    )
  })

  test('PUT does not expose recovery codes returned by the service', async () => {
    const context = buildContext()
    mockedResolveMfaRequestContext.mockResolvedValue(context)

    const response = await PUT(new Request('https://example.test/api/security/mfa/provider/totp', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupId: 'setup-1', payload: { code: '123456' } }),
    }), {
      params: Promise.resolve({ providername: 'totp' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  test('PUT maps provider mismatch errors through MFA error mapper', async () => {
    const context = buildContext()
    context.mfaService.confirmMethod.mockRejectedValueOnce(Object.assign(
      new Error('MFA setup session does not match the requested provider'),
      { statusCode: 400, name: 'MfaServiceError' },
    ))
    mockedResolveMfaRequestContext.mockResolvedValue(context)

    const response = await PUT(new Request('https://example.test/api/security/mfa/provider/passkey', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupId: 'setup-1', payload: {} }),
    }), {
      params: Promise.resolve({ providername: 'passkey' }),
    })

    expect(mockedMapMfaError).toHaveBeenCalled()
    expect(response.status).toBe(400)
  })
})
