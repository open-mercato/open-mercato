import { z } from 'zod'
import { authorizeFeatures } from '../../../security/featurePolicy'
import type { CrudFormSectionAcceptedPolicy, CrudFormSectionManifest } from './manifest'
import type { ResponseEnricher } from '../response-enricher'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandUndoLogEntry } from '../../commands/types'
import { createLogger } from '../../logger'
import { reportTelemetryError } from '../../telemetry/runtime'
import { isRecord } from '../../utils'
import type { CrudFormSectionAddress, CrudFormExtensionSinkFact } from '../../../modules/form-section-facts'
import type {
  CrudFormSectionServerModule, CrudFormSectionSink, CrudFormSectionSinkSnapshot,
} from '../../../modules/form-sections'
import { CrudHttpError } from '../errors'
import { normalizeIsoToken } from '../optimistic-lock'
import { assertOptimisticLock, enforceRecordGoneIsConflict } from '../optimistic-lock-command'
import type { CrudFormSectionCapabilityEntry } from '../form-section-capabilities'
import { compareSectionIds, crudFormSectionHostKey } from './composition'
import { resourceIdSchema, roundTripIdSchema, symbolicIdSchema } from './protocol'
import { collectCrudFormSectionOutboxRuntimes, crudFormSectionOutboxRevisionSchema, crudFormSectionOutboxSyncSchema, validCrudFormSectionExternalDelivery } from './outbox'

type Payload = Record<string, unknown>
type HostAddress = Omit<CrudFormSectionAddress, 'sectionId'>
type SinkMutationContext = Omit<Parameters<CrudFormSectionSink['persist']>[0], 'values' | 'hostOperation' | 'lockedRow'>
type SinkMutationSource = HostAddress & { mutationSurfaceId: string }

export type AcceptedCrudFormSectionSink = {
  fact: CrudFormExtensionSinkFact
  capabilityId: string
  hostDetailEntityId: string
}

type SinkWork = { runtime: CrudFormSectionSink; values: Payload; expectedUpdatedAt: string | null }
export type PreparedCrudFormSectionSinks = {
  hostPayload: Payload
  extensionEnvelope: Payload
  work: readonly SinkWork[]
}

export type CrudFormSectionSinkWarning = { sinkId: string; code: 'extension_sink_failed' }

const logger = createLogger('shared:crud-form-sections')
const unsafePathSegments = new Set(['__proto__', 'prototype', 'constructor', '__updatedAt', '__sync'])

function isSafeSegment(segment: string): boolean {
  return !!segment && !segment.includes('.') && !unsafePathSegments.has(segment)
}

function localPath(fact: CrudFormExtensionSinkFact, absolute: string): string | null {
  const prefix = `extensions.${fact.ownerModuleId}.`
  if (typeof absolute !== 'string' || !absolute.startsWith(prefix)) return null
  const path = absolute.slice(prefix.length)
  return path.split('.').every(isSafeSegment) ? path : null
}

function compareSinks(left: AcceptedCrudFormSectionSink, right: AcceptedCrudFormSectionSink): number {
  return compareSectionIds(left.fact.id, right.fact.id)
}

export function collectCrudFormSectionSinks(modules: readonly CrudFormSectionServerModule[]): Map<string, CrudFormSectionSink> {
  const sinks = new Map<string, CrudFormSectionSink>()
  const seen = new Set<string>()
  for (const { moduleId, sections } of modules) {
    for (const sink of sections.sinks ?? []) {
      const fact = sink?.fact
      if (!fact || !symbolicIdSchema.safeParse(fact.id).success) continue
      if (seen.has(fact.id)) {
        sinks.delete(fact.id)
        continue
      }
      seen.add(fact.id)
      if (fact.ownerModuleId !== moduleId || !isSafeSegment(fact.ownerModuleId)
          || typeof fact.roundTripId !== 'string' || !fact.roundTripId.startsWith(`${fact.id}@v`)
          || !/^[1-9][0-9]*$/.test(fact.roundTripId.slice(fact.id.length + 2))
          || !symbolicIdSchema.safeParse(sink.capabilityId).success
          || !symbolicIdSchema.safeParse(sink.hostDetailEntityId).success
          || !symbolicIdSchema.safeParse(fact.targetEntityId).success
          || !['host-transaction', 'after-commit', 'outbox'].includes(fact.atomicity)
          || !validCrudFormSectionExternalDelivery(fact, sink.outbox)
          || !Array.isArray(fact.payloadPaths) || !fact.payloadPaths.length
          || new Set(fact.payloadPaths).size !== fact.payloadPaths.length
          || !fact.payloadPaths.every((path) => localPath(fact, path))
          || typeof sink.schema?.safeParseAsync !== 'function'
          || typeof sink.persist !== 'function' || typeof sink.load !== 'function'
          || (sink.onHostDeleted !== undefined && (fact.atomicity === 'after-commit' || typeof sink.onHostDeleted !== 'function'))
          || (fact.atomicity === 'outbox' && (typeof sink.onHostDeleted !== 'function' || fact.optimisticLock !== 'sink-version'))
          || (fact.optimisticLock === 'sink-version' ? typeof sink.lockRow !== 'function'
            : fact.optimisticLock !== 'none' || sink.appendOnly !== true)
          || (fact.undo === 'snapshot' ? fact.atomicity === 'after-commit' || typeof sink.undo !== 'function'
            : fact.undo !== 'unsupported')) continue
      sinks.set(fact.id, sink)
    }
  }
  const outboxRuntimes = collectCrudFormSectionOutboxRuntimes(sinks.values())
  for (const [id, sink] of sinks) {
    if (sink.outbox && !outboxRuntimes.has(sink.fact.targetEntityId)) sinks.delete(id)
  }
  return sinks
}

export function selectCrudFormSectionSinks(input: {
  candidates: Iterable<CrudFormSectionSink>
  address: HostAddress
  hostResourceKind: string
  capabilities: readonly CrudFormSectionCapabilityEntry[]
  ownedPaths: ReadonlySet<string>
}): AcceptedCrudFormSectionSink[] | null {
  const { candidates, address, capabilities, ownedPaths } = input
  const selected: AcceptedCrudFormSectionSink[] = []
  const available = [...candidates]
  const seen = new Set<string>()
  for (const { fact: capability } of capabilities) {
    if (!capability.modes.includes('extension-sink')) continue
    const matches = available.filter(({ fact, capabilityId }) =>
      capabilityId === capability.capabilityId && crudFormSectionHostKey(fact) === crudFormSectionHostKey(address))
    const paths = matches.flatMap(({ fact }) => fact.payloadPaths).sort(compareSectionIds)
    if (!matches.length || matches.some(({ hostDetailEntityId }) => hostDetailEntityId !== input.hostResourceKind)
        || paths.length !== capability.payloadPaths.length
        || paths.some((path, index) => path !== capability.payloadPaths[index]
          || !ownedPaths.has(path) || (index > 0 && path === paths[index - 1]) || seen.has(path))) return null

    for (const path of paths) seen.add(path)
    for (const { fact, capabilityId, hostDetailEntityId } of matches) {
      selected.push({ fact: { ...fact, payloadPaths: [...fact.payloadPaths].sort(compareSectionIds) }, capabilityId, hostDetailEntityId })
    }
  }
  if ([...ownedPaths].some((path) => path.startsWith('extensions.') && !seen.has(path))) return null
  const exclusiveTargets = selected.filter(({ fact }) => fact.atomicity === 'outbox' || available.some((sink) =>
    sink.fact.id === fact.id && sink.tableVersioned)).map(({ fact }) => fact.targetEntityId)
  if (new Set(exclusiveTargets).size !== exclusiveTargets.length) return null
  return selected.sort(compareSinks)
}

export function crudFormSectionSinkAtomicities(
  sinks: Iterable<CrudFormSectionSink>, address: HostAddress,
): Map<string, CrudFormExtensionSinkFact['atomicity'][]> {
  const result = new Map<string, CrudFormExtensionSinkFact['atomicity'][]>()
  for (const { capabilityId, fact } of sinks) {
    if (crudFormSectionHostKey(fact) !== crudFormSectionHostKey(address)) continue
    const modes = result.get(capabilityId) ?? []
    modes.push(fact.atomicity)
    result.set(capabilityId, modes)
  }
  return result
}

function mismatch(): never {
  throw new CrudHttpError(409, { error: 'extension_policy_mismatch', code: 'extension_policy_mismatch' })
}

function requireRegisteredSink(manifest: CrudFormSectionManifest, accepted: AcceptedCrudFormSectionSink): CrudFormSectionSink {
  const { fact, capabilityId, hostDetailEntityId } = accepted
  const runtime = manifest.sinkRuntimes?.get(fact.id)
  if (!runtime || runtime.fact.roundTripId !== fact.roundTripId
      || runtime.fact.ownerModuleId !== fact.ownerModuleId || runtime.fact.targetEntityId !== fact.targetEntityId
      || crudFormSectionHostKey(runtime.fact) !== crudFormSectionHostKey(fact)
      || runtime.capabilityId !== capabilityId || runtime.hostDetailEntityId !== hostDetailEntityId) return mismatch()
  return runtime
}

export function selectCrudFormSectionHostDeleteSinks(
  manifest: CrudFormSectionManifest,
  hostId: string,
  hostResourceKind: string,
): CrudFormSectionSink[] {
  const runtimes = [...(manifest.sinkRuntimes?.values() ?? [])].filter((runtime) =>
    runtime.fact.hostId === hostId && runtime.hostDetailEntityId === hostResourceKind && !!runtime.onHostDeleted)
    .sort((left, right) => compareSectionIds(left.fact.id, right.fact.id))
  const seen = new Set<string>()
  const selected: CrudFormSectionSink[] = []
  for (const runtime of runtimes) {
    const rowIdentity = JSON.stringify([runtime.fact.ownerModuleId, runtime.fact.targetEntityId])
    if (seen.has(rowIdentity)) continue
    seen.add(rowIdentity)
    selected.push(runtime)
  }
  return selected
}

function leafEntries(record: Payload, allowed: ReadonlySet<string>, strict = true): Map<string, unknown> {
  const branches = new Set<string>()
  for (const path of allowed) {
    for (let index = path.indexOf('.'); index >= 0; index = path.indexOf('.', index + 1)) {
      branches.add(path.slice(0, index))
    }
  }
  const pending = [{ record, prefix: '' }]
  const result = new Map<string, unknown>()
  while (pending.length) {
    const { record: branch, prefix } = pending.pop()!
    for (const [key, value] of Object.entries(branch)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (isSafeSegment(key) && branches.has(path) && isRecord(value) && Object.keys(value).length) {
        pending.push({ record: value, prefix: path })
      } else if (isSafeSegment(key) && allowed.has(path) && (
        !isRecord(value) || value instanceof Date || !Object.keys(value).length
      )) {
        result.set(path, value)
      } else if (strict) return mismatch()
    }
  }
  return result
}

function declaredPaths(fact: CrudFormExtensionSinkFact): string[] {
  return fact.payloadPaths.flatMap((path) => localPath(fact, path) ?? [])
}

function writeLeaf(record: Payload, path: string, value: unknown): void {
  const segments = path.split('.')
  let current = record
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment]
    if (isRecord(existing) && Object.hasOwn(current, segment)) {
      current = existing
    } else {
      const next: Payload = {}
      current[segment] = next
      current = next
    }
  }
  current[segments[segments.length - 1]] = value
}

function versionFromWire(value: unknown): string {
  const parsed = typeof value === 'string' && !value.includes(',') ? normalizeIsoToken(value) : null
  if (!parsed) return mismatch()
  return parsed
}

function collectVersionTokens(version: unknown, sinks: readonly AcceptedCrudFormSectionSink[]): Map<string, string> {
  const versioned = sinks.filter(({ fact }) => fact.optimisticLock === 'sink-version')
  if (version === undefined) return new Map()
  if (typeof version === 'string' && versioned.length === 1) {
    return new Map([[versioned[0].fact.id, versionFromWire(version)]])
  }
  if (!isRecord(version) || !Object.keys(version).length || versioned.length < 2) return mismatch()
  const ids = new Set(versioned.map(({ fact }) => fact.id))
  const tokens = new Map<string, string>()
  for (const [id, value] of Object.entries(version)) {
    if (!ids.has(id)) return mismatch()
    tokens.set(id, versionFromWire(value))
  }
  return tokens
}

function messagePath(fact: CrudFormExtensionSinkFact, path: PropertyKey[]): string {
  const suffix = path.length ? path.map(String).join('.') : localPath(fact, fact.payloadPaths[0])
  return `extensions.${fact.ownerModuleId}.${suffix}`
}

export async function prepareCrudFormSectionSinks(input: {
  payload: Payload
  accepted: readonly AcceptedCrudFormSectionSink[]
  runtimes: ReadonlyMap<string, CrudFormSectionSink>
  allowWrites: boolean
  creating: boolean
}): Promise<PreparedCrudFormSectionSinks> {
  const { extensions, ...hostPayload } = input.payload
  if (!Object.hasOwn(input.payload, 'extensions')) return { hostPayload, extensionEnvelope: {}, work: [] }
  if (!input.allowWrites || !isRecord(extensions)) return mismatch()
  const extensionEnvelope: Payload = {}
  const work: SinkWork[] = []
  const fieldErrors: Record<string, string> = {}
  for (const [owner, rawFields] of Object.entries(extensions)) {
    const eligible = input.accepted.filter(({ fact }) => fact.ownerModuleId === owner)
    if (!eligible.length || !isRecord(rawFields)) return mismatch()
    const { __updatedAt, ...fields } = rawFields
    const tokens = collectVersionTokens(__updatedAt, eligible)
    if (input.creating && tokens.size) return mismatch()
    const present = leafEntries(fields, new Set(eligible.flatMap(({ fact }) => declaredPaths(fact))))
    const normalized: Payload = {}
    for (const accepted of eligible) {
      const { fact } = accepted
      const runtime = input.runtimes.get(fact.id)
      if (!runtime || runtime.fact.roundTripId !== fact.roundTripId) return mismatch()
      const declared = new Set(declaredPaths(fact))
      const projection: Payload = {}
      for (const [path, value] of present) {
        if (declared.has(path)) writeLeaf(projection, path, value)
      }
      if (!Object.keys(projection).length) {
        if (tokens.has(fact.id)) return mismatch()
        continue
      }
      for (const path of declared) present.delete(path)
      const parsed = await runtime.schema.safeParseAsync(projection)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          fieldErrors[messagePath(fact, issue.path)] = 'crud_form_section_sink_field_invalid'
        }
        continue
      }
      if (!isRecord(parsed.data)) return mismatch()
      for (const [path, value] of leafEntries(parsed.data, declared)) {
        writeLeaf(normalized, path, value)
      }
      work.push({ runtime, values: parsed.data, expectedUpdatedAt: tokens.get(fact.id) ?? null })
    }
    if (present.size) return mismatch()
    if (tokens.size) {
      normalized.__updatedAt = typeof __updatedAt === 'string' ? [...tokens.values()][0] : Object.fromEntries(tokens)
    }
    extensionEnvelope[owner] = normalized
  }
  if (Object.keys(fieldErrors).length) {
    throw new CrudHttpError(422, { error: 'validation_failed', code: 'validation_failed', fieldErrors })
  }
  return { hostPayload, extensionEnvelope, work }
}

export async function persistCrudFormSectionSink(
  work: SinkWork, context: SinkMutationContext, hostOperation: 'create' | 'update',
): Promise<CrudFormSectionSinkSnapshot> {
  if (!context.em.isInTransaction()) throw new Error('[internal] CrudForm sink requires an active transaction')
  const { runtime, expectedUpdatedAt } = work
  const lockedRow = runtime.lockRow ? await runtime.lockRow(context) : null
  if (runtime.fact.optimisticLock === 'sink-version') {
    const version = { resourceKind: runtime.fact.targetEntityId, resourceId: context.hostResourceId, expected: expectedUpdatedAt, envValue: 'all' }
    if (lockedRow) {
      const current = lockedRow.updatedAt instanceof Date ? lockedRow.updatedAt
        : typeof lockedRow.updatedAt === 'string' ? normalizeIsoToken(lockedRow.updatedAt) : null
      if (!expectedUpdatedAt || !current || (current instanceof Date && !Number.isFinite(current.getTime()))) return mismatch()
      assertOptimisticLock({ ...version, current })
    } else if (expectedUpdatedAt) {
      enforceRecordGoneIsConflict(version)
    }
  }
  return runtime.persist({ ...context, hostOperation, values: work.values, lockedRow })
}

const hostAddressSchema = z.object({
  hostId: symbolicIdSchema,
  formVariant: symbolicIdSchema,
  formOperation: z.enum(['create', 'update']),
}).strict()

const snapshotSchema = z.object({
  protocol: z.literal('crud-form-section-sink/v1'),
  sinkId: symbolicIdSchema,
  roundTripId: roundTripIdSchema,
  capabilityId: symbolicIdSchema,
  address: hostAddressSchema,
  source: hostAddressSchema.extend({ mutationSurfaceId: symbolicIdSchema }),
  hostResourceKind: symbolicIdSchema,
  hostResourceId: resourceIdSchema,
  targetEntityId: symbolicIdSchema,
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  outboxAfterRevision: crudFormSectionOutboxRevisionSchema.optional(),
  tableAfterUpdatedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  tableBeforeUpdatedAt: z.iso.datetime({ offset: true }).nullable().optional(),
}).strict()

type PersistedSnapshot = z.infer<typeof snapshotSchema>

export function appendCrudFormSectionSinkSnapshot(
  log: CommandUndoLogEntry | null,
  runtime: CrudFormSectionSink,
  hostResourceId: string,
  snapshot: CrudFormSectionSinkSnapshot,
  source: SinkMutationSource,
): void {
  if (!log?.id || log.resourceId !== hostResourceId || (log.undoToken && runtime.fact.undo !== 'snapshot')) return mismatch()
  if ((runtime.fact.atomicity === 'outbox') !== (snapshot.outboxAfterRevision !== undefined)
      || (runtime.tableVersioned === true) !== (snapshot.tableAfterUpdatedAt !== undefined)
      || (runtime.tableVersioned === true) !== (snapshot.tableBeforeUpdatedAt !== undefined)) return mismatch()
  const entry = snapshotSchema.safeParse({
    ...snapshot,
    protocol: 'crud-form-section-sink/v1',
    sinkId: runtime.fact.id,
    roundTripId: runtime.fact.roundTripId,
    capabilityId: runtime.capabilityId,
    address: {
      hostId: runtime.fact.hostId, formVariant: runtime.fact.formVariant, formOperation: runtime.fact.formOperation,
    },
    source,
    hostResourceKind: runtime.hostDetailEntityId,
    hostResourceId,
    targetEntityId: runtime.fact.targetEntityId,
  })
  if (!entry.success) return mismatch()
  if (log.contextJson != null && !isRecord(log.contextJson)) return mismatch()
  const context = log.contextJson ?? {}
  if (Object.hasOwn(context, 'extensions') && !isRecord(context.extensions)) return mismatch()
  const existing = isRecord(context.extensions) ? context.extensions : {}
  const owner = runtime.fact.ownerModuleId
  if (Object.hasOwn(existing, owner) && !isRecord(existing[owner])) return mismatch()
  const ownerSinks = isRecord(existing[owner]) ? existing[owner] : {}
  if (Object.hasOwn(ownerSinks, runtime.fact.id)) return mismatch()
  log.contextJson = {
    ...context,
    extensions: { ...existing, [owner]: { ...ownerSinks, [runtime.fact.id]: structuredClone(entry.data) } },
  }
}

export function readCrudFormSectionSinkSnapshots(log: CommandUndoLogEntry): Array<{ owner: string; snapshot: PersistedSnapshot }> {
  const raw = log.contextJson?.extensions
  if (!isRecord(raw)) return []
  const found: Array<{ owner: string; snapshot: PersistedSnapshot }> = []
  for (const [owner, entries] of Object.entries(raw)) {
    if (!isRecord(entries)) continue
    for (const [id, entry] of Object.entries(entries)) {
      if (!isRecord(entry) || entry.protocol !== 'crud-form-section-sink/v1') continue
      const parsed = snapshotSchema.safeParse(entry)
      if (!parsed.success || parsed.data.sinkId !== id || parsed.data.hostResourceId !== log.resourceId
          || parsed.data.hostResourceKind !== log.resourceKind
          || !isSafeSegment(owner)) return mismatch()
      found.push({ owner, snapshot: parsed.data })
    }
  }
  return found.sort((left, right) => compareSectionIds(right.snapshot.sinkId, left.snapshot.sinkId))
}

type SinkUndo = { runtime: CrudFormSectionSink; snapshot: PersistedSnapshot }
type SinkUndoRbac = {
  userHasAllFeaturesWithEntityManager?(
    em: EntityManager, userId: string, features: string[], scope: SinkMutationContext['scope'],
  ): Promise<boolean>
}

function matchesSnapshotHost(policy: CrudFormSectionAcceptedPolicy | undefined, snapshot: PersistedSnapshot): boolean {
  return policy?.hostResourceKind === snapshot.hostResourceKind && policy.surface.hostId === snapshot.address.hostId
}

export async function authorizeCrudFormSectionSinkUndo(input: {
  snapshots: ReturnType<typeof readCrudFormSectionSinkSnapshots>
  manifest: CrudFormSectionManifest
  commandId: string
  context: Omit<SinkMutationContext, 'hostResourceId'>
}): Promise<SinkUndo[]> {
  const { context, manifest } = input
  if (!context.em.isInTransaction()) return mismatch()
  const features = new Set<string>()
  const work = input.snapshots.map(({ owner, snapshot }) => {
    const sinkKey = crudFormSectionHostKey(snapshot.address)
    const sourceKey = crudFormSectionHostKey(snapshot.source)
    const policy = manifest.policies.get(sinkKey)
    const sourcePolicy = manifest.policies.get(sourceKey)
    const source = sourcePolicy?.mutationSurfaces.find(({ id }) => id === snapshot.source.mutationSurfaceId)
    const accepted = policy?.sinks?.find(({ fact, capabilityId }) => fact.id === snapshot.sinkId
      && fact.ownerModuleId === owner && fact.roundTripId === snapshot.roundTripId
      && fact.targetEntityId === snapshot.targetEntityId && capabilityId === snapshot.capabilityId)
    if (!policy || !sourcePolicy || !matchesSnapshotHost(policy, snapshot) || !matchesSnapshotHost(sourcePolicy, snapshot)
        || !accepted || !source || (source.kind !== 'parent-delete' && (source.kind !== 'parent-submit' || sourceKey !== sinkKey))
        || source.delegatedTarget.kind !== 'command' || source.delegatedTarget.id !== input.commandId
        || source.hostResourceKind !== snapshot.hostResourceKind || source.mutationResourceKind !== snapshot.hostResourceKind) {
      return mismatch()
    }
    const runtime = requireRegisteredSink(manifest, accepted)
    if (!runtime.undo || runtime.fact.undo !== 'snapshot'
        || ((runtime.fact.atomicity === 'outbox') !== (snapshot.outboxAfterRevision !== undefined))
        || ((runtime.tableVersioned === true) !== (snapshot.tableAfterUpdatedAt !== undefined))
        || (source.kind === 'parent-delete' && !runtime.onHostDeleted)) return mismatch()
    for (const feature of [...policy.requireFeatures, ...sourcePolicy.requireFeatures]) features.add(feature)
    return { runtime, snapshot }
  })
  if (features.size) {
    const rbac = context.container.hasRegistration('rbacService') ? context.container.resolve<SinkUndoRbac>('rbacService') : null
    if (!await rbac?.userHasAllFeaturesWithEntityManager?.(context.em, context.auth.sub, [...features].sort(compareSectionIds), context.scope)) {
      return mismatch()
    }
  }
  return work
}

export async function restoreCrudFormSectionSinks(
  work: readonly SinkUndo[],
  context: Omit<SinkMutationContext, 'hostResourceId'>,
): Promise<void> {
  if (!context.em.isInTransaction()) return mismatch()
  for (const { runtime, snapshot } of work) {
    if (!runtime.undo) return mismatch()
    await runtime.undo({
      ...context, hostResourceId: snapshot.hostResourceId,
      snapshot: {
        before: snapshot.before, after: snapshot.after,
        ...(snapshot.outboxAfterRevision === undefined ? {} : { outboxAfterRevision: snapshot.outboxAfterRevision }),
        ...(snapshot.tableAfterUpdatedAt === undefined ? {} : {
          tableAfterUpdatedAt: snapshot.tableAfterUpdatedAt, tableBeforeUpdatedAt: snapshot.tableBeforeUpdatedAt,
        }),
      },
    })
  }
}

export function reportCrudFormSectionSinkFailure(
  runtime: CrudFormSectionSink, phase: 'after_commit' | 'load' = 'after_commit',
): CrudFormSectionSinkWarning {
  const warning = { sinkId: runtime.fact.id, code: 'extension_sink_failed' } as const
  try {
    logger.error('CrudForm extension sink failed', { ...warning, phase })
  } catch {}
  try {
    reportTelemetryError(new Error('[internal] CrudForm extension sink failed'), {
      module: 'shared', code: 'crud_form_sections.extension_sink_failed', attributes: { ...warning, phase },
    })
  } catch {}
  return warning
}

export function buildCrudFormSectionSinkEnrichers(
  manifest: CrudFormSectionManifest,
): Array<{ moduleId: string; enrichers: ResponseEnricher[] }> {
  const byEntity = new Map<string, Map<string, { sink: AcceptedCrudFormSectionSink; features: readonly string[] }>>()
  for (const policy of manifest.policies.values()) {
    if (policy.surface.formOperation !== 'update') continue
    for (const sink of policy.sinks ?? []) {
      const bySink = byEntity.get(sink.hostDetailEntityId) ?? new Map()
      const existing = bySink.get(sink.fact.id)
      const features = [...new Set([...(existing?.features ?? []), ...policy.requireFeatures])]
      bySink.set(sink.fact.id, { sink, features })
      byEntity.set(sink.hostDetailEntityId, bySink)
    }
  }
  return [...byEntity].map(([entityId, bySink]) => ({
    moduleId: 'crud_form_sections',
    enrichers: [{
      id: `crud_form_sections.${entityId}.extensions`,
      targetEntity: entityId,
      detailOnly: true,
      async enrichOne(record: Payload, context) {
        const id = resourceIdSchema.safeParse(record.id)
        const scopedTenant = Object.hasOwn(record, 'tenantId') ? record.tenantId
          : Object.hasOwn(record, 'tenant_id') ? record.tenant_id : context.tenantId
        const scopedOrganization = Object.hasOwn(record, 'organizationId') ? record.organizationId
          : Object.hasOwn(record, 'organization_id') ? record.organization_id : context.organizationId
        if (!id.success || !context.tenantId || !context.organizationId || !context.userId
            || !context.em || !context.container
            || scopedTenant !== context.tenantId || scopedOrganization !== context.organizationId
            || (record._extensions !== undefined && !isRecord(record._extensions))) return record
        const extensions: Payload = { ...(isRecord(record._extensions) ? record._extensions : {}) }
        const loaded = new Map<string, {
          values: Payload; versions: Map<string, string>; versioned: number
          sync: Map<string, NonNullable<Awaited<ReturnType<CrudFormSectionSink['load']>>>['sync']>; outboxes: number
        }>()
        const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
        for (const { sink, features } of bySink.values()) {
          if (!authorizeFeatures(features, { grantedFeatures: context.userFeatures ?? [] })) continue
          const runtime = manifest.sinkRuntimes?.get(sink.fact.id)
          if (!runtime) continue
          const owner = sink.fact.ownerModuleId
          const values = loaded.get(owner) ?? {
            values: {}, versions: new Map(), versioned: 0, sync: new Map(), outboxes: 0,
          }
          if (sink.fact.optimisticLock === 'sink-version') values.versioned++
          if (sink.fact.atomicity === 'outbox') values.outboxes++
          loaded.set(owner, values)
          try {
            const row = await runtime.load({
              hostResourceId: id.data, scope, userId: context.userId,
              em: context.em as EntityManager, container: context.container as AwilixContainer,
            })
            if (!row) continue
            if (sink.fact.atomicity === 'outbox') {
              const sync = crudFormSectionOutboxSyncSchema.safeParse(row.sync)
              if (sync.success) values.sync.set(sink.fact.id, sync.data)
            }
            const leaves = leafEntries(row.values, new Set(declaredPaths(sink.fact)), false)
            for (const [path, value] of leaves) {
              writeLeaf(values.values, path, value)
            }
            if (sink.fact.optimisticLock === 'sink-version') {
              const value = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt
              const version = typeof value === 'string' ? normalizeIsoToken(value) : null
              if (version) values.versions.set(sink.fact.id, version)
            }
          } catch {
            reportCrudFormSectionSinkFailure(runtime, 'load')
          }
        }
        let added = false
        for (const [owner, { values, versions, versioned, sync, outboxes }] of loaded) {
          if ((!Object.keys(values).length && !sync.size) || Object.hasOwn(extensions, owner)) continue
          if (versions.size) values.__updatedAt = versioned === 1 ? [...versions.values()][0] : Object.fromEntries(versions)
          if (sync.size) values.__sync = outboxes === 1 ? [...sync.values()][0] : Object.fromEntries(sync)
          extensions[owner] = values
          added = true
        }
        return added ? { ...record, _extensions: extensions } : record
      },
    }],
  }))
}
