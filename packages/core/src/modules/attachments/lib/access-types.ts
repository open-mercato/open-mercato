import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

export type AttachmentAccessAction = 'read' | 'render' | 'metadata' | 'reassign' | 'delete' | 'export' | 'create'

export type AttachmentAccessTarget = Readonly<{
  entityId: string
  recordId: string
  origin: 'primary' | 'assignment'
}>

export type AttachmentAccessRequirement = Readonly<{
  resolverId: string
  targetEntity: string
}>

export type ProtectedAttachmentTarget = AttachmentAccessRequirement & Readonly<{
  targetPartition: string
}>

export type AttachmentAccessRecord = {
  id: string
  entityId: string
  recordId: string
  partitionCode: string
  tenantId?: string | null
  organizationId?: string | null
  fileName: string
  mimeType: string
  storageMetadata?: unknown
}

export type AttachmentAccessPartition = {
  code: string
  isPublic: boolean
  tenantId?: string | null
  organizationId?: string | null
  accessResolverRequirements?: unknown
}

export type AttachmentAccessSubject = Readonly<{
  auth: Readonly<NonNullable<AuthContext>>
  userFeatures: readonly string[]
  tenantId: string | null
  organizationId: string | null
  isSuperAdmin: boolean
}>

export type AttachmentAccessInput = Readonly<{
  action: AttachmentAccessAction
  subject: AttachmentAccessSubject
  attachment: Readonly<Omit<AttachmentAccessRecord, 'storageMetadata'>>
  partition: Readonly<Omit<AttachmentAccessPartition, 'accessResolverRequirements'>>
  targets: readonly AttachmentAccessTarget[]
  container: AwilixContainer
  cache: Map<string, unknown>
  signal: AbortSignal
  /**
   * The caller's live EntityManager, present only when this evaluation runs
   * inside the mutating transaction it is gating (the upload route's
   * commit-boundary recheck). A resolver that mutates an owning aggregate
   * under a pessimistic lock elsewhere (e.g. archive/share commands) MUST
   * take the same lock here with this `em` when `commitBoundary` is true, so
   * the recheck is actually serialized against those commands rather than
   * racing a plain, unlocked read against them (#8975).
   */
  em?: EntityManager
  /**
   * True only for the recheck performed right before the attachment row is
   * flushed, inside the same transaction as that write. False (or absent)
   * for every other evaluation — including the upload's own pre-storage
   * check — where `em` is not transactionally tied to the decision and
   * taking a pessimistic lock would be both unnecessary and unsafe (no open
   * transaction to hold it in).
   */
  commitBoundary?: boolean
}>

export type AttachmentAccessDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404 | 504; reason: string }

export type AttachmentAccessResolver = Readonly<{
  id: string
  targetPartition: string
  targetEntity?: string
  actions?: readonly AttachmentAccessAction[]
  priority?: number
  timeoutMs?: number
  resolve(input: AttachmentAccessInput): Promise<AttachmentAccessDecision>
}>

export type AttachmentAccessResolverEntry = {
  moduleId: string
  resolvers: readonly unknown[]
  protectedTargets?: readonly unknown[]
}
