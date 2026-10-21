import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import {
  isExplicitlyEmptyOrganizationScope,
  organizationScopeRequiredResponse,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import type { KmsService, TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  TEST_OAUTH_GRANT_INTEGRATION_ID,
  isTestOAuthGrantsEnabled,
} from '@open-mercato/core/modules/integrations/integration'
import {
  createCredentialsService,
  eraseIntegrationCredentials,
  type CredentialsService,
} from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { exchangeAuthorizationCode } from '@open-mercato/core/modules/integrations/lib/oauth/authorization'
import {
  OAuthGrantError,
  type OAuthProviderDescriptor,
  type OAuthTokenFailure,
} from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import { OAUTH_GRANT_RESOURCE_KIND, oauthGrantRowId } from '@open-mercato/core/modules/integrations/lib/oauth/grant-blob'
import type { IntegrationOAuthGrantService } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { createPkcePair } from '@open-mercato/core/modules/integrations/lib/oauth/pkce'
import type {
  FakeAuthorizationServer,
  FakeAuthorizationServerOptions,
  FakeInjection,
} from '@open-mercato/core/modules/integrations/lib/oauth/testing/fakeAuthorizationServer'

/**
 * TEST-ONLY driver for the grant of the `test_oauth_grant` integration, gated by
 * `OM_ENABLE_TEST_OAUTH_GRANTS` (404 for every caller while it is off). It writes only
 * `test_oauth_grant` rows of the caller's own organization, and no response carries a token.
 */
export const metadata = {
  path: '/integrations/test-oauth-grants',
  POST: { requireAuth: true, requireFeatures: ['integrations.credentials.manage'] },
}

const CREDENTIALS_MANAGE_FEATURE = 'integrations.credentials.manage'
const GRANT_ROW_ID = oauthGrantRowId(TEST_OAUTH_GRANT_INTEGRATION_ID)
const FAKE_SERVER_GLOBAL_KEY = '__omTestOAuthGrantsFakeServer__'
const FAKE_SERVER_OPTIONS: FakeAuthorizationServerOptions = { rotation: 'strict' }
const TEST_GRANT_DEFAULT_SCOPES = ['test.read', 'test.write']
const TEST_GRANT_REDIRECT_PATH = '/callback'
const TOKEN_FAILURES: ReadonlySet<string> = new Set<OAuthTokenFailure>([
  'transient',
  'grant_invalidated',
  'client_misconfigured',
  'not_connected',
  'platform_unavailable',
])

const testOAuthGrantRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('connect'),
    integrationId: z.string(),
    scopes: z.array(z.string().min(1)).max(10).optional(),
  }),
  z.object({
    action: z.literal('refresh'),
    integrationId: z.string(),
    outcome: z.enum(['success', 'invalid_grant', 'invalid_client', 'temporarily_unavailable']).default('success'),
  }),
  z.object({ action: z.literal('corruptGrant'), integrationId: z.string() }),
  z.object({ action: z.literal('reset'), integrationId: z.string() }),
])

type TestOAuthGrantRequest = z.infer<typeof testOAuthGrantRequestSchema>
type RefreshOutcome = Extract<TestOAuthGrantRequest, { action: 'refresh' }>['outcome']
type RefreshResult = { result: 'ok' | OAuthTokenFailure; degraded: boolean }
type AuthenticatedContext = Exclude<AuthContext, null>
type RbacFeatureChecker = {
  userHasAllFeatures(
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<boolean>
}
type FakeServerGlobal = typeof globalThis & {
  [FAKE_SERVER_GLOBAL_KEY]?: Promise<FakeAuthorizationServer>
}

function notFound(): Response {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

function forbidden(): Response {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

function invalidBody(issues: z.ZodError['issues']): Response {
  return NextResponse.json({ error: 'Invalid request body', issues }, { status: 400 })
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function actsInAnotherTenant(auth: AuthenticatedContext): boolean {
  if (!('actorTenantId' in auth)) return false
  const actorTenantId = normalizeId(auth.actorTenantId)
  return actorTenantId === null || actorTenantId !== normalizeId(auth.tenantId)
}

function createRandomDekKms(): KmsService {
  const key = randomBytes(32).toString('base64')
  const issue = async (tenantId: string): Promise<TenantDek> => ({ tenantId, key, fetchedAt: Date.now() })
  return { isHealthy: () => true, getTenantDek: issue, createTenantDek: issue }
}

function startFakeServerInSlot(slot: FakeServerGlobal): Promise<FakeAuthorizationServer> {
  const starting = import('@open-mercato/core/modules/integrations/lib/oauth/testing/fakeAuthorizationServer')
    .then(({ startFakeAuthorizationServer }) => startFakeAuthorizationServer(FAKE_SERVER_OPTIONS))
  slot[FAKE_SERVER_GLOBAL_KEY] = starting
  return starting
}

async function ensureFakeServer(): Promise<FakeAuthorizationServer> {
  const slot = globalThis as FakeServerGlobal
  const pending = slot[FAKE_SERVER_GLOBAL_KEY]
  if (!pending) return startFakeServerInSlot(slot)
  const server = await pending.catch(() => null)
  if (server) return server
  if (slot[FAKE_SERVER_GLOBAL_KEY] === pending) delete slot[FAKE_SERVER_GLOBAL_KEY]
  return ensureFakeServer()
}

function buildTestGrantDescriptor(server: FakeAuthorizationServer): OAuthProviderDescriptor {
  return {
    integrationId: TEST_OAUTH_GRANT_INTEGRATION_ID,
    authorizationEndpoint: server.authorizationEndpoint,
    tokenEndpoint: server.tokenEndpoint,
    ...(server.revocationEndpoint ? { revocationEndpoint: server.revocationEndpoint } : {}),
    defaultScopes: TEST_GRANT_DEFAULT_SCOPES,
  }
}

async function connectThroughFakeServer(input: {
  container: AppContainer
  scope: { tenantId: string; organizationId: string }
  scopes: string[] | undefined
  actorUserId: string
}): Promise<{ reconnect: boolean; revisedAt: Date }> {
  const server = await ensureFakeServer()
  const client = { clientId: server.clientId, clientSecret: server.clientSecret }
  await input.container
    .resolve<CredentialsService>('integrationCredentialsService')
    .save(TEST_OAUTH_GRANT_INTEGRATION_ID, client, input.scope)
  const descriptor = buildTestGrantDescriptor(server)
  const redirectUri = new URL(TEST_GRANT_REDIRECT_PATH, server.authorizationEndpoint).toString()
  const pkce = createPkcePair()
  const code = server.issueAuthorizationCode({
    redirectUri,
    scope: input.scopes ?? descriptor.defaultScopes,
    codeChallenge: pkce.codeChallenge,
  })
  const tokenResponse = await exchangeAuthorizationCode(descriptor, client, {
    code,
    redirectUri,
    codeVerifier: pkce.codeVerifier,
  })
  const grantService = input.container.resolve<IntegrationOAuthGrantService>('integrationOAuthGrantService')
  return grantService.completeConnect(
    descriptor,
    { integrationId: TEST_OAUTH_GRANT_INTEGRATION_ID, ...input.scope },
    tokenResponse,
    { clientId: client.clientId, requestedScopes: input.scopes, actorUserId: input.actorUserId },
  )
}

const REFRESH_OUTCOME_INJECTIONS: Record<Exclude<RefreshOutcome, 'success'>, FakeInjection> = {
  invalid_grant: { endpoint: 'token', grantType: 'refresh_token', status: 400, body: { error: 'invalid_grant' } },
  invalid_client: { endpoint: 'token', grantType: 'refresh_token', status: 401, body: { error: 'invalid_client' } },
  temporarily_unavailable: {
    endpoint: 'token',
    grantType: 'refresh_token',
    status: 400,
    body: { error: 'temporarily_unavailable' },
  },
}

function isTokenFailure(code: string): code is OAuthTokenFailure {
  return TOKEN_FAILURES.has(code)
}

async function refreshThroughFakeServer(input: {
  container: AppContainer
  scope: { tenantId: string; organizationId: string }
  outcome: RefreshOutcome
}): Promise<RefreshResult> {
  const server = await ensureFakeServer()
  if (input.outcome !== 'success') server.inject(REFRESH_OUTCOME_INJECTIONS[input.outcome])
  const grantService = input.container.resolve<IntegrationOAuthGrantService>('integrationOAuthGrantService')
  try {
    const token = await grantService.getAccessToken(
      buildTestGrantDescriptor(server),
      { integrationId: TEST_OAUTH_GRANT_INTEGRATION_ID, ...input.scope },
      { forceRefresh: true },
    )
    return { result: 'ok', degraded: token.degraded }
  } catch (error) {
    if (error instanceof OAuthGrantError && isTokenFailure(error.code)) return { result: error.code, degraded: false }
    throw error
  } finally {
    server.takePendingInjections()
  }
}

async function clearFakeServerOutcomes(): Promise<void> {
  const slot = globalThis as FakeServerGlobal
  const pending = slot[FAKE_SERVER_GLOBAL_KEY]
  if (!pending) return
  const server = await pending.catch(() => null)
  if (server) server.reset()
  else delete slot[FAKE_SERVER_GLOBAL_KEY]
}

export async function POST(req: Request): Promise<Response> {
  if (!isTestOAuthGrantsEnabled()) return notFound()

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = normalizeId(auth.tenantId)
  if (!tenantId) return organizationScopeRequiredResponse()

  const parsed = testOAuthGrantRequestSchema.safeParse(await readJsonSafe(req, null))
  if (!parsed.success) return invalidBody(parsed.error.issues)
  if (parsed.data.integrationId !== TEST_OAUTH_GRANT_INTEGRATION_ID) return notFound()

  if (actsInAnotherTenant(auth)) return forbidden()
  const container = await createRequestContainer()
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  if (isExplicitlyEmptyOrganizationScope(organizationScope)) return forbidden()
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const rbacService = container.resolve<RbacFeatureChecker>('rbacService')
  const canManageCredentials = await rbacService.userHasAllFeatures(auth.sub, [CREDENTIALS_MANAGE_FEATURE], {
    tenantId,
    organizationId,
  })
  if (!canManageCredentials) return forbidden()

  const guard = await runRouteMutationGuards({
    container,
    req,
    auth: { userId: auth.sub, tenantId, organizationId },
    input: {
      resourceKind: OAUTH_GRANT_RESOURCE_KIND,
      resourceId: GRANT_ROW_ID,
      operation: 'custom',
      mutationPayload: parsed.data,
    },
  })
  if (!guard.ok) return guard.response

  const guarded = guard.modifiedPayload
    ? testOAuthGrantRequestSchema.safeParse({ ...parsed.data, ...guard.modifiedPayload })
    : parsed
  if (!guarded.success) return invalidBody(guarded.error.issues)
  const request: TestOAuthGrantRequest = guarded.data
  if (request.integrationId !== TEST_OAUTH_GRANT_INTEGRATION_ID) return notFound()

  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId, organizationId }

  if (request.action === 'refresh') {
    const refreshed = await refreshThroughFakeServer({ container, scope, outcome: request.outcome })
    await guard.runAfterSuccess()
    return NextResponse.json(refreshed)
  }

  if (request.action === 'connect') {
    let connected: { reconnect: boolean; revisedAt: Date }
    try {
      connected = await connectThroughFakeServer({ container, scope, scopes: request.scopes, actorUserId: auth.sub })
    } catch (error) {
      if (error instanceof OAuthGrantError) {
        return NextResponse.json({ error: 'OAuth connect failed', code: error.code }, { status: 409 })
      }
      throw error
    }
    await guard.runAfterSuccess()
    return NextResponse.json({ reconnect: connected.reconnect, revisedAt: connected.revisedAt.toISOString() })
  }

  if (request.action === 'corruptGrant') {
    const corrupting = createCredentialsService(em, null, { kms: createRandomDekKms() })
    const liveSince = await corrupting.getRowUpdatedAt(GRANT_ROW_ID, scope)
    if (!liveSince) return NextResponse.json({ corrupted: false })
    await corrupting.save(GRANT_ROW_ID, { corrupted: true }, scope)
    await guard.runAfterSuccess()
    return NextResponse.json({ corrupted: true })
  }

  await eraseIntegrationCredentials(em, GRANT_ROW_ID, scope)
  await eraseIntegrationCredentials(em, TEST_OAUTH_GRANT_INTEGRATION_ID, scope)
  await clearFakeServerOutcomes()
  await guard.runAfterSuccess()
  return NextResponse.json({ ok: true })
}

const errorResponseSchema = z.object({ error: z.string(), code: z.string().optional() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Integrations',
  summary: 'Test-only OAuth grant driver for the test_oauth_grant integration',
  methods: {
    POST: {
      summary: 'Test-only: connect, refresh, corrupt or reset the test_oauth_grant grant (OM_ENABLE_TEST_OAUTH_GRANTS)',
      description:
        'refresh configures the fake token endpoint outcome, then forces one refresh; result is ok or the Token Failure, and degraded is true when a still valid stored token was returned instead of a refreshed one.',
      tags: ['Integrations'],
      requestBody: { schema: testOAuthGrantRequestSchema },
      responses: [
        {
          status: 200,
          description: 'connect: { reconnect, revisedAt }; refresh: { result, degraded }; corruptGrant: { corrupted }; reset: { ok }',
          schema: z.union([
            z.object({ reconnect: z.boolean(), revisedAt: z.string() }),
            z.object({
              result: z.enum(['ok', 'transient', 'grant_invalidated', 'client_misconfigured', 'not_connected', 'platform_unavailable']),
              degraded: z.boolean(),
            }),
            z.object({ corrupted: z.boolean() }),
            z.object({ ok: z.literal(true) }),
          ]),
        },
      ],
      errors: [
        {
          status: 400,
          description: 'Invalid request body, or the organization scope cannot be resolved (code organization_scope_required)',
          schema: errorResponseSchema,
        },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        {
          status: 403,
          description: 'Acting in another tenant, an explicitly empty organization scope, or no integrations.credentials.manage in the resolved organization',
          schema: errorResponseSchema,
        },
        {
          status: 404,
          description: 'OM_ENABLE_TEST_OAUTH_GRANTS is off (production default), or the integration is not test_oauth_grant',
          schema: errorResponseSchema,
        },
        {
          status: 409,
          description: 'connect: the grant service refused the Connect (code is the OAuth Connect Failure)',
          schema: errorResponseSchema,
        },
      ],
    },
  },
}

export default POST
