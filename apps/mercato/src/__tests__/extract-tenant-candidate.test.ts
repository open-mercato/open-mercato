import { NextRequest } from 'next/server'

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

import { extractTenantCandidate } from '@/app/api/[...slug]/route'

function buildMultipartRequest(formData: FormData): NextRequest {
  return new NextRequest('http://localhost:3001/api/example/test', {
    method: 'POST',
    body: formData,
  })
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
