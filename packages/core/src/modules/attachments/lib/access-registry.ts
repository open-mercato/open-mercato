import { matchesEntity } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { attachmentAccessResolverSchema, protectedAttachmentTargetSchema } from '../data/validators'
import type {
  AttachmentAccessAction,
  AttachmentAccessRecord,
  AttachmentAccessResolver,
  AttachmentAccessResolverEntry,
  AttachmentAccessTarget,
  ProtectedAttachmentTarget,
} from './access-types'

const GLOBAL_KEY = '__openMercatoAttachmentAccessRegistry__'

type RegisteredResolver = AttachmentAccessResolver & {
  moduleOrder: number
  declarationOrder: number
}

type Registry = {
  invalid: boolean
  resolvers: readonly RegisteredResolver[]
  protectedTargets: readonly ProtectedAttachmentTarget[]
}

const emptyRegistry: Registry = Object.freeze({ invalid: false, resolvers: [], protectedTargets: [] })

export function getAttachmentAccessRegistry(): Registry {
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Registry | undefined ?? emptyRegistry
}

export function registerAttachmentAccessResolvers(entries: readonly AttachmentAccessResolverEntry[]): void {
  const globalState = globalThis as Record<string, unknown>
  globalState[GLOBAL_KEY] = { invalid: true, resolvers: [], protectedTargets: [] } satisfies Registry
  const resolvers: RegisteredResolver[] = []
  const protectedTargets: ProtectedAttachmentTarget[] = []
  const ids = new Set<string>()
  for (const [moduleOrder, entry] of entries.entries()) {
    if (typeof entry.moduleId !== 'string' || !entry.moduleId || !Array.isArray(entry.resolvers)) {
      throw new Error('[internal] Invalid attachment access registry entry')
    }
    for (const [declarationOrder, raw] of entry.resolvers.entries()) {
      const resolver = attachmentAccessResolverSchema.parse(raw)
      if (!resolver.id.startsWith(`${entry.moduleId}.`) || ids.has(resolver.id)) {
        throw new Error('[internal] Attachment access resolver IDs must be unique and owned by their module')
      }
      ids.add(resolver.id)
      resolvers.push(Object.freeze({
        ...resolver,
        actions: resolver.actions ? Object.freeze([...resolver.actions]) : undefined,
        moduleOrder,
        declarationOrder,
      }))
    }
    for (const raw of entry.protectedTargets ?? []) {
      const target = protectedAttachmentTargetSchema.parse(raw)
      if (!target.resolverId.startsWith(`${entry.moduleId}.`)) {
        throw new Error('[internal] Attachment access requirements must name their module resolver')
      }
      protectedTargets.push(Object.freeze(target))
    }
  }
  resolvers.sort((left, right) => (
    (left.priority ?? 50) - (right.priority ?? 50)
    || left.moduleOrder - right.moduleOrder
    || left.declarationOrder - right.declarationOrder
  ))
  globalState[GLOBAL_KEY] = Object.freeze({
    invalid: false,
    resolvers: Object.freeze(resolvers),
    protectedTargets: Object.freeze(protectedTargets),
  }) satisfies Registry
}

export function matchesAttachmentAccessSelector(selector: string, value: string): boolean {
  return matchesEntity(selector, value)
}

export function matchesAttachmentAccessTargets(selector: string, targets: readonly AttachmentAccessTarget[]): boolean {
  return selector === '*' || targets.some((target) => matchesAttachmentAccessSelector(selector, target.entityId))
}

export function matchesAttachmentAccessResolver(
  resolver: AttachmentAccessResolver,
  partitionCode: string,
  targets: readonly AttachmentAccessTarget[],
  action: AttachmentAccessAction,
): boolean {
  return matchesAttachmentAccessSelector(resolver.targetPartition, partitionCode)
    && matchesAttachmentAccessTargets(resolver.targetEntity ?? '*', targets)
    && (!resolver.actions || resolver.actions.includes(action))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function collectAttachmentAccessTargets(attachment: AttachmentAccessRecord): readonly AttachmentAccessTarget[] {
  const targets: AttachmentAccessTarget[] = []
  function append(entityId: unknown, recordId: unknown, origin: AttachmentAccessTarget['origin']) {
    if (typeof entityId !== 'string' || !entityId.trim()) return
    const target = Object.freeze({
      entityId: entityId.trim(),
      recordId: typeof recordId === 'string' ? recordId.trim() : '',
      origin,
    })
    if (!targets.some((candidate) => candidate.entityId === target.entityId && candidate.recordId === target.recordId)) {
      targets.push(target)
    }
  }
  append(attachment.entityId, attachment.recordId, 'primary')
  const assignments = isRecord(attachment.storageMetadata) ? attachment.storageMetadata.assignments : undefined
  const entries = Array.isArray(assignments) ? assignments : isRecord(assignments) ? [assignments] : []
  for (const assignment of entries) {
    if (isRecord(assignment)) append(assignment.type, assignment.id, 'assignment')
  }
  return Object.freeze(targets)
}
