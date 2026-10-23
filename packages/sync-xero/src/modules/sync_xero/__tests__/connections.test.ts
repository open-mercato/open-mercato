import { createXeroApiClient } from '../lib/api-client'
import { listAllOrganisations, listConsentOrganisations, readAuthEventIdClaim, toOrganisationOptions } from '../lib/connections'
import { XERO_ENDPOINTS } from '../lib/constants'
import { createXeroDescriptor } from '../lib/descriptor'
import { XeroApiError } from '../lib/errors'
import { buildXeroGrantOwner } from '../lib/owner'
import { createFakeGrantService } from './support/fakeGrantService'
import { startStubHttpServer, type StubHttpServer, type StubRequest, type StubResponse } from './support/stubHttpServer'

const ORG_A = '996096ec-5362-40dd-be90-3e6a2be09dce'
const ORG_B = '1b2c3d4e-5f60-4718-a9b0-c1d2e3f4a5b6'

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

const servers: StubHttpServer[] = []

async function setup(handler: (request: StubRequest) => StubResponse, accessToken: (sequence: number) => string) {
  const server = await startStubHttpServer(handler)
  servers.push(server)
  const grants = createFakeGrantService({ connected: true, tokenFactory: accessToken })
  const client = createXeroApiClient({
    grantService: grants.service,
    descriptor: createXeroDescriptor(XERO_ENDPOINTS),
    owner: buildXeroGrantOwner({ tenantId: 'tenant-1', organizationId: 'org-1' }),
    endpoints: { connections: `${server.url}/connections`, accounting: `${server.url}/api.xro/2.0` },
    budget: 'interactive',
  })
  return { server, client }
}

const organisationA = { id: 'conn-a', tenantId: ORG_A, tenantType: 'ORGANISATION', tenantName: 'Demo Company (Global)', authEventId: 'evt-1' }
const organisationB = { id: 'conn-b', tenantId: ORG_B, tenantType: 'ORGANISATION', tenantName: 'Second Ltd', authEventId: 'evt-0' }
const practice = { id: 'conn-p', tenantId: 'practice-1', tenantType: 'PRACTICE', tenantName: 'Practice', authEventId: 'evt-1' }

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close()
})

describe('readAuthEventIdClaim', () => {
  it('reads authentication_event_id from the access token payload without verifying it', () => {
    expect(readAuthEventIdClaim(jwt({ authentication_event_id: 'evt-1', xero_userid: 'user-1' }))).toBe('evt-1')
  })

  it('returns null for an opaque token, a malformed payload or a missing claim', () => {
    expect(readAuthEventIdClaim('opaque-access-token')).toBeNull()
    expect(readAuthEventIdClaim('a.not-base64-json.c')).toBeNull()
    expect(readAuthEventIdClaim(jwt({ sub: 'user-1' }))).toBeNull()
    expect(readAuthEventIdClaim(jwt({ authentication_event_id: 42 }))).toBeNull()
  })
})

describe('listConsentOrganisations', () => {
  it('lists the Organisations of the consent round filtered by authEventId, without practices', async () => {
    const { server, client } = await setup(
      (request) => ({ status: 200, body: request.query.get('authEventId') === 'evt-1' ? [organisationA, practice] : [organisationA, organisationB, practice] }),
      () => jwt({ authentication_event_id: 'evt-1' }),
    )
    await expect(listConsentOrganisations(client)).resolves.toEqual({
      organisations: [{ xeroOrganisationId: ORG_A, xeroConnectionId: 'conn-a', name: 'Demo Company (Global)' }],
      filtered: true,
    })
    expect(server.requests.map((request) => request.query.get('authEventId'))).toEqual(['evt-1'])
  })

  it('falls back to the unfiltered list when the consent round is empty, as on a Reconnect', async () => {
    const { server, client } = await setup(
      (request) => ({ status: 200, body: request.query.get('authEventId') ? [] : [organisationA, organisationB] }),
      () => jwt({ authentication_event_id: 'evt-2' }),
    )
    const result = await listConsentOrganisations(client)
    expect(result.filtered).toBe(false)
    expect(result.organisations.map((organisation) => organisation.xeroOrganisationId)).toEqual([ORG_A, ORG_B])
    expect(server.requests.map((request) => request.query.get('authEventId'))).toEqual(['evt-2', null])
  })

  it('uses the unfiltered list when the access token carries no claim', async () => {
    const { server, client } = await setup(() => ({ status: 200, body: [organisationB] }), () => 'opaque-access-token')
    await expect(listConsentOrganisations(client)).resolves.toEqual({
      organisations: [{ xeroOrganisationId: ORG_B, xeroConnectionId: 'conn-b', name: 'Second Ltd' }],
      filtered: false,
    })
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0].query.has('authEventId')).toBe(false)
  })

  it('reports an unexpected /connections body as transient', async () => {
    const { client } = await setup(() => ({ status: 200, body: { connections: 'nope' } }), () => 'opaque-access-token')
    await expect(listAllOrganisations(client)).rejects.toMatchObject({ code: 'transient' })
    await expect(listAllOrganisations(client)).rejects.toBeInstanceOf(XeroApiError)
  })
})

describe('toOrganisationOptions', () => {
  it('names an Organisation without a tenant name by its id', () => {
    expect(toOrganisationOptions([{ id: 'conn-x', tenantId: ORG_B, tenantType: 'ORGANISATION', tenantName: null, authEventId: null }])).toEqual([
      { xeroOrganisationId: ORG_B, xeroConnectionId: 'conn-x', name: ORG_B },
    ])
  })
})
