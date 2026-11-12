const validId = '44444444-4444-4444-8444-444444444444'

const getAuthFromRequestMock = jest.fn()
const loadPersonContextMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: jest.fn() })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../people/[id]/companies/context', () => ({
  loadPersonContext: (...args: unknown[]) => loadPersonContextMock(...args),
}))

import { GET as listPersonCompanies, POST as createPersonCompany } from '../people/[id]/companies/route'
import {
  PATCH as updatePersonCompany,
  DELETE as deletePersonCompany,
} from '../people/[id]/companies/[linkId]/route'
import { GET as listEnrichedPersonCompanies } from '../people/[id]/companies/enriched/route'
import { GET as listCompanyPeople } from '../companies/[id]/people/route'
import { GET as listDealPeople } from '../deals/[id]/people/route'
import { GET as listDealCompanies } from '../deals/[id]/companies/route'

type RouteHandler = (req: Request, ctx: { params?: Record<string, string> }) => Promise<Response>

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const malformedPathCases: Array<{ name: string; handler: RouteHandler; request: () => Request; params: Record<string, string> }> = [
  {
    name: 'GET /api/customers/people/{id}/companies',
    handler: listPersonCompanies as RouteHandler,
    request: () => new Request('http://localhost/api/customers/people/not-a-uuid/companies'),
    params: { id: 'not-a-uuid' },
  },
  {
    name: 'POST /api/customers/people/{id}/companies',
    handler: createPersonCompany as RouteHandler,
    request: () => jsonRequest('http://localhost/api/customers/people/not-a-uuid/companies', 'POST', { companyId: validId }),
    params: { id: 'not-a-uuid' },
  },
  {
    name: 'PATCH /api/customers/people/{id}/companies/{linkId}',
    handler: updatePersonCompany as RouteHandler,
    request: () => jsonRequest(`http://localhost/api/customers/people/${validId}/companies/not-a-uuid`, 'PATCH', { isPrimary: true }),
    params: { id: validId, linkId: 'not-a-uuid' },
  },
  {
    name: 'DELETE /api/customers/people/{id}/companies/{linkId}',
    handler: deletePersonCompany as RouteHandler,
    request: () => jsonRequest(`http://localhost/api/customers/people/not-a-uuid/companies/${validId}`, 'DELETE'),
    params: { id: 'not-a-uuid', linkId: validId },
  },
  {
    name: 'GET /api/customers/people/{id}/companies/enriched',
    handler: listEnrichedPersonCompanies as RouteHandler,
    request: () => new Request('http://localhost/api/customers/people/not-a-uuid/companies/enriched'),
    params: { id: 'not-a-uuid' },
  },
  {
    name: 'GET /api/customers/companies/{id}/people',
    handler: listCompanyPeople as RouteHandler,
    request: () => new Request('http://localhost/api/customers/companies/not-a-uuid/people'),
    params: { id: 'not-a-uuid' },
  },
  {
    name: 'GET /api/customers/deals/{id}/people',
    handler: listDealPeople as RouteHandler,
    request: () => new Request('http://localhost/api/customers/deals/not-a-uuid/people'),
    params: { id: 'not-a-uuid' },
  },
  {
    name: 'GET /api/customers/deals/{id}/companies',
    handler: listDealCompanies as RouteHandler,
    request: () => new Request('http://localhost/api/customers/deals/not-a-uuid/companies'),
    params: { id: 'not-a-uuid' },
  },
]

describe('customer relationship routes reject malformed input with 400 (#7266)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue(null)
  })

  it.each(malformedPathCases)('$name returns 400 for a malformed path id', async ({ handler, request, params }) => {
    const response = await handler(request(), { params })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Validation failed')
    expect(Array.isArray(body.details)).toBe(true)
    expect(loadPersonContextMock).not.toHaveBeenCalled()
    expect(getAuthFromRequestMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed person-company link body with 400', async () => {
    const response = await (createPersonCompany as RouteHandler)(
      jsonRequest(`http://localhost/api/customers/people/${validId}/companies`, 'POST', { companyId: 'not-a-uuid' }),
      { params: { id: validId } },
    )

    expect(response.status).toBe(400)
    expect(loadPersonContextMock).not.toHaveBeenCalled()
  })

  it('keeps reporting unexpected failures as 500', async () => {
    getAuthFromRequestMock.mockRejectedValueOnce(new Error('boom'))

    const response = await (listDealCompanies as RouteHandler)(
      new Request(`http://localhost/api/customers/deals/${validId}/companies`),
      { params: { id: validId } },
    )

    expect(response.status).toBe(500)
  })

  it('keeps an unauthenticated valid request on its 401 path', async () => {
    const response = await (listDealPeople as RouteHandler)(
      new Request(`http://localhost/api/customers/deals/${validId}/people`),
      { params: { id: validId } },
    )

    expect(response.status).toBe(401)
  })
})
