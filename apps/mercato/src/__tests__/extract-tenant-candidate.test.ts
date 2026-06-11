import { NextRequest } from 'next/server'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'

jest.mock('@/bootstrap', () => ({
  bootstrap: jest.fn(),
  isBootstrapped: jest.fn(() => true),
}))

jest.mock('@/.mercato/generated/api-routes.generated', () => ({
  apiRoutes: [],
}))

jest.mock('@/.mercato/generated/backend-routes.generated', () => ({
  backendRoutes: [],
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ t: (_key: string, fallback?: string) => fallback ?? _key })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: jest.fn(() => ({})) })),
}))

jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/auth/lib/tenantAccess')
  return { ...actual, enforceTenantSelection: jest.fn() }
})

import { enforceTenantSelection } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { checkAuthorization, extractTenantCandidate, extractTenantCandidates } from '@/app/api/[...slug]/route'

const enforceTenantSelectionMock = enforceTenantSelection as jest.MockedFunction<typeof enforceTenantSelection>

function buildMultipartRequest(formData: FormData): NextRequest {
  return new NextRequest('http://localhost:3001/api/example/test', {
    method: 'POST',
    body: formData,
  })
}

function buildAuth(tenantId: string | null): AuthContext {
  return { sub: 'user-1', tenantId, orgId: null }
}

describe('extractTenantCandidate', () => {
  it('ignores a File-typed tenantId field instead of coercing its filename (security: issue #2722)', async () => {
    const attackerTenantUuid = '11111111-1111-1111-1111-111111111111'
    const form = new FormData()
    form.append('tenantId', new File(['x'], attackerTenantUuid))

    const candidate = await extractTenantCandidate(buildMultipartRequest(form))

    expect(candidate).toBeUndefined()
  })

  it('still returns a string tenantId multipart field', async () => {
    const tenantId = '22222222-2222-2222-2222-222222222222'
    const form = new FormData()
    form.append('tenantId', tenantId)

    const candidate = await extractTenantCandidate(buildMultipartRequest(form))

    expect(candidate).toBe(tenantId)
  })

  it('returns undefined when no tenantId multipart field is present', async () => {
    const form = new FormData()
    form.append('name', 'example')

    const candidate = await extractTenantCandidate(buildMultipartRequest(form))

    expect(candidate).toBeUndefined()
  })

  it('still returns a string tenantId from a urlencoded body', async () => {
    const tenantId = '33333333-3333-3333-3333-333333333333'
    const request = new NextRequest('http://localhost:3001/api/example/test', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `tenantId=${tenantId}`,
    })

    const candidate = await extractTenantCandidate(request)

    expect(candidate).toBe(tenantId)
  })

  it('prefers the query-string tenantId over the body', async () => {
    const queryTenant = '44444444-4444-4444-4444-444444444444'
    const form = new FormData()
    form.append('tenantId', new File(['x'], 'attacker-filename'))
    const request = new NextRequest(`http://localhost:3001/api/example/test?tenantId=${queryTenant}`, {
      method: 'POST',
      body: form,
    })

    const candidate = await extractTenantCandidate(request)

    expect(candidate).toBe(queryTenant)
  })
})

describe('extractTenantCandidates (HTTP parameter pollution, issue #2665)', () => {
  it('returns every repeated ?tenantId= query param in order', async () => {
    const targetTenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const ownTenant = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const request = new NextRequest(
      `http://localhost:3001/api/example/test?tenantId=${targetTenant}&tenantId=${ownTenant}`,
      { method: 'GET' },
    )

    const candidates = await extractTenantCandidates(request)

    expect(candidates).toEqual([targetTenant, ownTenant])
  })

  it('surfaces both query and body tenantId candidates from a JSON request', async () => {
    const queryTenant = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    const bodyTenant = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    const request = new NextRequest(`http://localhost:3001/api/example/test?tenantId=${queryTenant}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: bodyTenant }),
    })

    const candidates = await extractTenantCandidates(request)

    expect(candidates).toEqual([queryTenant, bodyTenant])
  })

  it('returns an empty list when no tenantId is present', async () => {
    const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'GET' })

    const candidates = await extractTenantCandidates(request)

    expect(candidates).toEqual([])
  })
})

describe('checkAuthorization tenant pollution enforcement (issue #2665)', () => {
  beforeEach(() => {
    enforceTenantSelectionMock.mockReset()
    enforceTenantSelectionMock.mockImplementation(async (_ctx, requested) =>
      typeof requested === 'string' ? requested : null,
    )
  })

  it('rejects when the FIRST query tenantId targets a foreign tenant even though the LAST matches the actor', async () => {
    const foreignTenant = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    const ownTenant = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    enforceTenantSelectionMock.mockImplementation(async (_ctx, requested) => {
      if (requested === foreignTenant) throw forbidden('Not authorized to target this tenant.')
      return typeof requested === 'string' ? requested : null
    })

    const request = new NextRequest(
      `http://localhost:3001/api/example/test?tenantId=${foreignTenant}&tenantId=${ownTenant}`,
      { method: 'GET' },
    )

    const response = await checkAuthorization(null, buildAuth(ownTenant), request)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(403)
    expect(enforceTenantSelectionMock).toHaveBeenCalledWith(expect.anything(), foreignTenant)
  })

  it('rejects when a body tenantId disagrees with an authorized query tenantId', async () => {
    const ownTenant = '00000000-0000-0000-0000-000000000001'
    const foreignTenant = '00000000-0000-0000-0000-000000000002'
    enforceTenantSelectionMock.mockImplementation(async (_ctx, requested) => {
      if (requested === foreignTenant) throw forbidden('Not authorized to target this tenant.')
      return typeof requested === 'string' ? requested : null
    })

    const request = new NextRequest(`http://localhost:3001/api/example/test?tenantId=${ownTenant}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: foreignTenant }),
    })

    const response = await checkAuthorization(null, buildAuth(ownTenant), request)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(403)
    expect(enforceTenantSelectionMock).toHaveBeenCalledWith(expect.anything(), foreignTenant)
  })

  it('allows a request whose only tenantId matches the actor without invoking the guard', async () => {
    const ownTenant = '00000000-0000-0000-0000-0000000000aa'
    const request = new NextRequest(`http://localhost:3001/api/example/test?tenantId=${ownTenant}`, {
      method: 'GET',
    })

    const response = await checkAuthorization(null, buildAuth(ownTenant), request)

    expect(response).toBeNull()
    expect(enforceTenantSelectionMock).not.toHaveBeenCalled()
  })

  it('enforces each distinct foreign candidate only once', async () => {
    const ownTenant = '00000000-0000-0000-0000-0000000000bb'
    const foreignTenant = '00000000-0000-0000-0000-0000000000cc'
    const request = new NextRequest(
      `http://localhost:3001/api/example/test?tenantId=${foreignTenant}&tenantId=${foreignTenant}&tenantId=${ownTenant}`,
      { method: 'GET' },
    )

    const response = await checkAuthorization(null, buildAuth(ownTenant), request)

    expect(response).toBeNull()
    expect(enforceTenantSelectionMock).toHaveBeenCalledTimes(1)
    expect(enforceTenantSelectionMock).toHaveBeenCalledWith(expect.anything(), foreignTenant)
  })
})
