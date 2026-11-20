import { isDeepStrictEqual } from 'node:util'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { z } from 'zod'
import type { AuthContext } from '../../auth/server'
import { withAtomicFlush } from '../../commands/flush'
import { getTransactionLifetime } from '../../commands/transaction-lifetime'
import type { CommandRuntimeContext } from '../../commands/types'
import { createLogger } from '../../logger'
import { reportTelemetryError } from '../../telemetry/runtime'
import { isRecord } from '../../utils'
import { readBoundedRequestBytes, WebhookBodyTooLargeError } from '../../webhooks/body'
import type { CrudFormSectionAddress, CrudFormSectionMutationSurfaceFact } from '../../../modules/form-section-facts'
import type { CrudFormSectionHostAssertion } from '../../../modules/form-sections'
import { matchRoutePattern, type RouteMatchParams } from '../../../modules/registry'
import { CrudHttpError } from '../errors'
import { bridgeLegacyGuard, runMutationGuards, type MutationGuardInput } from '../mutation-guard-registry'
import { getAllMutationGuardInstances } from '../mutation-guard-store'
import { normalizeIsoToken } from '../optimistic-lock'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '../optimistic-lock-headers'
import { crudFormSectionHostKey } from './composition'
import { getCrudFormSectionManifest, type CrudFormSectionAcceptedPolicy } from './manifest'
import { parseCrudFormSectionPolicyHeaders } from './policy-headers'
import { decodeCrudFormSectionPolicyToken, encodeCurrentCrudFormSectionPolicyToken } from './policy-token'
import { resourceIdSchema, symbolicIdSchema } from './protocol'

const logger = createLogger('shared:crud-form-sections')

type HostAddress = Omit<CrudFormSectionAddress, 'sectionId'>
type PayloadRecord = Record<string, unknown>
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
  preparePayload?(payload: PayloadRecord, context: AuthorizedContext): Promise<{
    payload: PayloadRecord
    serverPayloadPaths: readonly string[]
  }>
  validateDomain(payload: Payload, context: AuthorizedContext): void | Promise<void>
  validateFields?(payload: Payload, context: AuthorizedContext): Promise<Record<string, string>>
  projectFinalInput(input: unknown, context: AuthorizedContext): (CrudFormSectionMutationIdentity & {
    payload: PayloadRecord
  }) | null
  beforeTransactionalWrite?: CommandRuntimeContext['beforeTransactionalWrite']
  beforeExecute?(payload: Payload, context: AuthorizedContext): Promise<void>
  execute(input: {
    payload: Payload
    context: AuthorizedContext
    commandContext: MutableCommandContext
    expectedUpdatedAt: string | null
  }): Promise<Result>
} & (
  | { operation: 'create'; resolveCommittedResourceId(result: Result): string }
  | { operation: 'update' | 'delete' }
)

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

function validResource(kind: string, id?: string): boolean {
  return symbolicIdSchema.safeParse(kind).success && (id === undefined || resourceIdSchema.safeParse(id).success)
}

function exactIds(left: readonly string[], right: readonly string[] = []): boolean {
  return left.length === right.length && isDeepStrictEqual([...left].sort(), [...right].sort())
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
): CrudFormSectionMutationSurfaceFact {
  const { address, host, target, resourceBindingIds } = context.route
  const { policy } = context
  const headers = parseCrudFormSectionPolicyHeaders(options.request.headers)
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
  request: Request,
  surface: CrudFormSectionMutationSurfaceFact,
  address: HostAddress,
  operation: MutationGuardInput['operation'],
): string | null {
  const value = request.headers.get(OPTIMISTIC_LOCK_HEADER_NAME)
  if ((value === null && surface.optimisticLock === 'target-required') || (value !== null && operation === 'create')) {
    return rejectPolicy(address, 'target_version_mismatch')
  }
  if (value === null || surface.optimisticLock === 'none') return null
  const normalized = value.includes(',') ? null : normalizeIsoToken(value)
  if (!normalized) throw new CrudHttpError(400, { error: 'invalid_request' })
  return normalized
}

function readPath(payload: PayloadRecord, path: string): unknown {
  let current: unknown = payload
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
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
    if (!isDeepStrictEqual(readPath(payload, path), value)) {
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
  logger.error('CrudForm section mutation callback failed', { ...attributes, reason })
  reportTelemetryError(error, {
    module: 'shared',
    code: 'crud_form_sections.guard_callback_failed',
    attributes: { ...attributes, reason },
  })
}

export async function runCrudFormSectionMutation<Payload extends PayloadRecord, Result>(
  options: CrudFormSectionMutationFacadeOptions<Payload, Result>,
): Promise<Result> {
  const { request, container, auth, scope } = options
  if (!auth) throw new CrudHttpError(401, { error: 'unauthorized' })
  if (!scope?.tenantId || scope.tenantId !== auth.tenantId || scope.allowedOrganizationIds?.length === 0) {
    return rejectUnauthorized()
  }
  const rbac = container.resolve<RbacService>('rbacService')
  if (!await rbac.userHasAllFeatures(auth.sub, [...options.requiredFeatures], scope)) {
    throw new CrudHttpError(403, { error: 'forbidden' })
  }
  const url = new URL(request.url)
  const params = matchRoutePattern(options.routePattern, url.pathname.replace(/^\/api(?=\/|$)/, ''))
  if (!params || request.method !== options.method) return rejectUnauthorized()
  const route = await options.authorizeRoute({ auth, container, scope, params, query: url.searchParams })
  if (!route || !validResource(route.host.hostResourceKind, route.host.hostResourceId)
      || !validResource(route.target.resourceKind, route.target.resourceId)
      || (route.address.formOperation === 'create') !== (route.host.hostResourceId === undefined)) {
    return rejectUnauthorized()
  }
  const manifest = getCrudFormSectionManifest()
  const hostKey = crudFormSectionHostKey(route.address)
  const provider = manifest.providers.get(hostKey)
  const policy = manifest.policies.get(hostKey)
  if (!provider || provider.hostResourceKind !== route.host.hostResourceKind) return rejectUnauthorized()
  if (!await rbac.userHasAllFeatures(auth.sub, [...(policy?.requireFeatures ?? provider.requireFeatures)], scope)) {
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
  if (!policy) return rejectPolicy(route.address, 'policy_unavailable')
  const context = { auth, container, scope, route, policy }
  const surface = checkPolicyIdentity(options, context, manifest.ledger.fingerprint)
  const initial = await readPayload(request, options.maxBodyBytes)
  assertActivePayload(initial, context)
  if (surface.kind === 'parent-submit' && !policy.surface.ownershipFacts.some(({ payloadPaths, customFieldOwnership }) =>
    payloadPaths.length || customFieldOwnership.mode === 'all'
      || (customFieldOwnership.mode === 'ids' && customFieldOwnership.ids.length),
  ) && !policy.capabilities.some(({ fact }) => fact.allowNoopSubmit)) {
    return rejectPolicy(route.address, 'parent_submit_not_writable')
  }
  const prepared = await options.preparePayload?.(structuredClone(initial), context) ?? { payload: initial, serverPayloadPaths: [] }
  const serverValues = new Map(prepared.serverPayloadPaths.map((path) => [path, structuredClone(readPath(prepared.payload, path))]))
  const serverLeaves = new Set(policy.capabilities.flatMap(({ fact }) => fact.requiredLeaves)
    .filter(({ coverage }) => coverage.includes('server-default') || coverage.includes('preserve-from-record'))
    .map(({ payloadPath }) => payloadPath))
  if ([...serverValues.entries()].some(([path, value]) => !serverLeaves.has(path) || value === undefined
    || readPath(initial, path) !== undefined)) return rejectPolicy(route.address, 'server_payload_declaration_mismatch')

  async function validate(value: PayloadRecord, validationContext: AuthorizedContext = context): Promise<Payload> {
    assertActivePayload(value, context, serverValues)
    const parsed = await options.bodySchema.safeParseAsync(value)
    if (!parsed.success) throw new CrudHttpError(400, { error: 'invalid_request' })
    assertActivePayload(parsed.data, context, serverValues)
    await options.validateDomain(parsed.data, validationContext)
    const fieldErrors = await options.validateFields?.(parsed.data, validationContext)
    if (fieldErrors && Object.keys(fieldErrors).length) throw guardRejection({ fieldErrors })
    return parsed.data
  }

  let payload = await validate(prepared.payload)
  const userFeatures = await rbac.getGrantedFeatures(auth.sub, scope)
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
  const guardInput: MutationGuardInput = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: auth.sub,
    resourceKind: route.target.resourceKind,
    resourceId: route.target.resourceId ?? null,
    operation: options.operation,
    requestMethod: request.method,
    requestHeaders: request.headers,
    mutationPayload: payload,
  }
  const beforeGuardPayload = structuredClone(payload)
  const guardResult = await runMutationGuards(guards, guardInput, { userFeatures })
  if (!guardResult.ok) {
    logger.warn('CrudForm section mutation guard rejected', { ...policyDiagnosticAddress(route.address), status: guardResult.errorStatus })
    throw guardRejection(guardResult.errorBody ?? {})
  }
  if (guardResult.modifiedPayload || !isDeepStrictEqual(beforeGuardPayload, payload)) {
    payload = await validate(guardResult.modifiedPayload ?? payload)
  }
  await options.beforeExecute?.(payload, context)
  const expectedUpdatedAt = expectedVersion(request, surface, route.address, options.operation)

  const em = container.resolve<EntityManager>('em').fork()
  let committed: { value: Result } | undefined
  await withAtomicFlush(em, [async () => {
    const transactionLifetime = getTransactionLifetime(em)
    if (!transactionLifetime) throw new Error('[internal] CrudForm section mutation requires an owned transaction')
    let verified = false
    const executionContext = { ...context, transactionalEm: em }
    const beforeTransactionalWrite: MutableCommandContext['beforeTransactionalWrite'] = async (transactionalEm, input) => {
      verified = false
      if (transactionalEm !== em || !em.isInTransaction() || input === undefined) {
        return rejectPolicy(route.address, 'transactional_input_unavailable')
      }
      await options.beforeTransactionalWrite?.(transactionalEm, input)
      if (getCrudFormSectionManifest().ledger.fingerprint !== manifest.ledger.fingerprint) {
        return rejectPolicy(route.address, 'transactional_manifest_mismatch')
      }
      const projected = options.projectFinalInput(input, executionContext)
      if (!projected || !sameIdentity(route, projected)) return rejectPolicy(route.address, 'final_resource_binding_mismatch')
      const normalized = await validate(projected.payload, executionContext)
      if (!isDeepStrictEqual(normalized, projected.payload)) return rejectPolicy(route.address, 'final_payload_not_normalized')
      verified = true
    }
    const value = await options.execute({
      payload, context: executionContext, expectedUpdatedAt,
      commandContext: { transactionalEm: em, transactionLifetime, beforeTransactionalWrite },
    })
    if (!verified || !em.isInTransaction()) return rejectPolicy(route.address, 'transactional_input_unverified')
    committed = { value }
  }], { transaction: true, label: 'crud-form-section-mutation' })
  if (!committed) throw new Error('[internal] CrudForm section mutation completed without a result')

  let resourceId = route.target.resourceId
  if (options.operation === 'create' && guardResult.afterSuccessCallbacks.length) {
    try {
      const created = resourceIdSchema.safeParse(options.resolveCommittedResourceId(committed.value))
      resourceId = created.success ? created.data : undefined
    } catch {
      resourceId = undefined
    }
    if (!resourceId) reportCallbackFailure('committed_resource_id_unavailable', policyDiagnosticAddress(route.address))
  }
  if (resourceId) {
    const { mutationPayload: _validatedPayload, ...callbackInput } = guardInput
    for (const { guard, metadata } of guardResult.afterSuccessCallbacks) {
      try {
        await guard.afterSuccess?.({ ...callbackInput, resourceId, metadata })
      } catch {
        reportCallbackFailure('after_success_failed', { ...policyDiagnosticAddress(route.address), guardId: guard.id })
      }
    }
  }
  return committed.value
}
