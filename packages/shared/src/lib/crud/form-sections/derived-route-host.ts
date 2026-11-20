import { isDeepStrictEqual } from 'node:util'
import { LockMode, MetadataStorage } from '@mikro-orm/core'
import { asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { compareSectionIds } from './composition'
import { getCommandInterceptorHttpRejection } from '../../commands/errors'
import type { CommandRuntimeContext } from '../../commands/types'
import { findOneWithDecryption } from '../../encryption/find'
import { bindMatchedApiRoutePath } from '../../modules/api-route-identity'
import { isRecord } from '../../utils'
import { readBoundedRequestBytes, WebhookBodyTooLargeError } from '../../webhooks/body'
import type { CrudFormRequiredLeafFact, CrudFormSectionCapabilityProviderFact, CrudFormSectionMutationSurfaceFact } from '../../../modules/form-section-facts'
import type { CrudFormSectionHostFact, CrudFormSectionHostProvider, CrudFormSectionMutationProviderProof, CrudFormSectionsDeclaration } from '../../../modules/form-sections'
import { CrudHttpError, isCrudHttpError } from '../errors'
import { normalizeIsoToken } from '../optimistic-lock'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '../optimistic-lock-headers'
import { crudSectionOperationMethods, findCrudRouteSectionSource, rememberDerivedCrudRouteCapabilities, type CrudRouteSectionSource, type CrudSectionRouteMethod, type CrudSectionRouteOperation } from './factory-route-source'
import { derivedCrudFormSectionClientMutationFact } from './client-mutation-facts'
import { runCrudFormSectionMutation, type CrudFormSectionMutationFacadeOptions } from './mutation-facade'
import { crudFormSectionPolicyHeaderNames, crudFormSectionPolicyHeaderSchema, parseCrudFormSectionPolicyHeaders } from './policy-headers'
import { decodeCrudFormSectionPolicyToken } from './policy-token'
import {
  crudFormSectionHiddenFieldInvalidResponseSchema, crudFormSectionMutationGuardRejectedResponseSchema,
  crudFormSectionPolicyMismatchResponseSchema, crudFormSectionsPrivateHeaders,
  resourceIdSchema, symbolicIdSchema,
} from './protocol'
import { deriveCrudFormRequiredLeafPaths } from './required-leaf-drift'
import type { OpenApiRouteDoc } from '../../openapi'

type Payload = Record<string, unknown>
type Proof = Omit<CrudFormSectionMutationProviderProof, 'mutationSurfaceId' | 'delegatedTarget'>
type OperationContract = { proof: Proof; schema?: z.ZodType }

export type CrudRouteSectionHostDeclaration = {
  hostId: string
  formVariant: string
  formOperation: 'create' | 'update'
  hostDescriptorId: string
  route: object
  sections: readonly { id: string; writes: 'parent' | 'none' }[]
  authoritativeSchema: { id: string; schema?: z.ZodType; fixtures: readonly Payload[] }
  projectedSchema: z.ZodObject
  submit: OperationContract
  delete?: OperationContract & { inputStyle?: 'body-query' | 'direct'; mode: 'soft' | 'hard' }
  expectedVersionField?: string
  idSchema?: z.ZodType<string>
  wireRequiredUpdatePaths?: readonly string[]
  mergesOmittedFieldsFromLockedRecord?: true
  projectLockedRecord?(record: Readonly<Payload>): Payload
  extensionSinkSupport: CrudFormSectionCapabilityProviderFact['extensionSinkSupport']
  maxBodyBytes: number
  responseSchemas: Partial<Record<CrudSectionRouteMethod, z.ZodType>>
}

type DerivedHost = {
  declaration: CrudRouteSectionHostDeclaration
  source: CrudRouteSectionSource
  updatedAtField: string | null
  submitSchema: z.ZodType
  requiredPaths: readonly string[]
}

const derivedHosts = new WeakMap<object, DerivedHost>()
const proofVersion = 'transactional-final-input/v1'
const pathAlias = /^[A-Za-z][A-Za-z0-9_]*$/
const sectionPolicySuffix = '/section-policy'
const staticRoutePattern = /^(?:\/[A-Za-z0-9_.-]+)+$/
const requestIdSchema = z.object({ id: resourceIdSchema.optional() }).passthrough()
const errorSchema = z.object({ error: z.string() })
const optimisticConflictSchema = z.object({
  error: z.literal('record_modified'), code: z.literal('optimistic_lock_conflict'),
  currentUpdatedAt: z.string(), expectedUpdatedAt: z.string(),
})
const emptyBodySchema = z.object({}).strict()
const scopeSelectors = new Set(['tenantId', 'tenant_id', 'organizationId', 'organization_id', 'organizationIds', 'organization_ids'])
const extensionWarningsSchema = z.array(z.object({ sinkId: z.string(), code: z.string() }).strict())
const sinkValidationSchema = z.object({
  error: z.literal('validation_failed'), code: z.literal('validation_failed'), fieldErrors: z.record(z.string(), z.string()),
}).strict()
const externalUnavailableSchema = z.object({
  error: z.literal('crud_form_section_external_unavailable'),
  code: z.literal('crud_form_section_external_unavailable'),
}).strict()

function refuse(qualifier: string): never {
  throw new Error(`[internal] Cannot derive CrudForm section host: ${qualifier}. Use a hand-written section adapter.`)
}

function findUpdatedAt(source: CrudRouteSectionSource): string | null {
  if (typeof source.orm.entity !== 'function') return null
  const metadata = Object.values(MetadataStorage.getMetadata()).find((meta) => meta.class === source.orm.entity)
  if (!metadata) return refuse('entity metadata unavailable')
  const scopeFields = [source.orm.idField, source.orm.tenantField, source.orm.orgField, source.orm.softDeleteField]
  if (scopeFields.some((field) => field !== null && !Object.hasOwn(metadata.properties, field))) {
    return refuse('factory scope fields do not match the entity metadata')
  }
  return Object.values(metadata.properties).find((prop) => prop.name === 'updatedAt'
    || prop.fieldNames?.includes('updated_at'))?.name ?? null
}

function checkProof(proof: Proof, lockRequired: boolean): void {
  if (proof.finalInput !== proofVersion) refuse('delegated command does not attest to the final transactional input seam')
  if (lockRequired && (!(proof.atomicity === 'pessimistic-write' || proof.atomicity === 'compare-and-swap')
    || !proof.contenderCoverage?.includes('update/update') || !proof.contenderCoverage.includes('update/delete'))) {
    refuse('versioned entity requires an atomic optimistic-lock proof and both contender cases')
  }
}

export function defineCrudRouteSectionHost<const Host extends CrudRouteSectionHostDeclaration>(declaration: Host): Host {
  const source = findCrudRouteSectionSource(declaration.route)
  if (!source || !source.orm.tenantField || typeof source.orm.entity !== 'function') refuse('expected the original tenant-scoped makeCrudRoute result')
  if (source.hasWriteHooks || source.hasCustomIdentifiers) refuse('factory has custom write hooks or identifier mapping')
  if (!declaration.sections.length || new Set(declaration.sections.map(({ id }) => id)).size !== declaration.sections.length
      || declaration.sections.some(({ id, writes }) => !symbolicIdSchema.safeParse(id).success || !['parent', 'none'].includes(writes))) {
    refuse('missing finite group set or a group declares a secondary write')
  }
  if (![declaration.hostId, declaration.formVariant, declaration.hostDescriptorId, source.resourceKind]
      .every((id) => symbolicIdSchema.safeParse(id).success)) refuse('invalid host or resource identity')
  if (declaration.formOperation === 'create' && declaration.delete) refuse('create form cannot own a delete mutation')
  if (declaration.delete && declaration.delete.mode !== 'soft' && declaration.delete.mode !== 'hard') {
    refuse('delete requires an explicit delegated command’s soft or hard delete contract')
  }
  if (!Number.isSafeInteger(declaration.maxBodyBytes) || declaration.maxBodyBytes < 1) refuse('declared body bound is invalid')
  if (declaration.expectedVersionField && (!pathAlias.test(declaration.expectedVersionField)
      || declaration.expectedVersionField === 'id')) refuse('invalid expected version field')

  const selected = declaration.formOperation
  const selectedAction = source.actions[selected]
  if (!selectedAction) refuse('the parent is not backed by one factory command')
  const commandPrefix = selectedAction.commandId.split('.').slice(0, -1).join('.')
  const operations: CrudSectionRouteOperation[] = [selected, ...(declaration.delete ? ['delete' as const] : [])]
  for (const operation of operations) {
    const action = source.actions[operation]
    const method = crudSectionOperationMethods[operation]
    const metadata = source.metadata[method]
    const response = declaration.responseSchemas[method]
    if (!commandPrefix || action?.commandId !== `${commandPrefix}.${operation}` || action.hasCustomMetadata
        || !metadata?.requireAuth || metadata.requireRoles?.length || !response) {
      refuse(`${method} requires a direct authenticated command and a response schema`)
    }
    if (declaration.extensionSinkSupport !== 'none' && !(response instanceof z.ZodObject)) {
      refuse(`${method} requires an object response schema to carry extension warnings`)
    }
  }

  if (declaration.delete) {
    const features = (method: CrudSectionRouteMethod) => [...new Set(source.metadata[method]?.requireFeatures ?? [])].sort(compareSectionIds)
    if (!isDeepStrictEqual(features('PUT'), features('DELETE'))) {
      refuse('combined update and delete commands declare different required features')
    }
  }
  const updatedAtField = findUpdatedAt(source)
  if (selected === 'update' && Boolean(updatedAtField) !== Boolean(declaration.expectedVersionField)) {
    refuse('versioned update requires the command’s expected version field and unversioned update must omit it')
  }
  checkProof(declaration.submit.proof, selected === 'update' && Boolean(updatedAtField))
  if (declaration.delete) checkProof(declaration.delete.proof, Boolean(updatedAtField))
  if (selected === 'update' && !declaration.mergesOmittedFieldsFromLockedRecord
      && !declaration.wireRequiredUpdatePaths?.length) refuse('update command does not declare how omitted fields are preserved')
  const submitSchema = declaration.authoritativeSchema.schema ?? declaration.submit.schema ?? selectedAction.schema
  if (!submitSchema) refuse('missing authoritative create or update command schema')

  let fixtureRequirements: string[][]
  try {
    if (!declaration.authoritativeSchema.fixtures.length) return refuse('authoritative schema requires a valid fixture')
    fixtureRequirements = declaration.authoritativeSchema.fixtures.map((fixture) =>
      deriveCrudFormRequiredLeafPaths(submitSchema, declaration.authoritativeSchema.id, [fixture])
        .filter((leaf) => leaf !== 'id' && leaf !== declaration.expectedVersionField))
  } catch {
    return refuse('authoritative schema fixtures cannot prove the required payload leaves')
  }
  const [requiredPaths] = fixtureRequirements
  if (fixtureRequirements.some((leaves) => JSON.stringify(leaves) !== JSON.stringify(requiredPaths))) {
    return refuse('conditional required payload leaves need distinct finite form variants')
  }
  if (selected === 'update' && JSON.stringify(requiredPaths) !== JSON.stringify([...declaration.wireRequiredUpdatePaths ?? []].sort(compareSectionIds))) {
    refuse('wire-required update leaf declaration disagrees with the authoritative schema')
  }
  derivedHosts.set(declaration, { declaration, source, updatedAtField, submitSchema, requiredPaths })
  return declaration
}

function derivedHost(declaration: CrudRouteSectionHostDeclaration): DerivedHost {
  return derivedHosts.get(declaration) ?? refuse('missing validated route host declaration')
}

function mutationSurface(host: DerivedHost, operation: CrudSectionRouteOperation, route: string): CrudFormSectionMutationSurfaceFact {
  const { declaration, source, updatedAtField } = host
  const action = source.actions[operation]
  if (!action) return refuse('missing delegated command')
  return {
    ...derivedCrudFormSectionClientMutationFact({
      hostDescriptorId: declaration.hostDescriptorId, operation, route,
      resourceKind: source.resourceKind, versioned: Boolean(updatedAtField),
    }),
    delegatedTarget: { kind: 'command', id: action.commandId },
    resourceBindingIds: [],
  }
}

function hostSurfaces(host: DerivedHost, route: string): CrudFormSectionMutationSurfaceFact[] {
  return [
    mutationSurface(host, host.declaration.formOperation, route),
    ...(host.declaration.delete ? [mutationSurface(host, 'delete', route)] : []),
  ]
}

function assertStaticPolicyRoute(route: string): void {
  if (!route.endsWith(sectionPolicySuffix) || !staticRoutePattern.test(route)
      || route.split('/').some((segment) => segment === '.' || segment === '..')) {
    refuse('derived façade requires a literal route path without parameters')
  }
}

function supportsFacadeInterceptors(host: DerivedHost, route: string): boolean {
  const originalPath = route.slice(0, -sectionPolicySuffix.length)
  const operations = [host.declaration.formOperation, ...(host.declaration.delete ? ['delete' as const] : [])]
  return !operations.some((operation) => host.source.hasFacadeOnlyInterceptors(operation, originalPath, route))
}

function rejectDerivedMutation(): never {
  throw new CrudHttpError(409, { error: 'extension_policy_mismatch', code: 'extension_policy_mismatch' })
}

type ScopedBinding = Parameters<CrudFormSectionHostProvider['authorizeHost']>[0]['scope']

async function readBoundRecord(
  source: CrudRouteSectionSource, em: EntityManager, id: string, scope: ScopedBinding, locked = false,
): Promise<Payload | null> {
  const { entity, idField, orgField, tenantField, softDeleteField } = source.orm
  if (!tenantField) return null
  const where: Payload = { [idField]: id, [tenantField]: scope.tenantId }
  if (orgField) {
    if (scope.organizationId !== null) where[orgField] = scope.organizationId
    else if (scope.allowedOrganizationIds !== null) where[orgField] = { $in: [...scope.allowedOrganizationIds] }
  }
  if (softDeleteField) where[softDeleteField] = null
  const record = await findOneWithDecryption(em, entity, where, locked ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined, scope)
  return isRecord(record) ? record : null
}

function makeHostProvider(host: DerivedHost, route: string): CrudFormSectionHostProvider {
  const { declaration, source } = host
  const surfaces = hostSurfaces(host, route)
  const requireFeatures = [...new Set(surfaces.flatMap(({ guardedFacade: { method } }) =>
    source.metadata[method as CrudSectionRouteMethod]?.requireFeatures ?? []))].sort(compareSectionIds)
  return {
    hostDescriptorId: declaration.hostDescriptorId,
    requireFeatures,
    mutationProviders: surfaces.map(({ id, delegatedTarget, kind }) => ({
      mutationSurfaceId: id,
      delegatedTarget,
      ...(kind === 'parent-delete' && declaration.delete ? declaration.delete.proof : declaration.submit.proof),
    })),
    async authorizeHost({ container, scope, requestedHost }) {
      if (requestedHost.hostResourceKind !== source.resourceKind || !supportsFacadeInterceptors(host, route)) return null
      if (!requestedHost.hostResourceId) return !source.orm.orgField || scope.organizationId ? requestedHost : null
      return await readBoundRecord(source, container.resolve<EntityManager>('em'), requestedHost.hostResourceId, scope)
        ? requestedHost : null
    },
    async readLockedRecord({ scope, transactionalEm, host: assertion }) {
      if (!assertion.hostResourceId) return null
      const record = await readBoundRecord(source, transactionalEm, assertion.hostResourceId, scope, true)
      return record && declaration.projectLockedRecord ? declaration.projectLockedRecord(record) : record
    },
  }
}

export type DerivedCrudRouteHostBinding = {
  declaration: CrudRouteSectionHostDeclaration
  route: string
}

export function bindDerivedCrudRouteSectionHosts(
  sections: CrudFormSectionsDeclaration,
  bindings: readonly DerivedCrudRouteHostBinding[],
): CrudFormSectionsDeclaration {
  const hostFacts = new Map((sections.hostFacts ?? []).map((fact) => [fact.id, fact]))
  const hostProviders = [...sections.hostProviders ?? []]
  const derivedRouteCapabilities: Array<{
    fact: CrudFormSectionCapabilityProviderFact
    features: readonly string[]
    ready(): boolean
  }> = []
  for (const { declaration, route } of bindings) {
    const host = derivedHost(declaration)
    const fact = hostFacts.get(declaration.hostDescriptorId)
    if (!fact || fact.hostResourceKind !== host.source.resourceKind || hostProviders.some(({ hostDescriptorId }) => hostDescriptorId === fact.id)) {
      return refuse('missing matching host fact or competing host provider')
    }
    assertStaticPolicyRoute(route)
    const surfaces = hostSurfaces(host, route)
    const alternatives = fact.alternatives ?? []
    if (!alternatives.length || alternatives.some(({ surface, mutationSurfaces }) => surface.hostId !== declaration.hostId
        || surface.formVariant !== declaration.formVariant || surface.formOperation !== declaration.formOperation
        || mutationSurfaces?.length || surface.mutationSurfaceIds.length)) {
      return refuse('finite alternatives and generated parent surfaces must describe the same host')
    }
    const baseline = alternatives.filter(({ surface }) => !surface.contributionIds.length)
    if (baseline.length !== 1 || JSON.stringify(baseline[0].surface.orderedSectionIds)
      !== JSON.stringify(declaration.sections.map(({ id }) => id))) return refuse('base groups differ from the declared section set')
    const requiredLeaves: CrudFormRequiredLeafFact[] = host.requiredPaths.map((payloadPath) => ({
      hostId: declaration.hostId, formVariant: declaration.formVariant, formOperation: declaration.formOperation,
      schemaId: declaration.authoritativeSchema.id, payloadPath,
      coverage: declaration.formOperation === 'create' ? ['section', 'server-default'] : ['section', 'preserve-from-record', 'server-default'],
    }))
    const provider = makeHostProvider(host, route)
    hostProviders.push(provider)
    derivedRouteCapabilities.push({
      features: provider.requireFeatures,
      ready: () => supportsFacadeInterceptors(host, route),
      fact: {
        capabilityId: `${fact.id}.derived-route`,
        protocol: 'crud-form-sections/v1',
        hostId: declaration.hostId, formVariant: declaration.formVariant, formOperation: declaration.formOperation,
        roundTripId: fact.roundTripId, modes: ['domain-adapter'], payloadPaths: [],
        customFieldOwnership: { mode: 'none' }, mutationSurfaces: surfaces, providedDataContractIds: [],
        allowNoopSubmit: false, requiredLeaves, extensionSinkSupport: declaration.extensionSinkSupport,
      },
    })
    hostFacts.set(fact.id, {
      ...fact,
      alternatives: alternatives.map((alternative) => ({
        ...alternative,
        surface: { ...alternative.surface, mutationSurfaceIds: surfaces.map(({ id }) => id) },
        mutationSurfaces: surfaces,
      })),
    } satisfies CrudFormSectionHostFact)
  }
  const bound = { ...sections, hostFacts: [...hostFacts.values()], hostProviders }
  rememberDerivedCrudRouteCapabilities(bound, derivedRouteCapabilities)
  return bound
}

function errorResponse(error: unknown): Response {
  if (isCrudHttpError(error)) return Response.json(error.body, { status: error.status, headers: crudFormSectionsPrivateHeaders })
  if (error instanceof z.ZodError) {
    return Response.json({ error: 'invalid_request' }, { status: 400, headers: crudFormSectionsPrivateHeaders })
  }
  const rejection = getCommandInterceptorHttpRejection(error)
  if (!rejection) throw error
  return Response.json(rejection.body, { status: rejection.status, headers: crudFormSectionsPrivateHeaders })
}

async function readRoutePayload(request: Request, maxBytes: number): Promise<Payload> {
  let bytes: Uint8Array
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
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new CrudHttpError(400, { error: 'invalid_request' })
  }
  if (!isRecord(raw)) throw new CrudHttpError(400, { error: 'invalid_request' })
  return raw
}

function methodOperation(method: CrudSectionRouteMethod): CrudSectionRouteOperation {
  if (method === 'DELETE') return 'delete'
  return method === 'POST' ? 'create' : 'update'
}

function toCommandInput(
  declaration: CrudRouteSectionHostDeclaration,
  operation: CrudSectionRouteOperation,
  payload: Payload,
  id: string | undefined,
  expectedUpdatedAt: string | null,
): Payload {
  const body = {
    ...payload,
    ...(id === undefined ? {} : { id }),
    ...(expectedUpdatedAt && declaration.expectedVersionField
      ? { [declaration.expectedVersionField]: expectedUpdatedAt } : {}),
  }
  return operation === 'delete' && declaration.delete?.inputStyle !== 'direct' ? { body, query: { id } } : body
}

function projectCommandInput(
  declaration: CrudRouteSectionHostDeclaration, operation: CrudSectionRouteOperation, input: unknown,
): { payload: Payload; id?: string; expectedUpdatedAt: string | null } | null {
  if (!isRecord(input)) return null
  const nestedDelete = operation === 'delete' && declaration.delete?.inputStyle !== 'direct'
  const body = nestedDelete ? input.body : input
  if (!isRecord(body) || Object.keys(body).some((key) => scopeSelectors.has(key))) return null
  if (nestedDelete && (Object.keys(input).some((key) => key !== 'query' && key !== 'body')
      || !isRecord(input.query) || Object.keys(input.query).some((key) => key !== 'id') || input.query.id !== body.id)) return null
  const value = { ...body }
  const id = value.id
  if (id !== undefined && typeof id !== 'string') return null
  delete value.id
  const versionField = declaration.expectedVersionField
  const version = versionField ? value[versionField] : undefined
  if (versionField) delete value[versionField]
  if (version !== undefined && (typeof version !== 'string' || !normalizeIsoToken(version))) return null
  return {
    payload: value, id,
    expectedUpdatedAt: typeof version === 'string' ? normalizeIsoToken(version) : null,
  }
}

function chooseHost(hosts: readonly DerivedHost[], method: CrudSectionRouteMethod, request: Request): DerivedHost | undefined {
  const operation = methodOperation(method)
  const parents = hosts.filter(({ declaration }) => operation === 'delete' ? Boolean(declaration.delete)
    : declaration.formOperation === operation)
  if (parents.length < 2) return parents[0]
  const headers = parseCrudFormSectionPolicyHeaders(request.headers)
  const token = headers && decodeCrudFormSectionPolicyToken(headers.policyToken)
  return parents.find(({ declaration }) => token?.hostId === declaration.hostId
    && token?.formVariant === declaration.formVariant && token?.formOperation === declaration.formOperation) ?? parents[0]
}

async function handleDerivedMutation(
  hosts: readonly DerivedHost[],
  method: CrudSectionRouteMethod,
  route: string,
  request: Request,
): Promise<Response> {
  const source = hosts[0].source
  const ctx = await source.requestContext(request)
  if (!ctx.auth?.tenantId) throw new CrudHttpError(401, { error: 'unauthorized' })
  if (ctx.organizationScope?.selectionRejected || ctx.organizationIds?.length === 0) {
    throw new CrudHttpError(404, { error: 'not_found' })
  }
  const requiredFeatures = source.metadata[method]?.requireFeatures ?? []
  const initialScope = { tenantId: ctx.auth.tenantId, organizationId: ctx.selectedOrganizationId, allowedOrganizationIds: ctx.organizationIds }
  const rbac = ctx.container.resolve<{
    userHasAllFeatures(actor: string, features: string[], scope: ScopedBinding): Promise<boolean>
  }>('rbacService')
  if (!await rbac.userHasAllFeatures(ctx.auth.sub, requiredFeatures, initialScope)) {
    throw new CrudHttpError(403, { error: 'forbidden' })
  }
  const host = chooseHost(hosts, method, request)
  if (!host) throw new CrudHttpError(404, { error: 'not_found' })
  const { declaration } = host
  const operation = methodOperation(method)
  const surface = mutationSurface(host, operation, route)
  const body = await readRoutePayload(request, declaration.maxBodyBytes)
  const query = new URL(request.url).searchParams
  if ([...query.keys()].some((key) => key !== 'id') || query.getAll('id').length > 1) {
    throw new CrudHttpError(400, { error: 'invalid_request' })
  }
  const identified = requestIdSchema.safeParse(body)
  const bodyId = identified.success ? identified.data.id : undefined
  const queryId = query.get('id') ?? undefined
  if (!identified.success || (bodyId && queryId && bodyId !== queryId)
      || (operation === 'create' && (bodyId || queryId))
      || Object.keys(body).some((key) => scopeSelectors.has(key))
      || (declaration.expectedVersionField && Object.hasOwn(body, declaration.expectedVersionField))) {
    throw new CrudHttpError(400, { error: 'invalid_request' })
  }
  const rawId = bodyId ?? queryId
  const parsedId = (declaration.idSchema ?? z.uuid()).safeParse(rawId)
  const id = operation === 'create' ? undefined : parsedId.success ? parsedId.data : undefined
  if (operation !== 'create' && (!id || id !== rawId)) throw new CrudHttpError(404, { error: 'not_found' })

  const headers = new Headers(request.headers)
  headers.delete('content-length')
  headers.set('content-type', 'application/json')
  const optimisticHeader = headers.get(OPTIMISTIC_LOCK_HEADER_NAME)
  const declaredVersion = surface.optimisticLock === 'target-required' && optimisticHeader && !optimisticHeader.includes(',')
    ? normalizeIsoToken(optimisticHeader) : null
  const payload = { ...body }
  delete payload.id
  const facadeRequest = new Request(request.url, { method, headers, body: JSON.stringify(payload) })
  const identity = {
    address: { hostId: declaration.hostId, formVariant: declaration.formVariant, formOperation: declaration.formOperation },
    host: { hostResourceKind: source.resourceKind, hostResourceId: id },
    target: { resourceKind: source.resourceKind, resourceId: id },
    resourceBindingIds: [],
  }
  let commandContext = ctx
  let logEntry: unknown = null
  let preparedCommand: Awaited<ReturnType<CrudRouteSectionSource['prepareCommand']>> | undefined
  let dispatchedInput: Payload | undefined
  const action = source.actions[operation]!
  const submitSchema = operation === 'delete' ? declaration.delete?.schema : host.submitSchema
  const common: Omit<Extract<CrudFormSectionMutationFacadeOptions<Payload, unknown>, { operation: 'update' }>, 'operation'> = {
    request: facadeRequest,
    auth: ctx.auth,
    container: ctx.container,
    scope: initialScope,
    routePattern: route,
    method,
    requiredFeatures,
    mutationSurfaceId: surface.id,
    requestOperation: operation,
    delegatedTarget: surface.delegatedTarget,
    bodySchema: operation === 'delete' ? emptyBodySchema : declaration.projectedSchema,
    maxBodyBytes: declaration.maxBodyBytes,
    async authorizeRoute({ container, scope }) {
      const record = id ? await readBoundRecord(source, container.resolve<EntityManager>('em'), id, scope) : null
      if (id && !record) return null
      const orgField = source.orm.orgField
      const targetOrganizationId = orgField ? record ? record[orgField] : scope.organizationId : null
      if (orgField && typeof targetOrganizationId !== 'string') return null
      return { ...identity, targetOrganizationId: typeof targetOrganizationId === 'string' ? targetOrganizationId : null }
    },
    async validateDomain(projected) {
      if (!submitSchema) return
      const checked = await submitSchema.safeParseAsync(toCommandInput(declaration, operation, projected, id, declaredVersion))
      if (checked.success) return
      throw checked.error
    },
    projectFinalInput(input, context) {
      if (!supportsFacadeInterceptors(host, route)) return null
      const projected = projectCommandInput(declaration, operation, input)
      if (!projected) return null
      return {
        ...identity,
        host: { ...identity.host, hostResourceId: projected.id },
        target: { ...identity.target, resourceId: projected.id },
        targetOrganizationId: context.scope.organizationId,
        payload: projected.payload,
        expectedUpdatedAt: projected.expectedUpdatedAt,
      }
    },
    async preparePayload(activePayload, context) {
      if (!supportsFacadeInterceptors(host, route) || !context.transactionalEm
          || (operation === 'create' && optimisticHeader !== null)
          || (surface.optimisticLock === 'target-required' && optimisticHeader === null)) return rejectDerivedMutation()
      if (surface.optimisticLock === 'target-required' && declaredVersion === null) {
        throw new CrudHttpError(400, { error: 'invalid_request' })
      }
      const organizationId = context.scope.organizationId
      const originalUrl = new URL(request.url)
      originalUrl.pathname = originalUrl.pathname.replace(/\/section-policy\/?$/i, '')
      const raw = toCommandInput(declaration, operation, activePayload, id, declaredVersion)
      const originalBody = operation === 'delete' && declaration.delete?.inputStyle !== 'direct' ? raw.body : raw
      const originalRequest = new Request(originalUrl, { method, headers: new Headers(headers), body: JSON.stringify(originalBody) })
      if (!bindMatchedApiRoutePath(originalRequest, route.slice(0, -sectionPolicySuffix.length), {})) return rejectDerivedMutation()
      commandContext = {
        ...ctx,
        auth: { ...context.auth, orgId: organizationId },
        selectedOrganizationId: organizationId,
        organizationIds: organizationId ? [organizationId] : null,
        organizationScope: ctx.organizationScope ? {
          ...ctx.organizationScope, selectedId: organizationId, filterIds: organizationId ? [organizationId] : null,
        } : null,
        request: facadeRequest,
      }
      const normalizeContext = {
        ...commandContext,
        auth: commandContext.auth && structuredClone(commandContext.auth),
        organizationScope: commandContext.organizationScope && structuredClone(commandContext.organizationScope),
        organizationIds: commandContext.organizationIds?.slice() ?? null,
        container: ctx.container.createScope().register({ em: asValue(context.transactionalEm) }),
        request: originalRequest,
      }
      preparedCommand = await source.prepareCommand({
        operation, raw, directDelete: declaration.delete?.inputStyle === 'direct', context: normalizeContext,
        request: normalizeContext.request, resourceId: id ?? null,
        async readPreviousRecord() {
          return id && context.transactionalEm
            ? readBoundRecord(source, context.transactionalEm, id, context.scope, true)
            : null
        },
      })
      const projected = projectCommandInput(declaration, operation, preparedCommand.input)
      if (!projected || projected.id !== id || projected.expectedUpdatedAt !== declaredVersion) return rejectDerivedMutation()
      return { payload: projected.payload, serverPayloadPaths: [] }
    },
    async execute({ payload: activePayload, commandContext: transaction, expectedUpdatedAt }) {
      if (!preparedCommand || !supportsFacadeInterceptors(host, route)) return rejectDerivedMutation()
      const commandInput = toCommandInput(declaration, operation, activePayload, id, expectedUpdatedAt)
      dispatchedInput = structuredClone(commandInput)
      if (submitSchema) await submitSchema.parseAsync(commandInput)
      const { ambient } = await source.execute(operation, commandInput, { ...commandContext, ...transaction } satisfies CommandRuntimeContext)
      if (!ambient) return refuse('delegated command did not join the façade transaction')
      logEntry = ambient.logEntry
      return ambient
    },
  }
  const result = operation === 'create'
    ? await runCrudFormSectionMutation({
      ...common, operation,
      resolveCommittedResourceId: (created) => isRecord(created) && typeof created.id === 'string' ? created.id : '',
    })
    : operation === 'delete'
      ? await runCrudFormSectionMutation({ ...common, operation, deleteMode: declaration.delete?.mode })
      : await runCrudFormSectionMutation({ ...common, operation })
  const projectedResponse = action.response ? await action.response({ result, logEntry, ctx: commandContext }) : result
  const successStatus = action.status ?? (operation === 'create' ? 201 : 200)
  const committedId = id ?? (isRecord(result) && typeof result.id === 'string' ? result.id : null)
  const after = dispatchedInput && await preparedCommand?.afterCommit({
    input: dispatchedInput, resourceId: committedId, status: successStatus, body: projectedResponse,
  })
  const responseBody = after ? after.body : projectedResponse
  const warnings = isRecord(result) ? extensionWarningsSchema.safeParse(result.extensionWarnings) : null
  const response = warnings?.success ? (isRecord(responseBody) ? { ...responseBody, extensionWarnings: warnings.data }
    : { extensionWarnings: warnings.data }) : responseBody
  const responseHeaders = new Headers(after?.headers)
  for (const [key, value] of Object.entries(crudFormSectionsPrivateHeaders)) responseHeaders.set(key, value)
  return source.attachCommittedOperation(
    Response.json(response, { status: after?.statusCode ?? successStatus, headers: responseHeaders }),
    logEntry,
  )
}

function protectedWireHeaders(operation: CrudSectionRouteOperation, versioned: boolean) {
  const fields = Object.entries(crudFormSectionPolicyHeaderSchema.shape)
    .filter(([key]) => operation !== 'create' || (key !== 'hostResourceId' && key !== 'mutationResourceId'))
    .map(([key, schema]) => [
      crudFormSectionPolicyHeaderNames[key as keyof typeof crudFormSectionPolicyHeaderNames],
      key === 'hostResourceId' || key === 'mutationResourceId' ? resourceIdSchema : schema,
    ])
  return z.object({
    ...Object.fromEntries(fields),
    ...(versioned ? { [OPTIMISTIC_LOCK_HEADER_NAME]: z.iso.datetime() } : {}),
  })
}

export function createDerivedCrudFormSectionFacade(
  declarations: readonly CrudRouteSectionHostDeclaration[],
  route: string,
  methods: readonly CrudSectionRouteMethod[],
) {
  assertStaticPolicyRoute(route)
  const hosts = declarations.map(derivedHost)
  if (!hosts.length || hosts.some(({ source }) => source !== hosts[0].source)) return refuse('façade can only represent one original factory route')
  const handlers: Partial<Record<CrudSectionRouteMethod, (request: Request) => Promise<Response>>> = {}
  const metadata: CrudRouteSectionSource['metadata'] & { path: string } = { path: route }
  const openApi: OpenApiRouteDoc = { summary: 'Mutate a CrudForm section policy', methods: {} }
  for (const method of methods) {
    const operation = methodOperation(method)
    const relevant = hosts.filter(({ declaration }) => operation === 'delete' ? Boolean(declaration.delete) : declaration.formOperation === operation)
    if (!relevant.length) return refuse(`method ${method} has no qualified declaration`)
    const [primary] = relevant
    const routeMetadata = primary.source.metadata[method]
    const responseSchema = primary.declaration.responseSchemas[method]
    const action = primary.source.actions[operation]
    if (!routeMetadata || !responseSchema || !action) return refuse(`method ${method} is missing original route metadata or response schema`)
    metadata[method] = routeMetadata
    const allowsSinks = relevant.some(({ declaration }) => declaration.extensionSinkSupport !== 'none')
    const allowsOutbox = relevant.some(({ declaration }) => declaration.extensionSinkSupport === 'host-transaction')
    const bodySchemas = relevant.map(({ declaration }) => (operation === 'delete' ? emptyBodySchema : declaration.projectedSchema)
      .extend({
        ...(operation === 'create' ? {} : { id: (declaration.idSchema ?? z.uuid()).optional() }),
        ...(operation !== 'delete' && declaration.extensionSinkSupport !== 'none'
          ? { extensions: z.record(z.string(), z.record(z.string(), z.unknown())).optional() } : {}),
      }))
    const successSchema = allowsSinks && responseSchema instanceof z.ZodObject
      ? responseSchema.extend({ extensionWarnings: extensionWarningsSchema.optional() }) : responseSchema
    const rejected = allowsSinks
      ? z.union([crudFormSectionHiddenFieldInvalidResponseSchema, crudFormSectionMutationGuardRejectedResponseSchema, sinkValidationSchema, errorSchema])
      : z.union([crudFormSectionHiddenFieldInvalidResponseSchema, crudFormSectionMutationGuardRejectedResponseSchema, errorSchema])
    const requestBody = bodySchemas.length > 1 ? z.union(bodySchemas) : bodySchemas[0]
    openApi.methods[method] = {
      summary: 'Apply the current CrudForm section policy',
      requestBody: { schema: requestBody, contentType: 'application/json' },
      query: z.object({ id: resourceIdSchema.optional() }).strict(),
      headers: protectedWireHeaders(operation, operation !== 'create' && Boolean(primary.updatedAtField)),
      responses: [{ status: action.status ?? (operation === 'create' ? 201 : 200), description: 'Mutation accepted', schema: successSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Feature required', schema: errorSchema },
        { status: 404, description: 'Resource unavailable', schema: errorSchema },
        { status: 409, description: 'Policy or record version conflict', schema: z.union([crudFormSectionPolicyMismatchResponseSchema, optimisticConflictSchema]) },
        { status: 413, description: 'Request exceeds configured body limit', schema: errorSchema },
        { status: 422, description: 'Mutation rejected', schema: rejected },
        ...(operation !== 'delete' && allowsOutbox
          ? [{ status: 503, description: 'Read-only external validation unavailable', schema: externalUnavailableSchema }] : []),
      ],
    }
    handlers[method] = async (request) => {
      try {
        return await handleDerivedMutation(hosts, method, route, request)
      } catch (error) {
        return errorResponse(error)
      }
    }
  }
  return { metadata, openApi, handlers }
}
