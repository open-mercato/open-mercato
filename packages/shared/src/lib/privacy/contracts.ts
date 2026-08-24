import type { CommandRuntimeContext } from '../commands/types'

export type PrivacyScope = {
  tenantId: string
  organizationId: string
}

export type PrivacySubjectReference = {
  kind: string
  id: string
}

export type PrivacySubjectIdentifierKind = 'email'

export type PrivacySubjectIdentifier = {
  kind: PrivacySubjectIdentifierKind
  value: string
}

export type PrivacyRetentionAction = 'delete' | 'anonymize'
export type PrivacySubjectAction = 'discover' | 'export' | 'erase' | 'anonymize'
export type PrivacyEnvironmentSanitizationCategory =
  | 'personal_data'
  | 'authentication'
  | 'credentials'
  | 'outbound_integrations'
  | 'attachments'
  | 'ai_content'

export type PrivacyDataClassDefinition = {
  id: string
  module: string
  title: string
  description?: string
  handlerService: string
  subjectKinds: readonly string[]
  subjectIdentifierKinds?: readonly PrivacySubjectIdentifierKind[]
  retention?: {
    actions: readonly PrivacyRetentionAction[]
    defaultDays: number
  }
  subjectActions: readonly PrivacySubjectAction[]
  environmentSanitization?: {
    categories: readonly PrivacyEnvironmentSanitizationCategory[]
  }
}

export type PrivacyRetentionInput = {
  scope: PrivacyScope
  retentionDays: number
  action: PrivacyRetentionAction
  batchSize: number
  dryRun: boolean
  excludedSubjects: readonly PrivacySubjectReference[]
  actorId?: string
  commandContext?: CommandRuntimeContext
  now?: Date
}

export type PrivacyRetentionResult = {
  matched: number
  affected: number
  hasMore: boolean
}

export type PrivacySubjectInput = {
  scope: PrivacyScope
  subject: PrivacySubjectReference
  dryRun: boolean
  actorId: string
  commandContext?: CommandRuntimeContext
}

export type PrivacySubjectDiscoveryResult = {
  found: boolean
  recordCount: number
}

export type PrivacySubjectExportResult = {
  recordCount: number
  data: Record<string, unknown> | Array<Record<string, unknown>> | null
}

export type PrivacySubjectMutationResult = {
  affected: number
}

export type PrivacySubjectResolutionInput = {
  scope: PrivacyScope
  identifier: PrivacySubjectIdentifier
  actorId: string
}

export type PrivacySubjectResolutionResult = {
  subjects: PrivacySubjectReference[]
}

export type PrivacyEnvironmentSanitizationInput = {
  scope: PrivacyScope
  dryRun: boolean
  actorId: string
  profile: 'sandbox-strict'
}

export type PrivacyEnvironmentSanitizationResult = {
  matched: number
  affected: number
}

export type PrivacyEnvironmentSanitizationFinding = {
  code: string
  count: number
}

export type PrivacyEnvironmentSanitizationVerificationResult = {
  passed: boolean
  findings: PrivacyEnvironmentSanitizationFinding[]
}

export type PrivacyDataClassHandler = {
  runRetention?: (input: PrivacyRetentionInput) => Promise<PrivacyRetentionResult>
  resolveSubjects?: (input: PrivacySubjectResolutionInput) => Promise<PrivacySubjectResolutionResult>
  discoverSubject?: (input: PrivacySubjectInput) => Promise<PrivacySubjectDiscoveryResult>
  exportSubject?: (input: PrivacySubjectInput) => Promise<PrivacySubjectExportResult>
  eraseSubject?: (input: PrivacySubjectInput) => Promise<PrivacySubjectMutationResult>
  anonymizeSubject?: (input: PrivacySubjectInput) => Promise<PrivacySubjectMutationResult>
  sanitizeEnvironment?: (
    input: PrivacyEnvironmentSanitizationInput,
  ) => Promise<PrivacyEnvironmentSanitizationResult>
  verifyEnvironmentSanitization?: (
    input: PrivacyEnvironmentSanitizationInput,
  ) => Promise<PrivacyEnvironmentSanitizationVerificationResult>
}

export type PrivacyDataClassRegistry = {
  register: (definition: PrivacyDataClassDefinition) => void
  get: (id: string) => PrivacyDataClassDefinition | null
  list: () => PrivacyDataClassDefinition[]
  clear: () => void
}
