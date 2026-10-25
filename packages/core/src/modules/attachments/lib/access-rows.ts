import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { AttachmentPartition } from '../data/entities'
import { attachmentAccessRequirementsSchema } from '../data/validators'
import {
  collectAttachmentAccessTargets,
  getAttachmentAccessRegistry,
  matchesAttachmentAccessResolver,
  matchesAttachmentAccessSelector,
  matchesAttachmentAccessTargets,
} from './access-registry'
import { createAttachmentAccessContext, evaluateAttachmentAccess, type AttachmentAccessContext } from './access-runner'
import type { AttachmentAccessAction, AttachmentAccessPartition, AttachmentAccessRecord } from './access-types'
import { mergeAttachmentMetadata, readAttachmentMetadata } from './metadata'

export type AttachmentAccessPrincipal = {
  tenantId: string | null
  organizationId: string | null
  /** A user id, or an authenticated `api_key:<id>` subject. */
  userId?: string | null
  apiKeyId?: string | null
  isSuperAdmin?: boolean
}

const API_KEY_SUBJECT_PREFIX = 'api_key:'

export type AttachmentAccessDestination = {
  entityId: string
  recordId: string
  /** Rewrites assignments that point at the row's current owner to the destination, as the transfer route does. */
  moveAssignments?: boolean
}

export type EvaluateAttachmentRowAccessInput<Row extends AttachmentAccessRecord> = {
  /** Required to evaluate a principal; without it, protected rows are denied. */
  container?: AwilixContainer
  /** Defaults to the container's `em`. */
  em?: EntityManager
  auth: AuthContext | undefined
  rows: readonly Row[]
  action: AttachmentAccessAction
  destination?: AttachmentAccessDestination
  context?: AttachmentAccessContext
}

export type EvaluateAttachmentRowAccessResult<Row extends AttachmentAccessRecord> = {
  allowed: Row[]
  denied: Row[]
}

/**
 * Builds the principal `evaluateAttachmentAccess` must evaluate, in the same shape
 * API-key authentication produces. Key-authenticated calls are evaluated as the key
 * (`api_key:<id>`), never as the user who created it, because the runner recomputes
 * features from `auth.sub`. `userId` may already be an authenticated `api_key:<id>`
 * subject; it is then used as the key id. A key is evaluated without a backing user,
 * because tool contexts carry no backing user verified by API-key authentication (the
 * HTTP MCP server carries the key's creator or session user unverified), so access that
 * only that user's own ownership or shares grant is refused.
 */
export function buildAttachmentAccessAuth(principal: AttachmentAccessPrincipal): NonNullable<AuthContext> | null {
  const scope = {
    tenantId: principal.tenantId,
    orgId: principal.organizationId,
    ...(principal.isSuperAdmin ? { isSuperAdmin: true } : {}),
  }
  const subjectIsKey = typeof principal.userId === 'string' && principal.userId.startsWith(API_KEY_SUBJECT_PREFIX)
  const keyId = principal.apiKeyId || (subjectIsKey ? principal.userId!.slice(API_KEY_SUBJECT_PREFIX.length) : null)
  const userId = principal.userId && !subjectIsKey ? principal.userId : null
  if (keyId) {
    return {
      sub: `${API_KEY_SUBJECT_PREFIX}${keyId}`,
      isApiKey: true,
      keyId,
      ...scope,
    }
  }
  if (userId) return { sub: userId, userId, ...scope }
  return null
}

/**
 * Mirrors the protection detection of `evaluateAttachmentAccess`; the parity test in
 * `__tests__/access-rows.test.ts` keeps the two in agreement.
 */
export function requiresAttachmentOwnerAccess(
  row: AttachmentAccessRecord,
  partition: AttachmentAccessPartition,
  action: AttachmentAccessAction,
): boolean {
  const registry = getAttachmentAccessRegistry()
  if (registry.invalid) return true
  const parsed = attachmentAccessRequirementsSchema.safeParse(partition.accessResolverRequirements ?? [])
  if (!parsed.success) return true
  const targets = collectAttachmentAccessTargets(row)
  const requirements = [
    ...parsed.data,
    ...registry.protectedTargets.filter((target) => matchesAttachmentAccessSelector(target.targetPartition, partition.code)),
  ].filter((requirement) => matchesAttachmentAccessTargets(requirement.targetEntity, targets))
  if (requirements.length > 0) return true
  return registry.resolvers.some((resolver) => matchesAttachmentAccessResolver(resolver, partition.code, targets, action))
}

function moveAssignmentsTo(row: AttachmentAccessRecord, recordId: string): unknown {
  const assignments = readAttachmentMetadata(row.storageMetadata).assignments?.map((assignment) => (
    assignment.type === row.entityId && assignment.id === row.recordId ? { ...assignment, id: recordId } : assignment
  )) ?? []
  return mergeAttachmentMetadata(row.storageMetadata, { assignments })
}

async function loadPartitions(em: EntityManager, codes: readonly string[]): Promise<Map<string, AttachmentPartition>> {
  if (codes.length === 0) return new Map()
  const partitions = await em.find(AttachmentPartition, { code: { $in: [...codes] } })
  return new Map(partitions.map((partition) => [partition.code, partition]))
}

async function isAllowed<Row extends AttachmentAccessRecord>(
  row: Row,
  partition: AttachmentAccessPartition | undefined,
  input: EvaluateAttachmentRowAccessInput<Row>,
  resolveContext: () => AttachmentAccessContext | null,
): Promise<boolean> {
  const policyPartition: AttachmentAccessPartition = partition ?? { code: row.partitionCode, isPublic: false }
  const candidates: AttachmentAccessRecord[] = [row]
  if (input.destination) {
    const { entityId, recordId, moveAssignments } = input.destination
    const storageMetadata = moveAssignments ? moveAssignmentsTo(row, recordId) : row.storageMetadata
    candidates.push({ ...row, entityId, recordId, storageMetadata })
  }
  for (const candidate of candidates) {
    if (!requiresAttachmentOwnerAccess(candidate, policyPartition, input.action)) continue
    const context = input.auth ? resolveContext() : null
    if (!partition || !input.auth || !context) return false
    const result = await evaluateAttachmentAccess({
      auth: input.auth, attachment: candidate, partition, action: input.action, context,
    })
    if (!result.ok) return false
  }
  return true
}

/**
 * Applies owner access policies to attachment rows that a caller loaded directly
 * (outside the attachments routes). Rows whose owner declares no policy keep the
 * caller's existing behavior; protected rows must pass `evaluateAttachmentAccess`
 * for the given principal, and, for a `reassign` with a destination, the row as it
 * would look after the move must pass too. A missing principal or partition row
 * denies protected rows; unprotected rows are never denied for those reasons.
 */
export async function evaluateAttachmentRowAccess<Row extends AttachmentAccessRecord>(
  input: EvaluateAttachmentRowAccessInput<Row>,
): Promise<EvaluateAttachmentRowAccessResult<Row>> {
  if (input.rows.length === 0) return { allowed: [], denied: [] }
  const em = input.em ?? input.container?.resolve<EntityManager>('em')
  if (!em) throw new Error('[internal] evaluateAttachmentRowAccess requires an EntityManager or a container')
  const partitions = await loadPartitions(em, [...new Set(input.rows.map((row) => row.partitionCode))])
  let context: AttachmentAccessContext | null = input.context ?? null
  const resolveContext = () => {
    if (!context && input.container) context = createAttachmentAccessContext(input.container)
    return context
  }
  const allowed: Row[] = []
  const denied: Row[] = []
  for (const row of input.rows) {
    if (await isAllowed(row, partitions.get(row.partitionCode), input, resolveContext)) allowed.push(row)
    else denied.push(row)
  }
  return { allowed, denied }
}
