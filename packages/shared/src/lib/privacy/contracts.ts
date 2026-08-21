import type { CommandRuntimeContext } from '../commands/types'

export type PrivacyScope = {
  tenantId: string
  organizationId: string
}

export type PrivacySubjectReference = {
  kind: string
  id: string
}

export type PrivacyRetentionAction = 'delete' | 'anonymize'
export type PrivacySubjectAction = 'discover' | 'export' | 'erase' | 'anonymize'

export type PrivacyDataClassDefinition = {
  id: string
  module: string
  title: string
  description?: string
  handlerService: string
  subjectKinds: readonly string[]
  retention?: {
    actions: readonly PrivacyRetentionAction[]
    defaultDays: number
  }
  subjectActions: readonly PrivacySubjectAction[]
}

export type PrivacyRetentionInput = {
  scope: PrivacyScope
  retentionDays: number
  action: PrivacyRetentionAction
  batchSize: number
  dryRun: boolean
  excludedSubjects: readonly PrivacySubjectReference[]
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

export type PrivacyDataClassHandler = {
  runRetention?: (input: PrivacyRetentionInput) => Promise<PrivacyRetentionResult>
  discoverSubject?: (input: PrivacySubjectInput) => Promise<PrivacySubjectDiscoveryResult>
  exportSubject?: (input: PrivacySubjectInput) => Promise<PrivacySubjectExportResult>
  eraseSubject?: (input: PrivacySubjectInput) => Promise<PrivacySubjectMutationResult>
  anonymizeSubject?: (input: PrivacySubjectInput) => Promise<PrivacySubjectMutationResult>
}

export type PrivacyDataClassRegistry = {
  register: (definition: PrivacyDataClassDefinition) => void
  get: (id: string) => PrivacyDataClassDefinition | null
  list: () => PrivacyDataClassDefinition[]
  clear: () => void
}
