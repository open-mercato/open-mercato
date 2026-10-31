import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

export type AttachmentAccessAction = 'read' | 'render' | 'metadata' | 'reassign' | 'delete' | 'export'

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
