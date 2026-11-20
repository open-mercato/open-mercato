import { randomBytes } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SyncCursor } from '@open-mercato/core/modules/data_sync/data/entities'
import type { ExternalIdMappingService } from '@open-mercato/core/modules/data_sync/lib/id-mapping'
import type { SyncScheduleService } from '@open-mercato/core/modules/data_sync/lib/sync-schedule-service'
import type { createSyncRunService } from '@open-mercato/core/modules/data_sync/lib/sync-run-service'
import { SyncExternalIdMapping } from '@open-mercato/core/modules/integrations/data/entities'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationOAuthGrantService } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { startFakeAuthorizationServer } from '@open-mercato/core/modules/integrations/lib/oauth/testing/fakeAuthorizationServer'
import { XERO_INTEGRATION_ID, XERO_SCOPES, XERO_SUPPORTED_ENTITY_TYPES } from '../constants'
import { createXeroDescriptor } from '../descriptor'
import { hasXeroSyncHistory } from '../organisation'
import { buildXeroGrantOwner, type XeroScope } from '../owner'
import { startFakeXeroApi } from './fakeXeroApi'
import { isSeamClientId, seamRegistry, XERO_SEAM_CLIENT_ID_PREFIX, type XeroSeamFakes } from './seam'

type SyncRunService = ReturnType<typeof createSyncRunService>

const STRICT_GRACE_MS = 30 * 60 * 1000
const ACCESS_TOKEN_TTL_SEC = 1800
const PLACEHOLDER_AUTHORIZE = 'http://127.0.0.1:9/authorize'
const PLACEHOLDER_TOKEN = 'http://127.0.0.1:9/token'

const organisationSchema = z.object({
  tenantId: z.string().min(1),
  connectionId: z.string().min(1),
  name: z.string().min(1),
  authEventId: z.string().optional(),
  tenantType: z.enum(['ORGANISATION', 'PRACTICE']).optional(),
})

const contactSchema = z.object({ ContactID: z.string().min(1), UpdatedDateUTC: z.string().min(1) }).passthrough()

export const seamActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({
    action: z.literal('seed'),
    organisations: z.array(organisationSchema).max(10).optional(),
    contacts: z.record(z.string(), z.array(contactSchema).max(5000)).optional(),
    mappings: z.array(z.object({ localId: z.guid(), externalId: z.string().min(1).max(200) })).max(100).optional(),
  }),
  z.object({
    action: z.literal('inject'),
    target: z.enum(['xero', 'token']),
    status: z.number().int().min(100).max(599),
    path: z.enum(['connections', 'contacts']).optional(),
    retryAfter: z.number().int().nonnegative().optional(),
    rateLimitProblem: z.string().max(20).optional(),
    wwwAuthenticate: z.string().max(200).optional(),
    errorCode: z.string().max(60).optional(),
    times: z.number().int().positive().max(20).optional(),
  }),
  z.object({
    action: z.literal('authorize'),
    redirectUri: z.string().url(),
    codeChallenge: z.string().min(43).max(128),
    scope: z.array(z.string().min(1)).max(10).optional(),
  }),
  z.object({ action: z.literal('counters') }),
  z.object({ action: z.literal('reset') }),
])

export type SeamAction = z.infer<typeof seamActionSchema>

export type SeamControlContext = {
  container: AppContainer
  scope: XeroScope
  userId: string
}

export class SeamConflictError extends Error {
  constructor(readonly reason: 'not_seam_organization' | 'real_xero_state' | 'not_started') {
    super(`[internal] sync_xero test seam refused: ${reason}`)
    this.name = 'SeamConflictError'
  }
}

function services(container: AppContainer) {
  return {
    credentials: container.resolve<CredentialsService>('integrationCredentialsService'),
    grants: container.resolve<IntegrationOAuthGrantService>('integrationOAuthGrantService'),
    em: container.resolve<EntityManager>('em'),
  }
}

async function readClientId(container: AppContainer, scope: XeroScope): Promise<string | null> {
  const credentials = await services(container).credentials.getRaw(XERO_INTEGRATION_ID, scope)
  const clientId = credentials?.clientId
  return typeof clientId === 'string' && clientId.trim().length > 0 ? clientId.trim() : null
}

export async function belongsToSeam(container: AppContainer, scope: XeroScope): Promise<boolean> {
  if (seamRegistry().has(scope.organizationId)) return true
  return isSeamClientId(await readClientId(container, scope))
}

async function holdsXeroState(container: AppContainer, scope: XeroScope): Promise<boolean> {
  const { grants, em } = services(container)
  if ((await grants.readGrantStatus(XERO_INTEGRATION_ID, scope)) !== null) return true
  if (await hasXeroSyncHistory(em, scope)) return true
  return (await readClientId(container, scope)) !== null
}

function requireFakes(scope: XeroScope): XeroSeamFakes {
  const fakes = seamRegistry().get(scope.organizationId)
  if (!fakes) throw new SeamConflictError('not_started')
  return fakes
}

async function closeFakes(fakes: XeroSeamFakes): Promise<void> {
  await Promise.allSettled([fakes.authorizationServer.close(), fakes.xeroApi.close()])
}

export async function startSeam(
  context: SeamControlContext,
): Promise<{ started: true; clientId: string; authorizationEndpoint: string }> {
  const { container, scope } = context
  const running = seamRegistry().get(scope.organizationId)
  if (running) {
    running.authorizationServer.reset()
    running.xeroApi.reset()
    return { started: true, clientId: running.authorizationServer.clientId, authorizationEndpoint: running.authorizationServer.authorizationEndpoint }
  }
  if (!(await belongsToSeam(container, scope)) && (await holdsXeroState(container, scope))) {
    throw new SeamConflictError('real_xero_state')
  }
  const clientId = `${XERO_SEAM_CLIENT_ID_PREFIX}${randomBytes(8).toString('hex')}`
  const clientSecret = randomBytes(24).toString('base64url')
  const authorizationServer = await startFakeAuthorizationServer({
    rotation: 'strict',
    strictGraceMs: STRICT_GRACE_MS,
    accessTokenTtlSec: ACCESS_TOKEN_TTL_SEC,
    clientId,
    clientSecret,
  })
  const xeroApi = await startFakeXeroApi({
    isTokenValid: (accessToken) => authorizationServer.issuedTokens().accessTokens.includes(accessToken),
  })
  seamRegistry().set(scope.organizationId, { authorizationServer, xeroApi })
  const { credentials } = services(container)
  const current = (await credentials.getRaw(XERO_INTEGRATION_ID, scope)) ?? {}
  await credentials.save(XERO_INTEGRATION_ID, { ...current, clientId, clientSecret }, scope)
  return { started: true, clientId, authorizationEndpoint: authorizationServer.authorizationEndpoint }
}

export async function seedSeam(
  context: SeamControlContext,
  input: Extract<SeamAction, { action: 'seed' }>,
): Promise<{ seeded: true; mappings: number }> {
  const fakes = requireFakes(context.scope)
  fakes.xeroApi.seed({ organisations: input.organisations, contacts: input.contacts })
  const mappingService = context.container.resolve<ExternalIdMappingService>('externalIdMappingService')
  for (const mapping of input.mappings ?? []) {
    await mappingService.storeExternalIdMapping(XERO_INTEGRATION_ID, 'customers.company', mapping.localId, mapping.externalId, context.scope)
  }
  return { seeded: true, mappings: input.mappings?.length ?? 0 }
}

export function injectSeam(context: SeamControlContext, input: Extract<SeamAction, { action: 'inject' }>): { injected: true } {
  const fakes = requireFakes(context.scope)
  if (input.target === 'xero') {
    fakes.xeroApi.inject({
      status: input.status,
      path: input.path,
      retryAfter: input.retryAfter,
      rateLimitProblem: input.rateLimitProblem,
      wwwAuthenticate: input.wwwAuthenticate,
      times: input.times,
    })
  } else {
    fakes.authorizationServer.inject({
      endpoint: 'token',
      status: input.status,
      body: input.errorCode ? { error: input.errorCode } : undefined,
      times: input.times,
    })
  }
  return { injected: true }
}

export function authorizeSeam(context: SeamControlContext, input: Extract<SeamAction, { action: 'authorize' }>): { code: string } {
  const fakes = requireFakes(context.scope)
  return {
    code: fakes.authorizationServer.issueAuthorizationCode({
      redirectUri: input.redirectUri,
      scope: input.scope ?? [...XERO_SCOPES],
      codeChallenge: input.codeChallenge,
    }),
  }
}

export function seamCounters(context: SeamControlContext) {
  const fakes = requireFakes(context.scope)
  return { authorizationServer: fakes.authorizationServer.counters(), xeroApiRequests: fakes.xeroApi.requests().length }
}

async function eraseSeamMappings(container: AppContainer, scope: XeroScope): Promise<number> {
  const { em } = services(container)
  const rows = await findWithDecryption(
    em,
    SyncExternalIdMapping,
    { integrationId: XERO_INTEGRATION_ID, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  const byType = new Map<string, string[]>()
  for (const row of rows) byType.set(row.internalEntityType, [...(byType.get(row.internalEntityType) ?? []), row.internalEntityId])
  const mappingService = container.resolve<ExternalIdMappingService>('externalIdMappingService')
  let erased = 0
  for (const [entityType, localIds] of byType) {
    erased += await mappingService.deleteExternalIdMappings(XERO_INTEGRATION_ID, entityType, localIds, scope)
  }
  return erased
}

async function eraseSeamSchedulesAndCursors(container: AppContainer, scope: XeroScope): Promise<void> {
  const schedules = container.resolve<SyncScheduleService>('dataSyncScheduleService')
  const runs = container.resolve<SyncRunService>('dataSyncRunService')
  for (const entityType of XERO_SUPPORTED_ENTITY_TYPES) {
    const schedule = await schedules.getByKey(XERO_INTEGRATION_ID, entityType, 'import', scope)
    if (schedule) await schedules.deleteSchedule(schedule.id, scope)
    await runs.resetResumePosition(XERO_INTEGRATION_ID, entityType, 'import', scope)
  }
  await services(container).em.nativeDelete(SyncCursor, {
    integrationId: XERO_INTEGRATION_ID,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}

/**
 * Erases only the seam's rows: the grant (forced, through a descriptor without a revocation
 * endpoint, so the seam's secrets reach no endpoint), the schedules, the mappings, the cursors and
 * the Client Configuration. It works whether or not the fakes still run, then stops them.
 */
export async function resetSeam(context: SeamControlContext): Promise<{ reset: true; mappings: number }> {
  const { container, scope, userId } = context
  if (!(await belongsToSeam(container, scope))) throw new SeamConflictError('not_seam_organization')
  const fakes = seamRegistry().get(scope.organizationId)
  const descriptor = createXeroDescriptor({
    authorize: fakes?.authorizationServer.authorizationEndpoint ?? PLACEHOLDER_AUTHORIZE,
    token: fakes?.authorizationServer.tokenEndpoint ?? PLACEHOLDER_TOKEN,
  })
  const { grants, credentials } = services(container)
  await grants.disconnect(descriptor, buildXeroGrantOwner(scope), { force: true, expectedRevisedAt: null, actorUserId: userId })
  await eraseSeamSchedulesAndCursors(container, scope)
  const mappings = await eraseSeamMappings(container, scope)
  const current = (await credentials.getRaw(XERO_INTEGRATION_ID, scope)) ?? {}
  await credentials.save(XERO_INTEGRATION_ID, { ...current, clientId: '', clientSecret: '' }, scope)
  if (fakes) {
    seamRegistry().delete(scope.organizationId)
    await closeFakes(fakes)
  }
  return { reset: true, mappings }
}
