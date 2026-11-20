import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { compareSectionIds } from './composition'
import {
  defineCrudFormSectionSink, type CrudFormSectionSink, type CrudFormSectionSinkScope,
  type CrudFormSectionSinkSnapshot,
} from '../../../modules/form-sections'
import type { CrudFormExtensionSinkFact } from '../../../modules/form-section-facts'
import { withAtomicFlush } from '../../commands/flush'
import { getTransactionLifetime, onTransactionLifetimeComplete } from '../../commands/transaction-lifetime'
import { calculateBackoffDelayMs } from '../../delivery/retry'
import { resolveSafeHostAddress } from '../../host-pinning'
import { createLogger } from '../../logger'
import { reportTelemetryError } from '../../telemetry/runtime'
import { assertStaticallySafeOutboundUrl, safeOutboundFetch } from '../../url-safety'
import { CrudHttpError } from '../errors'
import { symbolicIdSchema } from './protocol'

const logger = createLogger('shared:crud-form-sections')
const maxRevision = 9_223_372_036_854_775_807n
const validationTimeoutMs = 3000
const deliveryTimeoutMs = 30_000
const failureReportLeaseMs = 60_000
const failureReportRetryMs = 30_000
const uuid = z.uuid().transform((value) => value.toLowerCase())
const outboxScopeSchema = z.object({ tenantId: uuid, organizationId: uuid })
export const crudFormSectionOutboxJobSchema = outboxScopeSchema.extend({
  sinkId: symbolicIdSchema, hostId: uuid,
}).strict()
export type CrudFormSectionOutboxIdentity = z.infer<typeof crudFormSectionOutboxJobSchema>
export type CrudFormSectionOutboxScope = z.infer<typeof outboxScopeSchema>
const outboxErrorSchema = z.enum([
  'delivery_unavailable', 'remote_rejected', 'remote_revision_ahead', 'delivery_contract_mismatch', 'delivery_intent_invalid',
])
export type CrudFormSectionOutboxError = z.infer<typeof outboxErrorSchema>
export const crudFormSectionOutboxSyncSchema = z.strictObject({
  status: z.enum(['pending', 'synced', 'failed']),
  lastAttemptAt: z.iso.datetime().nullable(),
  errorCode: outboxErrorSchema.nullable(),
})
type Values = Record<string, unknown>
type Operation = 'upsert' | 'delete' | 'restore'
type Status = 'pending' | 'synced' | 'failed'
type DeliveryFact = NonNullable<CrudFormExtensionSinkFact['externalDelivery']>
type FailureEffect = 'log' | 'event' | 'notification'
export type CrudFormSectionOutboxFailureReport = {
  id: string
  integrationId: string
  actorId: string | null
  code: CrudFormSectionOutboxError
  notificationType: string
  effects: FailureEffect[]
}
type FailureReporting = {
  failureReports: CrudFormSectionOutboxFailureReport[]
  nextFailureReportAt: Date | null
}

type DeliveryState = {
  syncStatus: Status
  syncAttempts: number
  nextAttemptAt: Date | null
  lastAttemptAt: Date | null
  lastErrorCode: CrudFormSectionOutboxError | null
  externalId: string | null
}
type Intent = DeliveryState & {
  values: Values | null
  updatedAt: Date
  deliveryRevision: string
  deliveryIntegrationId: string
  deliveryContractId: string
  idempotencyKey: string
  pendingOperation: Operation
  deliveryActorId: string | null
}
export type CrudFormSectionOutboxRow = Intent & FailureReporting & {
  id: string
  tenantId: string
  organizationId: string
  hostId: string
}

export type CrudFormSectionOutboxMirror = {
  read(em: EntityManager, identity: CrudFormSectionOutboxIdentity, locked?: boolean): Promise<CrudFormSectionOutboxRow | null>
  write(em: EntityManager, identity: CrudFormSectionOutboxIdentity, row: CrudFormSectionOutboxRow | null, intent: Intent): Promise<void>
  compareAndSet(em: EntityManager, identity: CrudFormSectionOutboxIdentity, row: CrudFormSectionOutboxRow, status: Status, changes: Partial<DeliveryState & FailureReporting> & { values?: null }): Promise<boolean>
  listDue(em: EntityManager, scope: CrudFormSectionOutboxScope, now: Date, limit: number): Promise<readonly string[]>
}

const replySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('applied'), externalId: z.string().min(1).max(512).optional() }).strict(),
  z.object({ status: z.literal('identical'), externalId: z.string().min(1).max(512).optional() }).strict(),
  z.object({ status: z.literal('stale'), currentRevision: z.string() }).strict(),
  z.object({ status: z.literal('rejected') }).strict(),
])
export type CrudFormSectionOutboxReply = z.infer<typeof replySchema>

type ProviderContext = {
  scope: CrudFormSectionOutboxScope
  credentials: Readonly<Values>
  signal: AbortSignal
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  resolveHost(host: string): ReturnType<typeof resolveSafeHostAddress>
}

export type CrudFormSectionOutboxDelivery<Payload extends Values = Values> = {
  mirror: CrudFormSectionOutboxMirror
  deliver(input: ProviderContext & {
    values: Readonly<Payload> | null
    hostResourceId: string
    sinkId: string
    operation: Operation
    revision: string
    idempotencyKey: string
  }): Promise<CrudFormSectionOutboxReply>
  validateExternal?(input: ProviderContext & { values: Readonly<Payload> }): Promise<{ fieldErrors: Record<string, string> } | void>
  failureNotificationType: string
}

export type CrudFormSectionOutboxRuntime = CrudFormSectionOutboxDelivery
export type CrudFormSectionOutboxServices = {
  credentials(integrationId: string, scope: CrudFormSectionOutboxScope): Promise<Values | null>
  enqueue(identity: CrudFormSectionOutboxIdentity, delayMs?: number): Promise<void>
  recordMapping?(em: EntityManager, input: {
    identity: CrudFormSectionOutboxIdentity
    integrationId: string
    resourceKind: string
    externalId: string | null
    operation: Operation
  }): Promise<void>
  reportOutcome?(input: {
    identity: CrudFormSectionOutboxIdentity
    integrationId: string
    resourceKind: string
    actorId: string | null
    status: Status
    code: CrudFormSectionOutboxError | null
    failureNotificationType: string
    failure?: { effect: FailureEffect; reportId: string }
  }): Promise<void>
}

type SinkMutationContext = Omit<Parameters<CrudFormSectionSink['persist']>[0], 'values' | 'hostOperation' | 'lockedRow'>

export const crudFormSectionOutboxServiceKey = 'crudFormSectionOutboxService'
export const crudFormSectionOutboxQueue = 'crud-form-section-outbox'
export const crudFormSectionOutboxSweepQueue = 'crud-form-section-outbox-sweep'
export const crudFormSectionOutboxScopeSchema = outboxScopeSchema.strict()

export function crudFormSectionOutboxKey(identity: CrudFormSectionOutboxIdentity): string {
  return JSON.stringify([identity.tenantId, identity.organizationId, identity.sinkId, identity.hostId])
}

export function validCrudFormSectionExternalDelivery(fact: CrudFormExtensionSinkFact, runtime: CrudFormSectionOutboxRuntime | undefined): boolean {
  const external = fact.externalDelivery
  if (fact.atomicity !== 'outbox') return external === undefined && runtime === undefined
  return !!external && !!runtime
    && Object.keys(external).length === 6
    && symbolicIdSchema.safeParse(external.integrationId).success
    && symbolicIdSchema.safeParse(fact.targetEntityId).success
    && typeof external.contractId === 'string' && external.contractId.startsWith(`${fact.targetEntityId}@v`)
    && /^[1-9][0-9]*$/.test(external.contractId.slice(fact.targetEntityId.length + 2))
    && Number.isSafeInteger(external.maxAttempts) && external.maxAttempts > 0
    && external.coalesce === 'latest-state'
    && external.fencing === 'remote-monotonic-revision/v1'
    && (external.preCommitValidation === 'read-only' ? typeof runtime.validateExternal === 'function'
      : external.preCommitValidation === 'none' && runtime.validateExternal === undefined)
    && typeof runtime.deliver === 'function' && symbolicIdSchema.safeParse(runtime.failureNotificationType).success
    && (['read', 'write', 'compareAndSet', 'listDue'] as const).every((key) => typeof runtime.mirror?.[key] === 'function')
}

export function collectCrudFormSectionOutboxRuntimes(sinks: Iterable<CrudFormSectionSink>): Map<string, CrudFormSectionSink> {
  const selected = new Map<string, CrudFormSectionSink>()
  const conflicts = new Set<string>()
  for (const sink of sinks) {
    if (!sink.outbox || !sink.fact.externalDelivery) continue
    const deliveryId = sink.fact.targetEntityId
    const previous = selected.get(deliveryId)
    const previousDelivery = previous?.fact.externalDelivery
    if (previous && (previous.hostDetailEntityId !== sink.hostDetailEntityId
        || previous.fact.ownerModuleId !== sink.fact.ownerModuleId || previous.fact.hostId !== sink.fact.hostId
        || !isDeepStrictEqual([...previous.fact.payloadPaths].sort(compareSectionIds), [...sink.fact.payloadPaths].sort(compareSectionIds))
        || previous.outbox?.deliver !== sink.outbox.deliver || previous.outbox?.mirror !== sink.outbox.mirror
        || previous.outbox?.failureNotificationType !== sink.outbox.failureNotificationType
        || previousDelivery?.integrationId !== sink.fact.externalDelivery.integrationId
        || previousDelivery.contractId !== sink.fact.externalDelivery.contractId
        || previousDelivery.maxAttempts !== sink.fact.externalDelivery.maxAttempts)) {
      conflicts.add(deliveryId)
    } else if (!previous) selected.set(deliveryId, sink)
  }
  for (const conflict of conflicts) selected.delete(conflict)
  return selected
}

function mismatch(): never {
  throw new CrudHttpError(409, { error: 'extension_policy_mismatch', code: 'extension_policy_mismatch' })
}

function unavailable(): never {
  throw new CrudHttpError(503, { error: 'crud_form_section_external_unavailable', code: 'crud_form_section_external_unavailable' })
}

function revisionOf(value: string): bigint | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) return null
  const revision = BigInt(value)
  return revision <= maxRevision ? revision : null
}

export const crudFormSectionOutboxRevisionSchema = z.string().refine((revision) => revisionOf(revision) !== null)

function storedIntentError(row: CrudFormSectionOutboxRow, fact: DeliveryFact, identity: CrudFormSectionOutboxIdentity) {
  if (row.deliveryIntegrationId !== fact.integrationId || row.deliveryContractId !== fact.contractId) {
    return 'delivery_contract_mismatch'
  }
  const key = [identity.tenantId, identity.organizationId, identity.sinkId, identity.hostId, row.deliveryRevision].join(':')
  if (revisionOf(row.deliveryRevision) === null || row.idempotencyKey !== key
      || !['upsert', 'delete', 'restore'].includes(row.pendingOperation)) return 'delivery_intent_invalid'
  return null
}

function requiresReconciliation(code: CrudFormSectionOutboxError | null): boolean {
  return code === 'remote_revision_ahead' || code === 'delivery_contract_mismatch' || code === 'delivery_intent_invalid'
}

function requireIdentity(sinkId: string, hostId: string, scope: CrudFormSectionSinkScope): CrudFormSectionOutboxIdentity {
  const result = crudFormSectionOutboxJobSchema.safeParse({ sinkId, hostId, tenantId: scope.tenantId, organizationId: scope.organizationId })
  if (!result.success) return mismatch()
  return result.data
}

async function providerCall<Result>(
  service: CrudFormSectionOutboxServices,
  fact: DeliveryFact,
  identity: CrudFormSectionOutboxScope,
  timeout: number,
  call: (provider: ProviderContext) => Promise<Result>,
): Promise<Result> {
  const controller = new AbortController()
  const scope = { tenantId: identity.tenantId, organizationId: identity.organizationId }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error('[internal] External delivery timed out'))
      }, timeout)
    })
    return await Promise.race([expiry, (async () => {
      const credentials = await service.credentials(fact.integrationId, scope)
      controller.signal.throwIfAborted()
      if (!credentials) return unavailable()
      return call({
        scope, credentials, signal: controller.signal,
        fetch: (url, init) => {
          assertStaticallySafeOutboundUrl(url)
          return safeOutboundFetch(url, { ...init, signal: controller.signal, redirect: 'manual' })
        },
        resolveHost: (host) => resolveSafeHostAddress(host),
      })
    })()])
  } finally {
    clearTimeout(timer)
  }
}

function reportFailure(reason: string, sinkId: string): void {
  const attributes = { reason, sinkId }
  try { logger.warn('CrudForm outbox operation failed', attributes) } catch {}
  try {
    reportTelemetryError(new Error('[internal] CrudForm outbox operation failed'), {
      module: 'shared', code: 'crud_form_sections.outbox_failed', attributes,
    })
  } catch {}
}

async function enqueue(service: CrudFormSectionOutboxServices, identity: CrudFormSectionOutboxIdentity, delayMs?: number): Promise<void> {
  try {
    await service.enqueue(identity, delayMs)
  } catch {
    reportFailure('enqueue', identity.sinkId)
  }
}

function enqueueOnCommit(context: SinkMutationContext, identity: CrudFormSectionOutboxIdentity): void {
  const lifetime = getTransactionLifetime(context.em)
  if (!lifetime || !context.em.isInTransaction()) return mismatch()
  const service = context.container.resolve<CrudFormSectionOutboxServices>(crudFormSectionOutboxServiceKey)
  onTransactionLifetimeComplete(context.em, (outcome) => outcome === 'committed' ? enqueue(service, identity) : undefined)
}

async function lockedRow(repository: CrudFormSectionOutboxMirror, context: SinkMutationContext, identity: CrudFormSectionOutboxIdentity) {
  if (!getTransactionLifetime(context.em) || !context.em.isInTransaction()) return mismatch()
  await context.em.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [
    `crudform_outbox:${crudFormSectionOutboxKey(identity)}`,
  ])
  return readScopedMirror(repository, context.em, identity, true)
}

async function readScopedMirror(
  mirror: CrudFormSectionOutboxMirror, em: EntityManager, identity: CrudFormSectionOutboxIdentity, lock?: true,
): Promise<CrudFormSectionOutboxRow | null> {
  const row = await mirror.read(em, identity, lock)
  if (row && (row.tenantId !== identity.tenantId || row.organizationId !== identity.organizationId || row.hostId !== identity.hostId)) {
    return mismatch()
  }
  return row
}

async function writeIntent(
  sink: CrudFormSectionSink,
  context: SinkMutationContext,
  operation: Operation,
  values: Values | null,
  expectedRevision?: string,
): Promise<CrudFormSectionSinkSnapshot> {
  if (!sink.outbox || !sink.fact.externalDelivery) return mismatch()
  const identity = requireIdentity(sink.fact.targetEntityId, context.hostResourceId, context.scope)
  const { mirror } = sink.outbox
  const row = await lockedRow(mirror, context, identity)
  const currentRevision = row ? revisionOf(row.deliveryRevision) : 0n
  const fact = sink.fact.externalDelivery
  if (currentRevision === null || currentRevision === maxRevision
      || (expectedRevision !== undefined && row?.deliveryRevision !== expectedRevision)
      || (row && (requiresReconciliation(row.lastErrorCode) || storedIntentError(row, fact, identity)))) return mismatch()
  const deliveryRevision = (currentRevision + 1n).toString()
  const now = new Date()
  const before = row?.pendingOperation === 'delete' ? null : row?.values ?? null
  const updatedAt = row ? new Date(Math.max(now.getTime(), row.updatedAt.getTime() + 1)) : now
  const idempotencyKey = [identity.tenantId, identity.organizationId, identity.sinkId, identity.hostId, deliveryRevision].join(':')
  const after = operation === 'delete' ? null : values
  const actor = z.uuid().safeParse(context.auth.sub)
  await mirror.write(context.em, identity, row, {
    values: operation === 'delete' ? row?.values ?? null : values,
    updatedAt, deliveryRevision, idempotencyKey, pendingOperation: operation,
    deliveryIntegrationId: fact.integrationId, deliveryContractId: fact.contractId,
    deliveryActorId: actor.success ? actor.data : null, syncStatus: 'pending', syncAttempts: 0,
    nextAttemptAt: now, lastAttemptAt: null, lastErrorCode: null, externalId: row?.externalId ?? null,
  })
  enqueueOnCommit(context, identity)
  return { before, after, outboxAfterRevision: deliveryRevision }
}

export function defineCrudFormSectionOutboxSink<Payload extends Values>(
  declaration: Pick<CrudFormSectionSink, 'capabilityId' | 'hostDetailEntityId'> & {
    fact: CrudFormExtensionSinkFact & { atomicity: 'outbox'; externalDelivery: DeliveryFact; optimisticLock: 'sink-version' }
    schema: z.ZodType<Payload>
    outbox: CrudFormSectionOutboxDelivery<Payload>
  },
): CrudFormSectionSink {
  const sink: CrudFormSectionSink = defineCrudFormSectionSink({
    ...declaration,
    outbox: declaration.outbox as CrudFormSectionOutboxRuntime,
    persist: (context) => writeIntent(sink, context, 'upsert', context.values),
    async load(context) {
      const identity = requireIdentity(sink.fact.targetEntityId, context.hostResourceId, context.scope)
      const row = await readScopedMirror(declaration.outbox.mirror, context.em, identity)
      if (!row) return null
      return {
        values: row.pendingOperation === 'delete' ? {} : row.values ?? {},
        ...(row.pendingOperation === 'delete' ? {} : { updatedAt: row.updatedAt }),
        sync: { status: row.syncStatus, lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null, errorCode: row.lastErrorCode },
      }
    },
    async lockRow(context) {
      const identity = requireIdentity(sink.fact.targetEntityId, context.hostResourceId, context.scope)
      const row = await lockedRow(declaration.outbox.mirror, context, identity)
      return row && row.pendingOperation !== 'delete' ? { values: row.values ?? {}, updatedAt: row.updatedAt } : null
    },
    onHostDeleted: (context) => writeIntent(sink, context, 'delete', null),
    ...(declaration.fact.undo === 'snapshot' ? {
      undo: async (context) => {
        const { before, outboxAfterRevision } = context.snapshot
        if (!outboxAfterRevision || revisionOf(outboxAfterRevision) === null) return mismatch()
        await writeIntent(sink, context, before === null ? 'delete' : 'restore', before, outboxAfterRevision)
      },
    } : {}),
  })
  return sink
}

export async function prevalidateCrudFormSectionOutbox(
  work: readonly { runtime: CrudFormSectionSink; values: Values }[],
  scope: CrudFormSectionSinkScope, container: AwilixContainer,
): Promise<Map<string, Values>> {
  const validated = new Map<string, Values>()
  for (const { runtime, values } of work) {
    const fact = runtime.fact.externalDelivery
    if (fact?.preCommitValidation !== 'read-only') continue
    const callback = runtime.outbox?.validateExternal
    if (!callback) return mismatch()
    const scoped = outboxScopeSchema.safeParse(scope)
    if (!scoped.success) return mismatch()
    let result: Awaited<ReturnType<typeof callback>>
    try {
      const service = container.resolve<CrudFormSectionOutboxServices>(crudFormSectionOutboxServiceKey)
      result = await providerCall(service, fact, scoped.data, validationTimeoutMs, (provider) =>
        callback({ ...provider, values: structuredClone(values) }))
    } catch {
      reportFailure('validation_unavailable', runtime.fact.id)
      return unavailable()
    }
    if (result) {
      const fieldErrors = result.fieldErrors
      if (!fieldErrors || !Object.keys(fieldErrors).length || !Object.entries(fieldErrors).every(([path, key]) =>
        runtime.fact.payloadPaths.includes(path) && symbolicIdSchema.safeParse(key).success)) return unavailable()
      throw new CrudHttpError(422, { error: 'validation_failed', code: 'validation_failed', fieldErrors })
    }
    validated.set(runtime.fact.id, structuredClone(values))
  }
  return validated
}

export function assertPrevalidatedCrudFormSectionOutbox(
  work: readonly { runtime: CrudFormSectionSink; values: Values }[], validated: ReadonlyMap<string, Values>,
): void {
  for (const { runtime, values } of work) {
    if (runtime.fact.externalDelivery?.preCommitValidation === 'read-only'
        && !isDeepStrictEqual(validated.get(runtime.fact.id), structuredClone(values))) mismatch()
  }
}

export async function retryCrudFormSectionOutbox(sink: CrudFormSectionSink, context: SinkMutationContext): Promise<void> {
  const identity = requireIdentity(sink.fact.targetEntityId, context.hostResourceId, context.scope)
  const mirror = sink.outbox?.mirror
  if (!mirror || !sink.fact.externalDelivery) return mismatch()
  const row = await lockedRow(mirror, context, identity)
  if (!row || row.syncStatus !== 'failed' || requiresReconciliation(row.lastErrorCode)
      || storedIntentError(row, sink.fact.externalDelivery, identity)) return mismatch()
  if (!await mirror.compareAndSet(context.em, identity, row, 'failed', {
    syncStatus: 'pending', syncAttempts: 0, nextAttemptAt: new Date(), lastErrorCode: null,
  })) return mismatch()
  enqueueOnCommit(context, identity)
}

export async function preflightCrudFormSectionOutboxIntent(
  sink: CrudFormSectionSink, context: SinkMutationContext,
): Promise<void> {
  if (!sink.outbox || !sink.fact.externalDelivery) return
  const identity = requireIdentity(sink.fact.targetEntityId, context.hostResourceId, context.scope)
  const row = await lockedRow(sink.outbox.mirror, context, identity)
  if (row) {
    const revision = revisionOf(row.deliveryRevision)
    if (revision === maxRevision || requiresReconciliation(row.lastErrorCode)
        || storedIntentError(row, sink.fact.externalDelivery, identity)) mismatch()
  }
}

async function updateFailureReporting(
  em: EntityManager, mirror: CrudFormSectionOutboxMirror, identity: CrudFormSectionOutboxIdentity,
  update: (row: CrudFormSectionOutboxRow) => Partial<FailureReporting> | undefined,
): Promise<boolean> {
  const tx = em.fork()
  let won = false
  await withAtomicFlush(tx, [async () => {
    const row = await readScopedMirror(mirror, tx, identity, true)
    const changed = row && update(row)
    if (row && changed) won = await mirror.compareAndSet(tx, identity, row, row.syncStatus, changed)
  }], { transaction: true, label: 'crud-form-section-outbox-failure-report' })
  return won
}

async function reportPendingFailure(
  em: EntityManager, mirror: CrudFormSectionOutboxMirror, identity: CrudFormSectionOutboxIdentity,
  resourceKind: string, service: CrudFormSectionOutboxServices, now: Date,
): Promise<void> {
  if (!service.reportOutcome) return
  const lease = new Date(now.getTime() + failureReportLeaseMs)
  let report: CrudFormSectionOutboxFailureReport | undefined
  const claimed = await updateFailureReporting(em, mirror, identity, (row) => {
    if (!row.nextFailureReportAt || row.nextFailureReportAt > now || !row.failureReports.length) return
    report = row.failureReports[0]
    return { nextFailureReportAt: lease }
  })
  if (!claimed || !report) return
  const { id: reportId, integrationId, actorId, code, effects, notificationType } = report
  const ownsLease = (row: CrudFormSectionOutboxRow) => row.nextFailureReportAt?.getTime() === lease.getTime()
    && row.failureReports[0]?.id === reportId
  for (const effect of effects) {
    const latest = await readScopedMirror(mirror, em.fork(), identity)
    if (!latest || !ownsLease(latest)) return
    try {
      await service.reportOutcome({
        identity, integrationId, resourceKind, actorId, code, status: 'failed',
        failureNotificationType: notificationType, failure: { effect, reportId },
      })
    } catch {
      reportFailure('outcome_reporting', identity.sinkId)
      continue
    }
    if (!await updateFailureReporting(em, mirror, identity, (row) => {
      if (!ownsLease(row)) return
      const [first, ...rest] = row.failureReports
      return { failureReports: [{ ...first, effects: first.effects.filter((pending) => pending !== effect) }, ...rest] }
    })) return
  }
  await updateFailureReporting(em, mirror, identity, (row) => {
    if (!ownsLease(row)) return
    const [first, ...rest] = row.failureReports
    return first.effects.length
      ? { nextFailureReportAt: new Date(now.getTime() + failureReportRetryMs) }
      : { failureReports: rest, nextFailureReportAt: rest.length ? now : null }
  })
}

export async function deliverCrudFormSectionOutbox(input: {
  sink: CrudFormSectionSink
  identity: CrudFormSectionOutboxIdentity
  em: EntityManager
  service: CrudFormSectionOutboxServices
  now?: Date
}): Promise<void> {
  const { sink, identity, em, service, now = new Date() } = input
  const fact = sink.fact.externalDelivery
  const runtime = sink.outbox
  if (!fact || !runtime || !validCrudFormSectionExternalDelivery(sink.fact, runtime) || identity.sinkId !== sink.fact.targetEntityId) return
  const { mirror } = runtime
  const report = (at: Date) => reportPendingFailure(em, mirror, identity, sink.hostDetailEntityId, service, at)
  const initial = await readScopedMirror(mirror, em.fork(), identity)
  if (initial?.nextFailureReportAt && initial.nextFailureReportAt <= now) await report(now)
  const row = initial?.nextFailureReportAt && initial.nextFailureReportAt <= now
    ? await readScopedMirror(mirror, em.fork(), identity) : initial
  if (!row || row.syncStatus !== 'pending' || !row.nextAttemptAt || row.nextAttemptAt > now) return

  const complete = async (
    attempted: CrudFormSectionOutboxRow, state: Partial<DeliveryState> & { syncStatus: Status; values?: null },
    completedAt: Date,
  ) => {
    const outcomeEm = em.fork()
    let won = false
    await withAtomicFlush(outcomeEm, [async () => {
      if (state.syncStatus === 'failed') {
        const latest = await readScopedMirror(mirror, outcomeEm, identity, true)
        if (!latest) return
        const failureReport: CrudFormSectionOutboxFailureReport = {
          id: randomUUID(), integrationId: fact.integrationId, actorId: attempted.deliveryActorId,
          code: state.lastErrorCode ?? 'delivery_unavailable', notificationType: runtime.failureNotificationType,
          effects: attempted.deliveryActorId ? ['log', 'event', 'notification'] : ['log', 'event'],
        }
        won = await mirror.compareAndSet(outcomeEm, identity, {
          ...attempted, nextFailureReportAt: latest.nextFailureReportAt,
        }, 'pending', {
          ...state, failureReports: [...latest.failureReports, failureReport],
          nextFailureReportAt: latest.nextFailureReportAt ?? completedAt,
        })
      } else {
        won = await mirror.compareAndSet(outcomeEm, identity, attempted, 'pending', state)
        if (won && state.syncStatus === 'synced') {
          await service.recordMapping?.(outcomeEm, {
            identity, integrationId: fact.integrationId, resourceKind: sink.hostDetailEntityId,
            externalId: state.externalId ?? null, operation: attempted.pendingOperation,
          })
        }
      }
    }], { transaction: true, label: 'crud-form-section-outbox-outcome' })
    if (!won) {
      const current = await readScopedMirror(mirror, em.fork(), identity)
      if (current?.syncStatus === 'pending' && current.nextAttemptAt && current.nextAttemptAt <= completedAt) await enqueue(service, identity)
      return
    }
    if (state.syncStatus === 'failed') {
      await report(completedAt)
      return
    }
    if (state.syncStatus === 'pending' && state.nextAttemptAt) {
      await enqueue(service, identity, Math.max(0, state.nextAttemptAt.getTime() - completedAt.getTime()))
    }
    try {
      await service.reportOutcome?.({
        identity, integrationId: fact.integrationId, resourceKind: sink.hostDetailEntityId,
        actorId: attempted.deliveryActorId, status: state.syncStatus, code: state.lastErrorCode ?? null,
        failureNotificationType: runtime.failureNotificationType,
      })
    } catch {
      reportFailure('outcome_reporting', identity.sinkId)
    }
  }

  const intentError = storedIntentError(row, fact, identity)
  const revision = revisionOf(row.deliveryRevision)
  if (intentError || revision === null) {
    await complete(row, {
      syncStatus: 'failed', lastErrorCode: intentError ?? 'delivery_intent_invalid', lastAttemptAt: now, nextAttemptAt: null,
    }, now)
    return
  }
  let reply: CrudFormSectionOutboxReply | null
  try {
    const response = await providerCall(service, fact, identity, deliveryTimeoutMs, (provider) =>
      runtime.deliver({
        ...provider, values: row.pendingOperation === 'delete' ? null : structuredClone(row.values),
        hostResourceId: identity.hostId, sinkId: identity.sinkId, operation: row.pendingOperation,
        revision: row.deliveryRevision, idempotencyKey: row.idempotencyKey,
      }))
    reply = replySchema.safeParse(response).data ?? null
  } catch {
    reply = null
  }
  const completedAt = input.now ?? new Date()

  if (reply?.status === 'applied' || reply?.status === 'identical') {
    const externalId = reply.externalId ?? row.externalId
    if (row.pendingOperation === 'delete' || externalId) {
      await complete(row, {
        syncStatus: 'synced', nextAttemptAt: null, lastAttemptAt: completedAt, lastErrorCode: null,
        ...(row.pendingOperation === 'delete' ? { values: null, externalId: null } : { externalId }),
      }, completedAt)
      return
    }
    reply = null
  }
  if (reply?.status === 'stale') {
    const remote = revisionOf(reply.currentRevision)
    if (remote !== null && remote > revision) {
      const current = await readScopedMirror(mirror, em.fork(), identity)
      if (!current || current.syncStatus !== 'pending' || storedIntentError(current, fact, identity)) return
      const local = revisionOf(current.deliveryRevision)
      if (local !== null && remote > local) {
        await complete(current, { syncStatus: 'failed', lastErrorCode: 'remote_revision_ahead', lastAttemptAt: completedAt, nextAttemptAt: null }, completedAt)
      } else if (current.nextAttemptAt && current.nextAttemptAt <= completedAt) {
        await enqueue(service, identity)
      }
      return
    }
    reply = { status: 'rejected' }
  }
  const attempts = row.syncAttempts + 1
  const terminal = attempts >= fact.maxAttempts || reply?.status === 'rejected'
  await complete(row, {
    syncStatus: terminal ? 'failed' : 'pending',
    lastErrorCode: reply?.status === 'rejected' ? 'remote_rejected' : 'delivery_unavailable',
    syncAttempts: attempts, lastAttemptAt: completedAt,
    nextAttemptAt: terminal ? null : new Date(completedAt.getTime() + calculateBackoffDelayMs(attempts)),
  }, completedAt)
}
