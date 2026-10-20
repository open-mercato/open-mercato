const verifyJwt = jest.fn((_token: string): unknown => {
  throw new Error('no jwt')
})
const createRequestContainer = jest.fn()
const findApiKeyBySecret = jest.fn()
const emFind = jest.fn()
const emFindOne = jest.fn()
const emPersist = jest.fn()
const emFlush = jest.fn()

const reportCausationDegradation = jest.fn()

jest.mock('@open-mercato/shared/lib/causation/server', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/causation/server'),
  reportCausationDegradation: (...args: unknown[]) => reportCausationDegradation(...args),
}))

jest.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}))

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  verifyJwt: (token: string) => verifyJwt(token),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/auth/lib/sessionIntegrity', () => ({
  resolveCanonicalStaffAuthContext: jest.fn(async (_em: unknown, auth: unknown) => auth),
}))

jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findApiKeyBySecret: (...args: unknown[]) => findApiKeyBySecret(...args),
}))

jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({
  Role: class {},
  RoleAcl: class {},
  User: class {},
}))

jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({
  Organization: class {},
  Tenant: class {},
}))

const em = {
  find: (...args: unknown[]) => emFind(...args),
  findOne: (...args: unknown[]) => emFindOne(...args),
  persist: (...args: unknown[]) => {
    emPersist(...args)
    return { flush: (...flushArgs: unknown[]) => emFlush(...flushArgs) }
  },
  flush: (...args: unknown[]) => emFlush(...args),
}

const ORIGIN_CORRELATION_ID = '5b8f0a3e-2c1d-4e6f-9a7b-1c2d3e4f5a6b'
const SOURCE_LOG_ID = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f'

function buildKeyRecord(id: string, causationJson: unknown) {
  return {
    id,
    name: `key ${id}`,
    tenantId: null,
    organizationId: null,
    rolesJson: [],
    sessionToken: null,
    sessionUserId: null,
    sessionSecretEncrypted: null,
    opencodeSessionId: null,
    createdBy: null,
    expiresAt: null,
    lastUsedAt: null,
    causationJson,
  }
}

function buildRequest(secret: string): Request {
  return new Request('https://example.test/api/test', {
    headers: { 'x-api-key': secret },
  })
}

describe('resolveApiKeyAuth origin causation', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => (name === 'em' ? em : null),
    })
    emFind.mockResolvedValue([])
    emFindOne.mockResolvedValue(null)
    emPersist.mockReturnValue(undefined)
    emFlush.mockResolvedValue(undefined)
    const { resetSharedApiKeyAuthCacheForTests } = await import('@open-mercato/shared/lib/auth/apiKeyAuthCache')
    resetSharedApiKeyAuthCacheForTests()
  })

  it('exposes the sanitized origin envelope stored on a loopback key', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue(buildKeyRecord('key-origin', {
      correlationId: ORIGIN_CORRELATION_ID,
      causedByLogId: SOURCE_LOG_ID,
      frames: [
        { kind: 'user' },
        { kind: 'not-a-kind', id: 'dropped' },
        { kind: 'subscriber', id: 'business_rules:crud-rule-trigger', ref: 'customers.deal.updated' },
        { kind: 'business_rule', id: 'rule-1', ref: 'run-1', meta: { attempt: 1, nested: { drop: true } } },
      ],
      injected: 'ignored',
    }))

    const auth = await getAuthFromRequest(buildRequest('origin-secret'))

    expect(auth).toMatchObject({ isApiKey: true, keyId: 'key-origin' })
    expect(auth?.originCausation).toEqual({
      correlationId: ORIGIN_CORRELATION_ID,
      causedByLogId: SOURCE_LOG_ID,
      frames: [
        { kind: 'user' },
        { kind: 'subscriber', id: 'business_rules:crud-rule-trigger', ref: 'customers.deal.updated' },
        { kind: 'business_rule', id: 'rule-1', ref: 'run-1', meta: { attempt: 1 } },
      ],
      truncated: true,
    })
  })

  it('omits originCausation for keys that carry none', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue(buildKeyRecord('key-plain', null))

    const auth = await getAuthFromRequest(buildRequest('plain-secret'))

    expect(auth).toMatchObject({ isApiKey: true, keyId: 'key-plain' })
    expect(auth).not.toHaveProperty('originCausation')
    expect(reportCausationDegradation).not.toHaveBeenCalled()
  })

  it.each([
    ['a plain string', 'garbage'],
    ['an array', [{ kind: 'user' }]],
    ['a missing correlation id', { frames: [{ kind: 'user' }] }],
    ['non-array frames', { correlationId: ORIGIN_CORRELATION_ID, frames: 'user' }],
    ['only unknown frame kinds', { correlationId: ORIGIN_CORRELATION_ID, frames: [{ kind: 'root' }] }],
    ['an unknown innermost frame kind', { correlationId: ORIGIN_CORRELATION_ID, frames: [{ kind: 'user' }, { kind: 'root' }] }],
  ])('treats %s as no origin and reports the invalid origin', async (_label, causationJson) => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue(buildKeyRecord('key-garbage', causationJson))

    const auth = await getAuthFromRequest(buildRequest('garbage-secret'))

    expect(auth).toMatchObject({ isApiKey: true, keyId: 'key-garbage' })
    expect(auth).not.toHaveProperty('originCausation')
    expect(reportCausationDegradation).toHaveBeenCalledTimes(1)
    expect(reportCausationDegradation).toHaveBeenCalledWith('api_key_origin_invalid', { keyId: 'key-garbage' })
  })

  it('does not report a valid origin as degraded', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockResolvedValue(buildKeyRecord('key-valid', {
      correlationId: ORIGIN_CORRELATION_ID,
      frames: [{ kind: 'workflow', id: 'instance-1' }],
    }))

    const auth = await getAuthFromRequest(buildRequest('valid-secret'))

    expect(auth?.originCausation).toEqual({
      correlationId: ORIGIN_CORRELATION_ID,
      frames: [{ kind: 'workflow', id: 'instance-1' }],
    })
    expect(reportCausationDegradation).not.toHaveBeenCalled()
  })

  it('keeps cached origins bound to the key that carries them', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    findApiKeyBySecret.mockImplementation(async (_em: unknown, secret: string) => {
      if (secret === 'secret-with-origin') {
        return buildKeyRecord('key-with-origin', {
          correlationId: ORIGIN_CORRELATION_ID,
          frames: [{ kind: 'workflow', id: 'instance-1', ref: 'step-1' }],
        })
      }
      if (secret === 'secret-without-origin') return buildKeyRecord('key-without-origin', null)
      return null
    })

    const firstWithOrigin = await getAuthFromRequest(buildRequest('secret-with-origin'))
    const withoutOrigin = await getAuthFromRequest(buildRequest('secret-without-origin'))
    const secondWithOrigin = await getAuthFromRequest(buildRequest('secret-with-origin'))
    const secondWithoutOrigin = await getAuthFromRequest(buildRequest('secret-without-origin'))

    expect(findApiKeyBySecret).toHaveBeenCalledTimes(2)
    expect(firstWithOrigin?.originCausation).toEqual({
      correlationId: ORIGIN_CORRELATION_ID,
      frames: [{ kind: 'workflow', id: 'instance-1', ref: 'step-1' }],
    })
    expect(secondWithOrigin?.originCausation).toEqual(firstWithOrigin?.originCausation)
    expect(withoutOrigin).toMatchObject({ keyId: 'key-without-origin' })
    expect(withoutOrigin).not.toHaveProperty('originCausation')
    expect(secondWithoutOrigin).not.toHaveProperty('originCausation')
  })

  it('drops the cached origin once the key is invalidated', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { getSharedApiKeyAuthCache } = await import('@open-mercato/shared/lib/auth/apiKeyAuthCache')
    findApiKeyBySecret.mockResolvedValueOnce(buildKeyRecord('key-onetime', {
      correlationId: ORIGIN_CORRELATION_ID,
      frames: [{ kind: 'business_rule', id: 'rule-1' }],
    }))

    const first = await getAuthFromRequest(buildRequest('onetime-secret'))
    expect(first?.originCausation).toBeTruthy()

    getSharedApiKeyAuthCache().invalidateByKeyId('key-onetime')
    findApiKeyBySecret.mockResolvedValueOnce(null)

    await expect(getAuthFromRequest(buildRequest('onetime-secret'))).resolves.toBeNull()
    expect(findApiKeyBySecret).toHaveBeenCalledTimes(2)
  })
})
