import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { Attachment, AttachmentPartition } from '../data/entities'
import { attachmentAccessDecisionSchema, attachmentAccessRequirementsSchema } from '../data/validators'
import { checkAttachmentAccess } from './access'
import {
  collectAttachmentAccessTargets,
  getAttachmentAccessRegistry,
  matchesAttachmentAccessResolver,
  matchesAttachmentAccessSelector,
  matchesAttachmentAccessTargets,
} from './access-registry'
import type {
  AttachmentAccessAction, AttachmentAccessDecision, AttachmentAccessPartition,
  AttachmentAccessRecord, AttachmentAccessSubject,
} from './access-types'

const logger = createLogger('attachments').child({ component: 'access' })
const DEFAULT_TIMEOUT_MS = 1500

type RbacProjectionService = {
  loadAcl(subject: string, scope: { tenantId: string | null; organizationId: string | null }): Promise<{
    isSuperAdmin: boolean; organizations: string[] | null
  }>
  getEffectiveFeatures(subject: string, scope: { tenantId: string | null; organizationId: string | null }): Promise<string[]>
}

export type AttachmentAccessContext = {
  container: AwilixContainer
  subjects: Map<string, Promise<AttachmentAccessSubject>>
  resolverCaches: Map<string, Map<string, unknown>>
}

export function createAttachmentAccessContext(container: AwilixContainer): AttachmentAccessContext {
  return { container, subjects: new Map(), resolverCaches: new Map() }
}

export type AttachmentAccessResult = AttachmentAccessDecision & { protected: boolean }

class AccessTimeout extends Error {}

async function withinBudget<Result>(work: () => Promise<Result>, timeoutMs: number, controller: AbortController): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new AccessTimeout('[internal] Attachment access evaluation timed out'))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function projectSubject(
  context: AttachmentAccessContext,
  auth: NonNullable<AuthContext>,
  attachment: AttachmentAccessRecord,
): Promise<AttachmentAccessSubject> {
  const scope = {
    tenantId: attachment.tenantId ?? auth.tenantId ?? null,
    organizationId: attachment.organizationId ?? auth.orgId ?? null,
  }
  const key = JSON.stringify([auth.sub, scope.tenantId, scope.organizationId])
  let pending = context.subjects.get(key)
  if (!pending) {
    pending = (async () => {
      const rbac = context.container.resolve<RbacProjectionService>('rbacService')
      const acl = await rbac.loadAcl(auth.sub, scope)
      const userFeatures = await rbac.getEffectiveFeatures(auth.sub, scope)
      if (typeof acl.isSuperAdmin !== 'boolean' || !Array.isArray(userFeatures) || userFeatures.some((feature) => typeof feature !== 'string')) {
        throw new Error('[internal] Invalid attachment subject projection')
      }
      if (!acl.isSuperAdmin && acl.organizations && scope.organizationId
        && !acl.organizations.includes(scope.organizationId) && !acl.organizations.includes('__all__')) {
        throw new Error('[internal] Attachment subject is outside its current organization grants')
      }
      return Object.freeze({
        auth: Object.freeze({
          sub: auth.sub, tenantId: scope.tenantId, orgId: scope.organizationId,
          isApiKey: auth.isApiKey === true, userId: auth.userId, keyId: auth.keyId,
          isSuperAdmin: acl.isSuperAdmin,
        }),
        ...scope,
        userFeatures: Object.freeze([...userFeatures]),
        isSuperAdmin: acl.isSuperAdmin,
      })
    })()
    context.subjects.set(key, pending)
  }
  return pending
}

export async function evaluateAttachmentAccess(input: {
  auth: AuthContext | undefined
  attachment: AttachmentAccessRecord
  partition: AttachmentAccessPartition
  action: AttachmentAccessAction
  context?: AttachmentAccessContext | null
  requireAuthForPublic?: boolean
}): Promise<AttachmentAccessResult> {
  const { auth, attachment, partition, action, context } = input
  const baseline = checkAttachmentAccess(auth, attachment as Attachment, partition as AttachmentPartition, input)
  if (!baseline.ok) return { ok: false, status: baseline.status === 401 ? 401 : 403, reason: 'scope', protected: false }
  const deny = (status: 401 | 403 | 404 | 504, reason: string, resolverId?: string): AttachmentAccessResult => {
    logger.info('Attachment owner access denied', { resolverId, action, attachmentId: attachment.id, reason })
    return { ok: false, status, reason, protected: true }
  }
  const registry = getAttachmentAccessRegistry()
  if (registry.invalid) return deny(403, 'invalid_registry')
  const parsedRequirements = attachmentAccessRequirementsSchema.safeParse(partition.accessResolverRequirements ?? [])
  if (!parsedRequirements.success) return deny(403, 'invalid_requirements')
  const targets = collectAttachmentAccessTargets(attachment)
  const requirements = [...parsedRequirements.data, ...registry.protectedTargets.filter((target) => (
    matchesAttachmentAccessSelector(target.targetPartition, partition.code)
  ))].filter((requirement) => matchesAttachmentAccessTargets(requirement.targetEntity, targets))
  const resolvers = registry.resolvers.filter((resolver) => matchesAttachmentAccessResolver(resolver, partition.code, targets, action))
  if (!requirements.length && !resolvers.length) return { ok: true, protected: false }
  if (!auth) return deny(401, 'authentication_required')
  for (const requirement of requirements) {
    const requiredTargets = targets.filter((target) => matchesAttachmentAccessSelector(requirement.targetEntity, target.entityId))
    const provider = resolvers.find((resolver) => resolver.id === requirement.resolverId)
    if (!provider || (requiredTargets.length
      ? requiredTargets.some((target) => !matchesAttachmentAccessSelector(provider.targetEntity ?? '*', target.entityId))
      : (provider.targetEntity ?? '*') !== '*')) return deny(403, 'required_resolver_missing', requirement.resolverId)
    if (targets.some((target) => matchesAttachmentAccessSelector(requirement.targetEntity, target.entityId) && !target.recordId)) {
      return deny(403, 'invalid_owner', requirement.resolverId)
    }
  }
  if (!context) return deny(403, 'policy_context_missing')
  let subject: AttachmentAccessSubject
  try {
    subject = await withinBudget(() => projectSubject(context, auth, attachment), DEFAULT_TIMEOUT_MS, new AbortController())
  } catch (error) {
    getTelemetryRuntime()?.reportError(new Error('[internal] Attachment subject projection failed'), {
      module: 'attachments', code: 'attachments.subject_projection_failed', attributes: { attachmentId: attachment.id, action },
    })
    return deny(error instanceof AccessTimeout ? 504 : 403, 'subject_projection_failed')
  }
  const liveBaseline = checkAttachmentAccess({ ...auth, roles: [], isSuperAdmin: subject.isSuperAdmin }, attachment as Attachment, partition as AttachmentPartition, input)
  if (!liveBaseline.ok) return deny(403, 'current_scope')
  for (const resolver of resolvers) {
    const controller = new AbortController()
    let cache = context.resolverCaches.get(resolver.id)
    if (!cache) {
      cache = new Map()
      context.resolverCaches.set(resolver.id, cache)
    }
    try {
      const raw = await withinBudget(() => resolver.resolve(Object.freeze({
        action, subject,
        attachment: Object.freeze({
          id: attachment.id, entityId: attachment.entityId, recordId: attachment.recordId,
          partitionCode: attachment.partitionCode, tenantId: attachment.tenantId,
          organizationId: attachment.organizationId, fileName: attachment.fileName, mimeType: attachment.mimeType,
        }),
        partition: Object.freeze({
          code: partition.code, isPublic: partition.isPublic,
          tenantId: partition.tenantId, organizationId: partition.organizationId,
        }),
        targets, container: context.container, cache, signal: controller.signal,
      })), resolver.timeoutMs ?? DEFAULT_TIMEOUT_MS, controller)
      const decision = attachmentAccessDecisionSchema.parse(raw)
      if (!decision.ok) return deny(decision.status, decision.reason, resolver.id)
    } catch (error) {
      controller.abort()
      getTelemetryRuntime()?.reportError(new Error(error instanceof AccessTimeout
        ? '[internal] Attachment resolver exceeded its time budget'
        : '[internal] Attachment resolver failed or returned an invalid decision'), {
        module: 'attachments', code: 'attachments.resolver_failed',
        attributes: { resolverId: resolver.id, attachmentId: attachment.id, action },
      })
      return deny(error instanceof AccessTimeout ? 504 : 403, error instanceof AccessTimeout ? 'resolver_timeout' : 'resolver_failed', resolver.id)
    }
  }
  return { ok: true, protected: true }
}
