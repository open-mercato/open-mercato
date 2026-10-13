export type SubmissionInboxRow = {
  id: string
  status: 'draft' | 'submitted' | 'reopened' | 'archived' | 'anonymized'
  formVersionNumber: number
  revisionCount: number
  distinctRoleCount: number
  pdfSnapshotAttachmentId: string | null
  anonymizedAt: string | null
}

export type SubmissionRowBadge =
  | { kind: 'status'; status: SubmissionInboxRow['status'] }
  | { kind: 'version'; versionNumber: number }
  | { kind: 'revision_count'; count: number }
  | { kind: 'multi_role' }
  | { kind: 'pdf_available' }
  | { kind: 'anonymized' }

export const ROW_BADGE_TONE: Record<SubmissionInboxRow['status'], 'success' | 'warning' | 'info' | 'neutral' | 'error'> = {
  draft: 'warning',
  submitted: 'success',
  reopened: 'info',
  archived: 'neutral',
  anonymized: 'error',
}

export function fromSubmission(row: SubmissionInboxRow): SubmissionRowBadge[] {
  const badges: SubmissionRowBadge[] = []
  if (row.anonymizedAt) {
    badges.push({ kind: 'anonymized' })
  }
  badges.push({ kind: 'status', status: row.status })
  badges.push({ kind: 'version', versionNumber: row.formVersionNumber })
  badges.push({ kind: 'revision_count', count: row.revisionCount })
  if (row.distinctRoleCount >= 2) {
    badges.push({ kind: 'multi_role' })
  }
  if (row.pdfSnapshotAttachmentId) {
    badges.push({ kind: 'pdf_available' })
  }
  return badges
}

export const REVISION_TIMELINE_COLORS: Record<string, 'primary' | 'success' | 'warning' | 'info' | 'neutral'> = {
  admin: 'primary',
  patient: 'success',
  clinician: 'info',
  customer: 'success',
  staff: 'primary',
  system: 'neutral',
}

export function colorForSavedByRole(role: string | null | undefined): 'primary' | 'success' | 'warning' | 'info' | 'neutral' {
  if (!role) return 'neutral'
  return REVISION_TIMELINE_COLORS[role] ?? 'warning'
}
