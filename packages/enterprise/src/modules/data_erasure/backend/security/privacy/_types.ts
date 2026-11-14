export type PrivacySubjectAction = 'discover' | 'export' | 'erase' | 'anonymize'

export type PrivacyDataClass = {
  id: string
  module: string
  title: string
  subjectKinds: string[]
  subjectIdentifierKinds?: string[]
  subjectActions: PrivacySubjectAction[]
  retention?: {
    actions: Array<'delete' | 'anonymize'>
    defaultDays: number
  }
}

export type PrivacyPolicy = {
  id: string
  dataClassId: string
  retentionDays: number
  action: 'delete' | 'anonymize'
  batchSize: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type PrivacyLegalHold = {
  id: string
  dataClassId: string | null
  subjectKind: string | null
  subjectId: string | null
  reason: string
  expiresAt: string | null
  releasedAt: string | null
  createdAt: string
  updatedAt: string
}

export type PrivacyOperation = {
  id: string
  type: 'retention' | 'sanitization' | PrivacySubjectAction
  status: 'running' | 'completed' | 'partial' | 'failed' | 'blocked'
  dataClassId: string | null
  subjectKind: string | null
  subjectId: string | null
  dryRun: boolean
  report: Record<string, unknown> | null
  requestedBy: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ResolvedSubjectRow = {
  id: string
  dataClassId: string
  kind: string
  subjectId: string
}

export type SubjectResolutionResponse = {
  operation: PrivacyOperation
  subjects: Record<string, Array<{ kind: string; id: string }>>
}

export type SubjectRequestResponse = {
  operation: PrivacyOperation
  exports?: Record<string, { recordCount: number; data: unknown }>
}
