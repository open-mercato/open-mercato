import { isDeepStrictEqual } from 'node:util'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { AuthContext } from '../../auth/server'
import { withAtomicFlush } from '../../commands/flush'
import { getTransactionLifetime, ownsTransactionLifetime } from '../../commands/transaction-lifetime'
import {
  isAmbientCommandExecution,
  type AmbientCommandExecution,
  type CommandRuntimeContext,
} from '../../commands/types'
import { createLogger } from '../../logger'
import { reportTelemetryError } from '../../telemetry/runtime'
import { isRecord } from '../../utils'
import { readBoundedRequestBytes, WebhookBodyTooLargeError } from '../../webhooks/body'
import type { CrudFormSectionAddress, CrudFormSectionMutationSurfaceFact } from '../../../modules/form-section-facts'
import type { CrudFormSectionHostAssertion } from '../../../modules/form-sections'
import { matchRoutePattern, type RouteMatchParams } from '../../../modules/registry'
import { loadCustomFieldDefinitionIndex } from '../custom-fields'
import { selectDefinitionForRecord } from '../custom-field-definition-index'
import { CrudHttpError, isCrudHttpError } from '../errors'
import { bridgeLegacyGuard, runMutationGuards, type MutationGuardInput } from '../mutation-guard-registry'
import { getAllMutationGuardInstances } from '../mutation-guard-store'
import { normalizeIsoToken } from '../optimistic-lock'
import { enforceRecordGoneIsConflict } from '../optimistic-lock-command'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '../optimistic-lock-headers'
import { compareSectionIds, crudFormSectionHostKey, hasCrudFormSectionWritableLeaves } from './composition'
import {
  appendCrudFormSectionSinkSnapshot,
  persistCrudFormSectionSink,
  prepareCrudFormSectionSinks,
  reportCrudFormSectionSinkFailure,
  selectCrudFormSectionHostDeleteSinks,
  type PreparedCrudFormSectionSinks,
} from './extension-sinks'
import { validateCompiledCrudFormFieldRules } from './compiled-extensions'
import { getCrudFormSectionManifest, type CrudFormSectionAcceptedPolicy } from './manifest'
import {
  assertPrevalidatedCrudFormSectionOutbox,
  crudFormSectionOutboxScopeSchema,
  crudFormSectionOutboxServiceKey,
  preflightCrudFormSectionOutboxIntent,
  prevalidateCrudFormSectionOutbox,
  retryCrudFormSectionOutbox,
} from './outbox'
import { parseCrudFormSectionPolicyHeaders } from './policy-headers'
import { decodeCrudFormSectionPolicyToken, encodeCurrentCrudFormSectionPolicyToken } from './policy-token'
import { resourceIdSchema, symbolicIdSchema } from './protocol'
import {
  hasRequiredLeafValue,
  prepareCrudFormRequiredLeaves,
  projectCrudFormLeafPaths,
  readCrudFormRequiredLeaf,
  type CrudFormRequiredLeafCoverage,
} from './required-leaves'

const logger = createLogger('shared:crud-form-sections')

type HostAddress = Omit<CrudFormSectionAddress, 'sectionId'>
type PayloadRecord = Record<string, unknown>
type HiddenLeaf = Exclude<CrudFormRequiredLeafCoverage, { mode: 'section' }>
type Scope = {
  tenantId: string
  organizationId: string | null
  allowedOrganizationIds: readonly string[] | null
}
type RbacService = {
  userHasAllFeatures(userId: string, features: string[], scope: Scope): Promise<boolean>
  getGrantedFeatures(userId: string, scope: Scope): Promise<string[]>
}

export type CrudFormSectionMutationIdentity = {
  address: HostAddress
  host: CrudFormSectionHostAssertion
  target: {
    resourceKind: string
    resourceId?: string
  }
  resourceBindingIds: readonly string[]
}

type AuthorizedRoute = CrudFormSectionMutationIdentity & {
  targetOrganizationId: string | null
  customFieldDefinitions?: ReadonlyMap<string, ReadonlySet<string>>
}

type AuthorizedContext = {
  auth: NonNullable<AuthContext>
  container: AwilixContainer
  scope: Scope
  route: AuthorizedRoute
  policy: CrudFormSectionAcceptedPolicy
  transactionalEm?: EntityManager
}

type MutableCommandContext = Required<Pick<CommandRuntimeContext,
  'transactionalEm' | 'transactionLifetime' | 'beforeTransactionalWrite'>>

type ExtensionAuditService = {
  updateTransactionalContext(
    input: { id: string; tenantId: string; organizationId: string | null; context: PayloadRecord },
    em: EntityManager,
  ): Promise<boolean>
}

export type CrudFormSectionMutationFacadeOptions<Payload extends PayloadRecord, Result> = {
  request: Request
  auth: AuthContext
  container: AwilixContainer
  scope: Scope | null
  routePattern: string
  method: CrudFormSectionMutationSurfaceFact['guardedFacade']['method']
  requiredFeatures: readonly string[]
  mutationSurfaceId: string
  requestOperation: string
  delegatedTarget: CrudFormSectionMutationSurfaceFact['delegatedTarget']
  bodySchema: z.ZodType<Payload>
  maxBodyBytes: number
  authorizeRoute(input: {
    auth: NonNullable<AuthContext>
    container: AwilixContainer
    scope: Scope
    params: RouteMatchParams
    query: URLSearchParams
  }): Promise<AuthorizedRoute | null>
  prevalidateProjectedPayload?(payload: Readonly<PayloadRecord>, context: AuthorizedContext): Promise<void>
  preparePayload?(payload: PayloadRecord, context: AuthorizedContext): Promise<{
    payload: PayloadRecord
    serverPayloadPaths: readonly string[]
  }>
  hiddenLeafErrorPath?(error: unknown, context: AuthorizedContext): string | undefined
  validateDomain(payload: Payload, context: AuthorizedContext): void | Promise<void>
  validateFields?(payload: Payload & { extensions?: PayloadRecord }, context: AuthorizedContext): Promise<Record<string, string>>
  projectFinalInput(input: unknown, context: AuthorizedContext): (CrudFormSectionMutationIdentity & {
    payload: PayloadRecord
    targetOrganizationId: string | null
    expectedUpdatedAt: string | null
  }) | null
  beforeTransactionalWrite?: CommandRuntimeContext['beforeTransactionalWrite']
  beforeExecute?(payload: Payload, context: AuthorizedContext): Promise<void>
  execute(input: {
    payload: Payload
    context: AuthorizedContext
    commandContext: MutableCommandContext
    expectedUpdatedAt: string | null
  }): Promise<Result | AmbientCommandExecution<Result>>
} & (
  | { operation: 'create'; resolveCommittedResourceId(result: Result): string }
  | { operation: 'update' }
  | { operation: 'delete'; deleteMode?: 'hard' | 'soft' }
)

function withExtensions<Payload extends PayloadRecord>(payload: Payload, envelope: PayloadRecord): Payload & { extensions?: PayloadRecord } {
  return Object.keys(envelope).length ? { ...payload, extensions: envelope } : payload
}

function sinkVersions(sinks: PreparedCrudFormSectionSinks): Map<string, string> {
  return new Map(sinks.work.flatMap(({ runtime, expectedUpdatedAt }) =>
    expectedUpdatedAt ? [[runtime.fact.id, expectedUpdatedAt] as const] : []))
}

function policyDiagnosticAddress({ hostId, formVariant, formOperation }: HostAddress): HostAddress {
  return { hostId, formVariant, formOperation }
}

function rejectPolicy(address: HostAddress, reason: string): never {
  logger.warn('Rejected CrudForm section mutation', { ...policyDiagnosticAddress(address), reason })
  throw new CrudHttpError(409, {
    error: 'extension_policy_mismatch',
    code: 'extension_policy_mismatch',
  })
}

function guardRejection(details: Record<string, unknown>): CrudHttpError {
  return new CrudHttpError(422, {
    error: 'mutation_guard_rejected',
    code: 'mutation_guard_rejected',
    details,
  })
}

function rejectUnauthorized(): never {
  throw new CrudHttpError(404, { error: 'not_found' })
}

function freezeFacts<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) freezeFacts(entry)
    Object.freeze(value)
  }
  return value
}

function copyCustomFieldDefinitions(source: AuthorizedRoute['customFieldDefinitions']): AuthorizedRoute['customFieldDefinitions'] {
  return source && new Map([...source].map(([id, paths]) => [id, new Set(paths)]))
}

function snapshotRoute(authorized: AuthorizedRoute): AuthorizedRoute {
  const { hostResourceKind, hostResourceId } = authorized.host
  const { resourceKind, resourceId } = authorized.target
  return Object.freeze({
    address: Object.freeze(policyDiagnosticAddress(authorized.address)),
    targetOrganizationId: authorized.targetOrganizationId,
    host: Object.freeze({ hostResourceKind, hostResourceId }),
    target: Object.freeze({ resourceKind, resourceId }),
    resourceBindingIds: Object.freeze([...authorized.resourceBindingIds]),
    customFieldDefinitions: copyCustomFieldDefinitions(authorized.customFieldDefinitions),
  })
}

function validResource(kind: string, id?: string): boolean {
  return symbolicIdSchema.safeParse(kind).success && (id === undefined || resourceIdSchema.safeParse(id).success)
}

function exactIds(left: readonly string[], right: readonly string[] = []): boolean {
  return left.length === right.length && isDeepStrictEqual([...left].sort(compareSectionIds), [...right].sort(compareSectionIds))
}

function sameHost(left: CrudFormSectionHostAssertion, right: CrudFormSectionHostAssertion): boolean {
  return left.hostResourceKind === right.hostResourceKind && left.hostResourceId === right.hostResourceId
}

function sameIdentity(expected: CrudFormSectionMutationIdentity, input: CrudFormSectionMutationIdentity): boolean {
  return crudFormSectionHostKey(expected.address) === crudFormSectionHostKey(input.address)
    && sameHost(expected.host, input.host)
    && expected.target.resourceKind === input.target.resourceKind
    && expected.target.resourceId === input.target.resourceId
    && exactIds(expected.resourceBindingIds, input.resourceBindingIds)
}

function validSurfaceOperation(
  surface: CrudFormSectionMutationSurfaceFact,
  route: AuthorizedRoute,
  operation: MutationGuardInput['operation'],
): boolean {
  if (['create', 'update', 'delete'].includes(surface.requestOperation) && surface.requestOperation !== operation) return false
  if ((operation === 'create') !== (route.target.resourceId === undefined)) return false
  if (surface.kind === 'section-action') return true
  if (route.host.hostResourceKind !== route.target.resourceKind || route.host.hostResourceId !== route.target.resourceId) return false
  return surface.kind === 'parent-delete' ? operation === 'delete' && route.address.formOperation === 'update'
    : operation === route.address.formOperation
}

function checkPolicyIdentity<Payload extends PayloadRecord, Result>(
  options: CrudFormSectionMutationFacadeOptions<Payload, Result>,
  context: AuthorizedContext,
  fingerprint: string,
  requestHeaders: Headers,
): CrudFormSectionMutationSurfaceFact {
  const { address, host, target, resourceBindingIds } = context.route
  const { policy } = context
  const headers = parseCrudFormSectionPolicyHeaders(requestHeaders)
  const token = headers && decodeCrudFormSectionPolicyToken(headers.policyToken)
  if (!headers || !token
      || headers.fingerprint !== fingerprint || !sameHost(headers, host)
      || headers.mutationSurfaceId !== options.mutationSurfaceId
      || headers.requestOperation !== options.requestOperation
      || headers.mutationResourceKind !== target.resourceKind || headers.mutationResourceId !== target.resourceId
      || policy.hostResourceKind !== host.hostResourceKind
      || headers.policyToken !== encodeCurrentCrudFormSectionPolicyToken({ address, host, policy, fingerprint })) {
    return rejectPolicy(address, 'request_assertion_mismatch')
  }
  const surface = policy.mutationSurfaces.find(({ id }) => id === options.mutationSurfaceId)
  if (!surface || !policy.surface.mutationSurfaceIds.includes(surface.id)
      || surface.guardedFacade.method !== options.method || surface.guardedFacade.routePattern !== options.routePattern
      || surface.requestOperation !== options.requestOperation
      || surface.hostResourceKind !== host.hostResourceKind || surface.mutationResourceKind !== target.resourceKind
      || surface.delegatedTarget.kind !== options.delegatedTarget.kind || surface.delegatedTarget.id !== options.delegatedTarget.id
      || !exactIds(resourceBindingIds, surface.resourceBindingIds)
      || resourceBindingIds.some((id) => !policy.bindings.some((binding) => binding.id === id))
      || !validSurfaceOperation(surface, context.route, options.operation)) {
    return rejectPolicy(address, 'mutation_surface_mismatch')
  }
  return surface
}

function expectedVersion(
  headers: Headers,
  surface: CrudFormSectionMutationSurfaceFact,
  address: HostAddress,
  operation: MutationGuardInput['operation'],
): string | null {
  const value = headers.get(OPTIMISTIC_LOCK_HEADER_NAME)
  if ((value === null && surface.optimisticLock === 'target-required') || (value !== null && operation === 'create')) {
    return rejectPolicy(address, 'target_version_mismatch')
  }
  if (value === null || surface.optimisticLock === 'none') return null
  const normalized = value.includes(',') ? null : normalizeIsoToken(value)
  if (!normalized) throw new CrudHttpError(400, { error: 'invalid_request' })
  return normalized
}

function hiddenLeafError(address: HostAddress, leaf: HiddenLeaf): never {
  logger.warn('CrudForm section hidden leaf is invalid', {
    ...policyDiagnosticAddress(address), payloadPath: leaf.payloadPath, coverage: leaf.mode,
  })
  throw new CrudHttpError(422, {
    error: 'crud_form_section_hidden_field_invalid',
    code: 'crud_form_section_hidden_field_invalid',
    fieldLabelKey: leaf.fieldLabelKey,
  })
}

function validationErrorPaths(error: unknown): string[] {
  if (error instanceof z.ZodError) return error.issues.map(({ path }) => path.join('.'))
  if (!isCrudHttpError(error)) return []
  const issues = error.body.details?.fieldErrors ?? error.body.fieldErrors
  return isRecord(issues) ? Object.keys(issues) : []
}

function reportedHiddenLeaf(
  leaves: readonly CrudFormRequiredLeafCoverage[],
  paths: readonly string[],
): HiddenLeaf | undefined {
  return leaves.find((leaf): leaf is HiddenLeaf => leaf.mode !== 'section'
    && paths.some((path) => path && (path === leaf.payloadPath
      || path.startsWith(`${leaf.payloadPath}.`) || leaf.payloadPath.startsWith(`${path}.`))))
}

function payloadLeaves(value: PayloadRecord, prefix = ''): string[] {
  const leaves: string[] = []
  const stack = [{ value, prefix }]
  const visited = new Set<PayloadRecord>()
  while (stack.length) {
    const entry = stack.pop()!
    if (visited.has(entry.value)) {
      leaves.push('')
      continue
    }
    visited.add(entry.value)
    for (const [key, child] of Object.entries(entry.value)) {
      const path = entry.prefix ? `${entry.prefix}.${key}` : key
      if (!key || key.includes('.')) {
        leaves.push('')
      } else if (entry.prefix === 'customFields') {
        leaves.push(path)
      } else if (isRecord(child) && Object.keys(child).length && !(child instanceof Date)) {
        stack.push({ value: child, prefix: path })
      } else {
        leaves.push(path)
      }
    }
  }
  return leaves
}

function ownsPayloadPath(path: string, context: AuthorizedContext, permitted: ReadonlySet<string>): boolean {
  if (permitted.has(path)) return true
  if (!path.startsWith('customFields.')) return false
  const id = path.slice('customFields.'.length)
  return context.policy.surface.ownershipFacts.some(({ customFieldOwnership }) => {
    if (customFieldOwnership.mode === 'none') return false
    if (customFieldOwnership.mode === 'ids') return customFieldOwnership.ids.includes(id)
    return context.route.customFieldDefinitions?.get(customFieldOwnership.definitionSetId)?.has(id) === true
  })
}

async function assertCompiledCustomFields(input: PayloadRecord, payload: PayloadRecord, context: AuthorizedContext, em: EntityManager): Promise<void> {
  if (!context.policy.compiledCustomFields?.length) return
  const { tenantId, organizationId } = context.scope
  const requested = context.policy.compiledCustomFields.filter(({ key }) =>
    readCrudFormRequiredLeaf(input, `customFields.${key}`) !== undefined
    || readCrudFormRequiredLeaf(payload, `customFields.${key}`) !== undefined)
  if (requested.some(({ key }) => readCrudFormRequiredLeaf(payload, `customFields.${key}`) === undefined)) {
    rejectPolicy(context.route.address, 'compiled_custom_field_dropped')
  }
  const entities = [...new Set(requested.map(({ entityId }) => entityId))]
  const definitions = new Map(await Promise.all(entities.map(async (entityId) => [entityId,
    await loadCustomFieldDefinitionIndex({ em, entityIds: entityId, tenantId, organizationIds: organizationId ? [organizationId] : [] }),
  ] as const)))
  if (requested.some(({ entityId, key, kind }) =>
    selectDefinitionForRecord(definitions.get(entityId)?.get(key) ?? [], organizationId, tenantId)?.kind !== kind)) {
    rejectPolicy(context.route.address, 'compiled_custom_field_definition_mismatch')
  }
}

function assertActivePayload(
  payload: PayloadRecord,
  context: AuthorizedContext,
  serverValues?: ReadonlyMap<string, unknown>,
): void {
  const permitted = new Set(context.policy.surface.ownershipFacts.flatMap(({ payloadPaths }) => payloadPaths))
  for (const path of payloadLeaves(payload)) {
    if (!path || (!serverValues?.has(path) && !ownsPayloadPath(path, context, permitted))) {
      rejectPolicy(context.route.address, 'inactive_payload_leaf')
    }
  }
  for (const [path, value] of serverValues ?? []) {
    if (!isDeepStrictEqual(readCrudFormRequiredLeaf(payload, path), value)) {
      rejectPolicy(context.route.address, 'server_payload_leaf_changed')
    }
  }
}

async function readPayload(request: Request, maxBytes: number): Promise<PayloadRecord> {
  let bytes: Uint8Array
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('[internal] Invalid form section body limit')
  try {
    bytes = await readBoundedRequestBytes(request, { maxBytes, awaitCancellation: false })
  } catch (error) {
    if (error instanceof WebhookBodyTooLargeError) throw new CrudHttpError(413, { error: 'payload_too_large' })
    throw new CrudHttpError(400, { error: 'invalid_request' })
  }
  if (!bytes.length) return {}
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new CrudHttpError(400, { error: 'invalid_request' })
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new CrudHttpError(400, { error: 'invalid_request' })
  }
  if (!isRecord(value)) throw new CrudHttpError(400, { error: 'invalid_request' })
  return value
}

function reportCallbackFailure(reason: string, attributes: Record<string, string>): void {
  const error = new Error('[internal] CrudForm section mutation callback failed')
  try {
    logger.error('CrudForm section mutation callback failed', { ...attributes, reason })
  } catch {}
  try {
    reportTelemetryError(error, {
      module: 'shared',
      code: 'crud_form_sections.guard_callback_failed',
      attributes: { ...attributes, reason },
    })
  } catch {}
}

export async function runCrudFormSectionMutation<Payload extends PayloadRecord, Result>(
  options: CrudFormSectionMutationFacadeOptions<Payload, Result>,
): Promise<Result> {
  const { request, container, auth } = options
  const requestHeaders = new Headers(request.headers)
  const suppliedScope = options.scope
  if (!auth) throw new CrudHttpError(401, { error: 'unauthorized' })
  if (!suppliedScope?.tenantId || suppliedScope.tenantId !== auth.tenantId || suppliedScope.allowedOrganizationIds?.length === 0) {
    return rejectUnauthorized()
  }
  const actorId = auth.sub
  const requestedScope = Object.freeze({
    tenantId: suppliedScope.tenantId,
    organizationId: suppliedScope.organizationId,
    allowedOrganizationIds: suppliedScope.allowedOrganizationIds ? Object.freeze([...suppliedScope.allowedOrganizationIds]) : null,
  })
  const rbac = container.resolve<RbacService>('rbacService')
  if (!await rbac.userHasAllFeatures(actorId, [...options.requiredFeatures], requestedScope)) {
    throw new CrudHttpError(403, { error: 'forbidden' })
  }
  const url = new URL(request.url)
  const params = matchRoutePattern(options.routePattern, url.pathname.replace(/^\/api(?=\/|$)/, ''))
  if (!params || request.method !== options.method) return rejectUnauthorized()
  const authorizedRoute = await options.authorizeRoute({ auth, container, scope: requestedScope, params, query: url.searchParams })
  if (!authorizedRoute || !validResource(authorizedRoute.host.hostResourceKind, authorizedRoute.host.hostResourceId)
      || !validResource(authorizedRoute.target.resourceKind, authorizedRoute.target.resourceId)
      || (authorizedRoute.address.formOperation === 'create') !== (authorizedRoute.host.hostResourceId === undefined)) {
    return rejectUnauthorized()
  }
  const route = snapshotRoute(authorizedRoute)
  const { targetOrganizationId } = route
  if (targetOrganizationId !== null && (!resourceIdSchema.safeParse(targetOrganizationId).success
      || (requestedScope.allowedOrganizationIds && !requestedScope.allowedOrganizationIds.includes(targetOrganizationId)))) {
    return rejectUnauthorized()
  }
  const scope = Object.freeze({ ...requestedScope, organizationId: targetOrganizationId })
  const manifest = getCrudFormSectionManifest()
  const fingerprint = manifest.ledger.fingerprint
  const hostKey = crudFormSectionHostKey(route.address)
  const provider = manifest.providers.get(hostKey)
  const accepted = manifest.policies.get(hostKey)
  if (!provider || provider.hostResourceKind !== route.host.hostResourceKind) return rejectUnauthorized()
  if (!await rbac.userHasAllFeatures(actorId,
    [...new Set([...options.requiredFeatures, ...(accepted?.requireFeatures ?? provider.requireFeatures)])], scope)) {
    throw new CrudHttpError(403, { error: 'forbidden' })
  }
  let host
  try {
    host = await provider.authorizeHost({ auth, container, scope, address: route.address, requestedHost: route.host })
  } catch {
    const error = new Error('[internal] CrudForm section host authorization failed')
    reportTelemetryError(error, { module: 'shared', code: 'crud_form_sections.host_authorization_failed', attributes: policyDiagnosticAddress(route.address) })
    logger.error('CrudForm section host authorization failed', policyDiagnosticAddress(route.address))
    return rejectUnauthorized()
  }
  if (!host || !sameHost(host, route.host)) return rejectUnauthorized()
  if (!accepted) return rejectPolicy(route.address, 'policy_unavailable')
  const policy = freezeFacts(structuredClone(accepted))
  const context = Object.freeze({ auth, container, scope, route, policy })
  const callbackContext = Object.freeze({ ...context, route: snapshotRoute(route) })
  const surface = checkPolicyIdentity(options, context, fingerprint, requestHeaders)
  const acceptedSinks = policy.sinks ?? []
  const sinkRuntimes = manifest.sinkRuntimes ?? new Map()
  let hardDeleteSinks: ReturnType<typeof selectCrudFormSectionHostDeleteSinks> = []
  if (options.operation === 'delete' && surface.kind === 'parent-delete') {
    const hostDeleteSinks = selectCrudFormSectionHostDeleteSinks(manifest, route.address.hostId, route.host.hostResourceKind)
    if ((acceptedSinks.length || hostDeleteSinks.length) && !options.deleteMode) {
      return rejectPolicy(route.address, 'extension_sink_delete_mode_missing')
    }
    if (options.deleteMode === 'hard' && hostDeleteSinks.length) {
      const proof = policy.mutationProviders.find(({ mutationSurfaceId }) => mutationSurfaceId === surface.id)
      if (surface.delegatedTarget.kind !== 'command' || proof?.extensionSinkSupport !== 'host-transaction') {
        return rejectPolicy(route.address, 'extension_sink_delete_unavailable')
      }
      hardDeleteSinks = hostDeleteSinks
    }
  }
  const splitPayload = (payload: PayloadRecord) => prepareCrudFormSectionSinks({
    payload, accepted: acceptedSinks, runtimes: sinkRuntimes,
    allowWrites: surface.kind === 'parent-submit', creating: options.operation === 'create',
  })
  const initial = await splitPayload(await readPayload(request, options.maxBodyBytes))
  if ([...initial.work.map(({ runtime }) => runtime), ...hardDeleteSinks].some(({ outbox }) => outbox)) {
    if (!crudFormSectionOutboxScopeSchema.safeParse({
      tenantId: scope.tenantId, organizationId: scope.organizationId,
    }).success) return rejectPolicy(route.address, 'outbox_scope_unavailable')
    if (!container.hasRegistration(crudFormSectionOutboxServiceKey)) {
      return rejectPolicy(route.address, 'outbox_service_unavailable')
    }
  }
  assertActivePayload(initial.hostPayload, context)
  if (surface.kind === 'parent-submit' && !hasCrudFormSectionWritableLeaves(policy.surface) && !policy.surface.allowNoopSubmit) {
    return rejectPolicy(route.address, 'parent_submit_not_writable')
  }
  const requiredLeaves = policy.requiredLeaves.filter((leaf) => leaf.mutationSurfaceId === surface.id)
  await options.prevalidateProjectedPayload?.(structuredClone(withExtensions(initial.hostPayload, initial.extensionEnvelope)), callbackContext)
  const prevalidatedOutbox = await prevalidateCrudFormSectionOutbox(initial.work, scope, container)
  const userFeatures = await rbac.getGrantedFeatures(actorId, scope)
  const guards = [...getAllMutationGuardInstances()]
  const legacyGuard = bridgeLegacyGuard(container)
  if (legacyGuard) {
    guards.push({
      ...legacyGuard,
      async validate(input) {
        const result = await legacyGuard.validate(input)
        const { body } = result
        if (!result.ok && result.status === 409 && body?.code === OPTIMISTIC_LOCK_CONFLICT_CODE
            && body.error === OPTIMISTIC_LOCK_CONFLICT_ERROR
            && typeof body.currentUpdatedAt === 'string' && typeof body.expectedUpdatedAt === 'string') {
          const currentUpdatedAt = normalizeIsoToken(body.currentUpdatedAt)
          const expectedUpdatedAt = normalizeIsoToken(body.expectedUpdatedAt)
          if (currentUpdatedAt && expectedUpdatedAt) {
            throw new CrudHttpError(409, {
              error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
              code: OPTIMISTIC_LOCK_CONFLICT_CODE,
              currentUpdatedAt,
              expectedUpdatedAt,
            })
          }
        }
        return result
      },
    })
  }
  const em = container.resolve<EntityManager>('em').fork()
  const executionContext = Object.freeze({ ...callbackContext, transactionalEm: em })
  let committed: {
    value: Result | AmbientCommandExecution<Result>
    resourceId: string | undefined
    callbacks: Awaited<ReturnType<typeof runMutationGuards>>['afterSuccessCallbacks']
    guardInput: MutationGuardInput
    afterCommitSinks: PreparedCrudFormSectionSinks['work']
  } | undefined
  try {
    await withAtomicFlush(em, [async () => {
      const transactionLifetime = getTransactionLifetime(em)
      if (!transactionLifetime) throw new Error('[internal] CrudForm section mutation requires an owned transaction')
      const needsLockedRecord = route.address.formOperation === 'update'
        && requiredLeaves.some(({ mode }) => mode !== 'section')
      const lockedRecord = needsLockedRecord
        ? await provider.readLockedRecord?.({ auth, container, scope, host: route.host, surface, transactionalEm: em })
        : null
      if (needsLockedRecord && !lockedRecord) {
        if (surface.optimisticLock === 'target-required' && route.target.resourceId) {
          enforceRecordGoneIsConflict({
            resourceKind: route.target.resourceKind, resourceId: route.target.resourceId,
            expected: expectedVersion(requestHeaders, surface, route.address, options.operation), envValue: 'all',
          })
        }
        return rejectUnauthorized()
      }
      const prepared = await prepareCrudFormRequiredLeaves({
        payload: initial.hostPayload, leaves: requiredLeaves, lockedRecord: lockedRecord ?? null, scope,
        transactionalEm: em, providers: manifest.leafDefaultProviders,
      })
      if (!prepared.ok) return hiddenLeafError(route.address, prepared.leaf)
      const { serverValues } = prepared
      const additional = await options.preparePayload?.(structuredClone(prepared.payload), executionContext)
      if (additional?.serverPayloadPaths.some((path) => !serverValues.has(path))) {
        return rejectPolicy(route.address, 'server_payload_declaration_mismatch')
      }

      async function validate(value: PayloadRecord, extensionEnvelope: PayloadRecord): Promise<Payload> {
        if (Object.hasOwn(value, 'extensions')) return rejectPolicy(route.address, 'extension_sink_in_host_payload')
        assertActivePayload(value, context, serverValues)
        const parsed = await options.bodySchema.safeParseAsync(value)
        if (!parsed.success) {
          const hidden = reportedHiddenLeaf(requiredLeaves, validationErrorPaths(parsed.error))
          if (hidden) return hiddenLeafError(executionContext.route.address, hidden)
          throw new CrudHttpError(400, { error: 'invalid_request' })
        }
        if (Object.hasOwn(parsed.data, 'extensions')) return rejectPolicy(route.address, 'extension_sink_in_host_payload')
        const changedHiddenLeaf = requiredLeaves.find((leaf): leaf is HiddenLeaf => leaf.mode !== 'section'
          && !isDeepStrictEqual(readCrudFormRequiredLeaf(parsed.data, leaf.payloadPath), serverValues.get(leaf.payloadPath)))
        if (changedHiddenLeaf) return hiddenLeafError(executionContext.route.address, changedHiddenLeaf)
        assertActivePayload(parsed.data, context, serverValues)
        if (requiredLeaves.some(({ mode, payloadPath }) => mode === 'section'
            && !hasRequiredLeafValue(readCrudFormRequiredLeaf(parsed.data, payloadPath)))) {
          throw new CrudHttpError(400, { error: 'invalid_request' })
        }
        await assertCompiledCustomFields(value, parsed.data, executionContext, em)
        await options.validateDomain(parsed.data, executionContext)
        const fieldPayload = withExtensions(parsed.data, extensionEnvelope)
        const adapterErrors = await options.validateFields?.(fieldPayload, executionContext)
        const rules = surface.kind === 'parent-submit'
          ? manifest.compiledFieldRules?.get(crudFormSectionHostKey(route.address)) : undefined
        const compiledErrors = rules?.length
          ? await validateCompiledCrudFormFieldRules(rules, {
              values: projectCrudFormLeafPaths(fieldPayload, policy.surface.ownershipFacts.flatMap(({ payloadPaths, customFieldOwnership }) => [
                ...payloadPaths,
                ...(customFieldOwnership.mode === 'ids' ? customFieldOwnership.ids.map((id) => `customFields.${id}`)
                  : customFieldOwnership.mode === 'all' ? ['customFields'] : []),
              ])),
              scope, actorId, hostResourceId: route.host.hostResourceId,
              hostResourceKind: route.host.hostResourceKind,
            })
          : undefined
        const fieldErrors = { ...compiledErrors, ...adapterErrors }
        if (Object.keys(fieldErrors).length) throw guardRejection({ fieldErrors })
        return parsed.data
      }

      let sinks = initial
      let payload = await validate(additional?.payload ?? prepared.payload, sinks.extensionEnvelope)
      const guardedPayload = withExtensions(payload, sinks.extensionEnvelope)
      const guardInput: MutationGuardInput = {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: actorId,
        resourceKind: route.target.resourceKind,
        resourceId: route.target.resourceId ?? null,
        operation: options.operation,
        requestMethod: request.method,
        requestHeaders: new Headers(requestHeaders),
        mutationPayload: guardedPayload,
      }
      const beforeGuardPayload = structuredClone(guardedPayload)
      const beforeGuardVersions = sinkVersions(sinks)
      const guardResult = await runMutationGuards(guards, guardInput, { userFeatures })
      if (!guardResult.ok) {
        logger.warn('CrudForm section mutation guard rejected', { ...policyDiagnosticAddress(route.address), status: guardResult.errorStatus })
        throw guardRejection(guardResult.errorBody ?? {})
      }
      if (guardResult.modifiedPayload || !isDeepStrictEqual(beforeGuardPayload, guardedPayload)) {
        sinks = await splitPayload(guardResult.modifiedPayload ?? guardedPayload)
        if (!isDeepStrictEqual(beforeGuardVersions, sinkVersions(sinks))) {
          return rejectPolicy(route.address, 'extension_sink_version_rewritten')
        }
        payload = await validate(sinks.hostPayload, sinks.extensionEnvelope)
      }
      await options.beforeExecute?.(payload, executionContext)
      const expectedUpdatedAt = expectedVersion(requestHeaders, surface, route.address, options.operation)

      let verified = false
      const beforeTransactionalWrite: MutableCommandContext['beforeTransactionalWrite'] = async (transactionalEm, input) => {
        verified = false
        if (transactionalEm !== em || !ownsTransactionLifetime(em, transactionLifetime) || !em.isInTransaction() || input === undefined) {
          return rejectPolicy(route.address, 'transactional_input_unavailable')
        }
        await options.beforeTransactionalWrite?.(transactionalEm, input)
        if (getCrudFormSectionManifest().ledger.fingerprint !== fingerprint) {
          return rejectPolicy(route.address, 'transactional_manifest_mismatch')
        }
        const projected = options.projectFinalInput(input, executionContext)
        if (!projected || !sameIdentity(route, projected)
            || projected.targetOrganizationId !== route.targetOrganizationId
            || projected.expectedUpdatedAt !== expectedUpdatedAt) {
          return rejectPolicy(route.address, 'final_resource_binding_mismatch')
        }
        if (Object.hasOwn(projected.payload, 'extensions')) {
          return rejectPolicy(route.address, 'extension_sink_in_host_payload')
        }
        const normalizedSinks = await splitPayload(withExtensions(projected.payload, sinks.extensionEnvelope))
        if (!isDeepStrictEqual(sinks.extensionEnvelope, normalizedSinks.extensionEnvelope)) {
          return rejectPolicy(route.address, 'final_extension_payload_not_normalized')
        }
        assertPrevalidatedCrudFormSectionOutbox(normalizedSinks.work, prevalidatedOutbox)
        const normalized = await validate(normalizedSinks.hostPayload, normalizedSinks.extensionEnvelope)
        if (!isDeepStrictEqual(normalized, projected.payload)) return rejectPolicy(route.address, 'final_payload_not_normalized')
        if (route.host.hostResourceId) {
          const sinkContext = { hostResourceId: route.host.hostResourceId, em, scope, auth, container }
          for (const runtime of [...normalizedSinks.work.map(({ runtime }) => runtime), ...hardDeleteSinks]) {
            await preflightCrudFormSectionOutboxIntent(runtime, sinkContext)
          }
        }
        sinks = normalizedSinks
        verified = true
      }
      const value = await options.execute({
        payload, context: executionContext, expectedUpdatedAt,
        commandContext: { transactionalEm: em, transactionLifetime, beforeTransactionalWrite },
      })
      if (!verified || !ownsTransactionLifetime(em, transactionLifetime) || !em.isInTransaction()) return rejectPolicy(route.address, 'transactional_input_unverified')
      let resourceId = route.target.resourceId
      if (options.operation === 'create' && (guardResult.afterSuccessCallbacks.length || sinks.work.length)) {
        try {
          const tentative = isAmbientCommandExecution(value) ? value.tentativeResult : value
          const created = resourceIdSchema.safeParse(options.resolveCommittedResourceId(tentative))
          resourceId = created.success ? created.data : undefined
        } catch {
          resourceId = undefined
        }
      }
      const atomicSinks = sinks.work.filter(({ runtime }) => runtime.fact.atomicity !== 'after-commit')
      const afterCommitSinks = sinks.work.filter(({ runtime }) => runtime.fact.atomicity === 'after-commit')
      if (atomicSinks.length || hardDeleteSinks.length) {
        if (!resourceId || !isAmbientCommandExecution(value)) {
          return rejectPolicy(route.address, 'extension_sink_host_result_unavailable')
        }
        const log = value.logEntry
        if (!log?.id || log.commandId !== surface.delegatedTarget.id
            || log.resourceId !== resourceId || log.resourceKind !== route.target.resourceKind
            || log.tenantId !== scope.tenantId || log.organizationId !== scope.organizationId
            || (log.undoToken && !value.supportsAtomicUndo)) {
          return rejectPolicy(route.address, 'extension_sink_audit_unavailable')
        }
        if (!container.hasRegistration('actionLogService')) {
          return rejectPolicy(route.address, 'extension_sink_audit_unavailable')
        }
        const audit = container.resolve<ExtensionAuditService>('actionLogService')
        if (typeof audit.updateTransactionalContext !== 'function') {
          return rejectPolicy(route.address, 'extension_sink_audit_unavailable')
        }
        const sinkContext = { hostResourceId: resourceId, em, scope, auth, container }
        const mutationSource = { ...route.address, mutationSurfaceId: surface.id }
        for (const work of atomicSinks) {
          if (options.operation === 'delete') return rejectPolicy(route.address, 'extension_sink_delete_payload_invalid')
          const snapshot = await persistCrudFormSectionSink(work, sinkContext, options.operation)
          appendCrudFormSectionSinkSnapshot(log, work.runtime, resourceId, snapshot, mutationSource)
        }
        for (const runtime of hardDeleteSinks) {
          await runtime.lockRow?.(sinkContext)
          const snapshot = await runtime.onHostDeleted!(sinkContext)
          appendCrudFormSectionSinkSnapshot(log, runtime, resourceId, snapshot, mutationSource)
        }
        if (!log.contextJson || !await audit.updateTransactionalContext({
          id: log.id, tenantId: scope.tenantId, organizationId: scope.organizationId, context: log.contextJson,
        }, em)) return rejectPolicy(route.address, 'extension_sink_audit_unavailable')
      }
      if (afterCommitSinks.length && (!resourceId || !isRecord(isAmbientCommandExecution(value) ? value.tentativeResult : value))) {
        return rejectPolicy(route.address, 'extension_sink_host_result_unavailable')
      }
      committed = { value, resourceId, callbacks: guardResult.afterSuccessCallbacks, guardInput, afterCommitSinks }
    }], { transaction: true, label: 'crud-form-section-mutation' })
  } catch (error) {
    if (isCrudHttpError(error) && error.body.code === 'crud_form_section_hidden_field_invalid') throw error
    const reportedPath = options.hiddenLeafErrorPath?.(error, executionContext)
    const hidden = reportedHiddenLeaf(requiredLeaves, [...validationErrorPaths(error), ...(reportedPath ? [reportedPath] : [])])
    if (hidden) return hiddenLeafError(route.address, hidden)
    throw error
  }
  if (!committed) throw new Error('[internal] CrudForm section mutation completed without a result')

  const { resourceId } = committed
  if (!resourceId && options.operation === 'create' && committed.callbacks.length) {
    reportCallbackFailure('committed_resource_id_unavailable', policyDiagnosticAddress(route.address))
  }
  if (resourceId) {
    const { mutationPayload: _validatedPayload, ...callbackInput } = committed.guardInput
    for (const { guard, metadata } of committed.callbacks) {
      try {
        await guard.afterSuccess?.({ ...callbackInput, requestHeaders: new Headers(requestHeaders), resourceId, metadata })
      } catch {
        reportCallbackFailure('after_success_failed', { ...policyDiagnosticAddress(route.address), guardId: guard.id })
      }
    }
  }
  const result = isAmbientCommandExecution(committed.value) ? committed.value.finalizedResult() : committed.value
  const extensionWarnings = []
  if (resourceId && options.operation !== 'delete') {
    const operation = options.operation
    for (const work of committed.afterCommitSinks) {
      try {
        const sinkEm = container.resolve<EntityManager>('em').fork()
        await withAtomicFlush(sinkEm, [async () => {
          await persistCrudFormSectionSink(work, { hostResourceId: resourceId, em: sinkEm, scope, auth, container }, operation)
        }], { transaction: true, label: 'crud-form-section-after-commit-sink' })
      } catch {
        extensionWarnings.push(reportCrudFormSectionSinkFailure(work.runtime))
      }
    }
  }
  return extensionWarnings.length && isRecord(result) ? { ...result, extensionWarnings } : result
}

export async function runCrudFormSectionOutboxRetry(
  options: Omit<CrudFormSectionMutationFacadeOptions<PayloadRecord, { ok: true }>,
    'operation' | 'requestOperation' | 'mutationSurfaceId' | 'bodySchema' | 'execute' | 'projectFinalInput' | 'validateDomain'> & {
    sinkId: string
  },
): Promise<{ ok: true }> {
  const mutationSurfaceId = `${options.sinkId}.retry`
  return runCrudFormSectionMutation({
    ...options,
    operation: 'update',
    requestOperation: 'retry',
    mutationSurfaceId,
    bodySchema: z.strictObject({}),
    validateDomain() {},
    projectFinalInput: (input) => input as ReturnType<CrudFormSectionMutationFacadeOptions<PayloadRecord, { ok: true }>['projectFinalInput']>,
    async execute({ commandContext, context, expectedUpdatedAt, payload }) {
      const { policy, route, auth, scope, container } = context
      const hostResourceId = route.host.hostResourceId
      const surface = policy.mutationSurfaces.find(({ id }) => id === mutationSurfaceId)
      const accepted = policy.sinks?.find(({ fact }) => fact.id === options.sinkId && fact.atomicity === 'outbox')
      const sink = getCrudFormSectionManifest().sinkRuntimes?.get(options.sinkId)
      if (!hostResourceId || surface?.kind !== 'section-action' || surface.delegatedTarget.kind !== 'service'
          || !accepted || !sink?.outbox || sink.fact.roundTripId !== accepted.fact.roundTripId) {
        return rejectPolicy(route.address, 'extension_sink_retry_unavailable')
      }
      const { transactionalEm } = commandContext
      await commandContext.beforeTransactionalWrite(transactionalEm, {
        ...route, payload, targetOrganizationId: route.targetOrganizationId, expectedUpdatedAt,
      })
      await retryCrudFormSectionOutbox(sink, { em: transactionalEm, hostResourceId, scope, auth, container })
      return { ok: true }
    },
  })
}
