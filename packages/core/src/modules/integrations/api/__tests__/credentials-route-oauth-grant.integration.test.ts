/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  clearRegisteredIntegrations,
  registerIntegrations,
  type IntegrationDefinition,
} from '@open-mercato/shared/modules/integrations/types'
import { emitIntegrationsEvent } from '../../events'
import { createTestKms, startPgTestOrm, type PgTestOrm } from '../../__tests__/support/pgTestOrm'
import { createCredentialsService } from '../../lib/credentials-service'
import { exchangeAuthorizationCode } from '../../lib/oauth/authorization'
import type { OAuthGrantOwner, OAuthProviderDescriptor } from '../../lib/oauth/descriptor'
import { oauthGrantRowId } from '../../lib/oauth/grant-blob'
import { createIntegrationOAuthGrantService } from '../../lib/oauth/grant-service'
import { createPkcePair } from '../../lib/oauth/pkce'
import { startFakeAuthorizationServer, type FakeAuthorizationServer } from '../../lib/oauth/testing/fakeAuthorizationServer'
import * as credentialsRoute from '../[id]/credentials/route'

jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/kms'),
  createKmsService: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('../../events', () => ({
  emitIntegrationsEvent: jest.fn(),
}))

jest.mock('../guards', () => ({
  resolveUserFeatures: jest.fn(() => []),
  runIntegrationMutationGuards: jest.fn(async () => ({ ok: true })),
  runIntegrationMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const CASE_TIMEOUT_MS = 20_000
const INTEGRATION_ID = 'test_oauth_grant'
const GRANT_ROW_ID = oauthGrantRowId(INTEGRATION_ID)
const CHILD_ID = 'zz_oauth_grant_child'
const ROGUE_ID = 'rogue__oauth_grant'
const REDIRECT_URI = 'http://127.0.0.1/callback'
const DEFAULT_SCOPES = ['test.read', 'test.write']

const mockGetAuthFromRequest = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>
const mockCreateRequestContainer = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>
const mockEmitIntegrationsEvent = emitIntegrationsEvent as jest.MockedFunction<typeof emitIntegrationsEvent>

type RouteContext = { params: { id: string } }
type RawCredentialRow = { id: string; credentials: string; updated_at: string; deleted_at: string | null }

const clientCredentialsSchema: IntegrationDefinition['credentials'] = {
  fields: [
    { key: 'clientId', label: 'Client ID', type: 'text' },
    { key: 'clientSecret', label: 'Client secret', type: 'secret' },
  ],
}

const registeredIntegrations: IntegrationDefinition[] = [
  { id: INTEGRATION_ID, title: 'Zz Test OAuth Grant', credentials: clientCredentialsSchema },
  {
    id: CHILD_ID,
    title: 'Zz Grant Child',
    bundleId: GRANT_ROW_ID,
    credentials: { fields: [{ key: 'apiKey', label: 'API key', type: 'secret' }] },
  },
  { id: ROGUE_ID, title: 'Rogue', credentials: clientCredentialsSchema },
]

function contextFor(id: string): RouteContext {
  return { params: { id } }
}

function getRequest(id: string): Request {
  return new Request(`http://localhost/api/integrations/${id}/credentials`)
}

function putRequest(id: string, credentials: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/integrations/${id}/credentials`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credentials }),
  })
}

describeWithPostgres('credentials route and the reserved __oauth_grant suffix against real PostgreSQL (A34)', () => {
  let pg: PgTestOrm | null = null
  let fake: FakeAuthorizationServer | null = null

  function harness(): PgTestOrm {
    if (!pg) throw new Error('[internal] pgTestOrm is not started')
    return pg
  }

  function server(): FakeAuthorizationServer {
    if (!fake) throw new Error('[internal] fake authorization server is not started')
    return fake
  }

  function fork(): EntityManager {
    return harness().em.fork()
  }

  function descriptorOf(owner: OAuthGrantOwner): OAuthProviderDescriptor {
    return {
      integrationId: owner.integrationId,
      authorizationEndpoint: server().authorizationEndpoint,
      tokenEndpoint: server().tokenEndpoint,
      defaultScopes: DEFAULT_SCOPES,
    }
  }

  function signInAs(owner: OAuthGrantOwner): void {
    mockGetAuthFromRequest.mockResolvedValue({ sub: randomUUID(), tenantId: owner.tenantId, orgId: owner.organizationId } as never)
  }

  async function connectGrant(owner: OAuthGrantOwner): Promise<void> {
    await createCredentialsService(fork()).save(
      INTEGRATION_ID,
      { clientId: server().clientId, clientSecret: server().clientSecret },
      { tenantId: owner.tenantId, organizationId: owner.organizationId },
    )
    const pkce = createPkcePair()
    const code = server().issueAuthorizationCode({ redirectUri: REDIRECT_URI, scope: DEFAULT_SCOPES, codeChallenge: pkce.codeChallenge })
    const tokens = await exchangeAuthorizationCode(
      descriptorOf(owner),
      { clientId: server().clientId, clientSecret: server().clientSecret },
      { code, redirectUri: REDIRECT_URI, codeVerifier: pkce.codeVerifier },
    )
    await createIntegrationOAuthGrantService({ em: fork() }).completeConnect(descriptorOf(owner), owner, tokens, {
      clientId: server().clientId,
    })
  }

  async function readRawRows(owner: OAuthGrantOwner, integrationId: string): Promise<RawCredentialRow[]> {
    return fork().execute<RawCredentialRow[]>(
      `select "id", "credentials"::text as "credentials", "updated_at"::text as "updated_at", "deleted_at"
       from "integration_credentials"
       where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ?
       order by "created_at" asc`,
      [integrationId, owner.tenantId, owner.organizationId],
    )
  }

  async function readBody(response: Response): Promise<Record<string, unknown>> {
    return (await response.json()) as Record<string, unknown>
  }

  function expectNoIssuedToken(value: unknown): void {
    const serialized = JSON.stringify(value)
    const issued = server().issuedTokens()
    expect(issued.accessTokens.length + issued.refreshTokens.length).toBeGreaterThan(0)
    for (const token of [...issued.accessTokens, ...issued.refreshTokens]) expect(serialized).not.toContain(token)
  }

  beforeAll(async () => {
    pg = await startPgTestOrm()
    fake = await startFakeAuthorizationServer({ rotation: 'strict' })
    clearRegisteredIntegrations()
    registerIntegrations(registeredIntegrations)
  }, 120_000)

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    jest.clearAllMocks()
    server().reset()
    harness().setKms(createTestKms())
    mockCreateRequestContainer.mockImplementation(async () => ({
      resolve: (key: string) => {
        if (key === 'integrationCredentialsService') return createCredentialsService(fork(), harness().encryption)
        throw new Error(`[internal] unexpected resolve(${key})`)
      },
    }) as never)
  })

  afterAll(async () => {
    clearRegisteredIntegrations()
    await fake?.close()
    await pg?.close()
  }, 30_000)

  it.each([GRANT_ROW_ID, ROGUE_ID])('GET and PUT answer 404 for %s and leave the grant row untouched', async (id) => {
    const owner: OAuthGrantOwner = { integrationId: INTEGRATION_ID, tenantId: randomUUID(), organizationId: randomUUID() }
    await connectGrant(owner)
    signInAs(owner)
    const before = await readRawRows(owner, GRANT_ROW_ID)

    const getResponse = await credentialsRoute.GET(getRequest(id), contextFor(id))
    const putResponse = await credentialsRoute.PUT(putRequest(id, { clientId: 'attacker', clientSecret: 'attacker' }), contextFor(id))

    expect(getResponse.status).toBe(404)
    expect(putResponse.status).toBe(404)
    const bodies = [await readBody(getResponse), await readBody(putResponse)]
    expect(bodies).toEqual([{ error: 'Integration not found' }, { error: 'Integration not found' }])
    expectNoIssuedToken(bodies)
    expect(await readRawRows(owner, GRANT_ROW_ID)).toEqual(before)
    expect(await readRawRows(owner, id)).toEqual(id === GRANT_ROW_ID ? before : [])
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
    expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()
  }, CASE_TIMEOUT_MS)

  it('exports no DELETE handler', () => {
    expect((credentialsRoute as Record<string, unknown>).DELETE).toBeUndefined()
  })

  it('serves a child whose bundleId is test_oauth_grant__oauth_grant without the grant: GET has no token, a lock-less PUT stores none', async () => {
    const owner: OAuthGrantOwner = { integrationId: INTEGRATION_ID, tenantId: randomUUID(), organizationId: randomUUID() }
    await connectGrant(owner)
    signInAs(owner)
    const grantBefore = await readRawRows(owner, GRANT_ROW_ID)

    const getResponse = await credentialsRoute.GET(getRequest(CHILD_ID), contextFor(CHILD_ID))

    expect(getResponse.status).toBe(200)
    const getBody = await readBody(getResponse)
    expect(getBody).toMatchObject({ integrationId: CHILD_ID, updatedAt: null })
    expect(getBody.credentials).toEqual({})
    expectNoIssuedToken(getBody)

    const putResponse = await credentialsRoute.PUT(putRequest(CHILD_ID, { apiKey: 'child-api-key' }), contextFor(CHILD_ID))

    expect(putResponse.status).toBe(200)
    const putBody = await readBody(putResponse)
    expect(putBody).toEqual({ ok: true })
    const childCredentials = await createCredentialsService(fork()).getRaw(CHILD_ID, {
      tenantId: owner.tenantId,
      organizationId: owner.organizationId,
    })
    expect(childCredentials).toEqual({ apiKey: 'child-api-key' })
    expectNoIssuedToken(childCredentials)
    expect(await readRawRows(owner, GRANT_ROW_ID)).toEqual(grantBefore)
  }, CASE_TIMEOUT_MS)

  it('still answers 200 for test_oauth_grant own credentials GET and PUT, leaving the grant row untouched', async () => {
    const owner: OAuthGrantOwner = { integrationId: INTEGRATION_ID, tenantId: randomUUID(), organizationId: randomUUID() }
    await connectGrant(owner)
    signInAs(owner)
    const grantBefore = await readRawRows(owner, GRANT_ROW_ID)

    const getResponse = await credentialsRoute.GET(getRequest(INTEGRATION_ID), contextFor(INTEGRATION_ID))

    expect(getResponse.status).toBe(200)
    const getBody = await readBody(getResponse)
    expect(getBody).toMatchObject({
      integrationId: INTEGRATION_ID,
      credentials: { clientId: server().clientId },
      secretFieldsConfigured: { clientSecret: true },
      updatedAt: expect.any(String),
    })
    expectNoIssuedToken(getBody)

    const putResponse = await credentialsRoute.PUT(
      putRequest(INTEGRATION_ID, { clientId: server().clientId, clientSecret: server().clientSecret }),
      contextFor(INTEGRATION_ID),
    )

    expect(putResponse.status).toBe(200)
    const putBody = await readBody(putResponse)
    expect(putBody).toEqual({ ok: true })
    expectNoIssuedToken(putBody)
    expect(await readRawRows(owner, GRANT_ROW_ID)).toEqual(grantBefore)
    expect(mockEmitIntegrationsEvent).toHaveBeenCalledWith('integrations.credentials.updated', expect.objectContaining({
      integrationId: INTEGRATION_ID,
    }))
  }, CASE_TIMEOUT_MS)
})
