import {
  colorForSavedByRole,
  fromSubmission,
  ROW_BADGE_TONE,
  type SubmissionInboxRow,
} from '../backend/forms/[id]/submissions/components/RowBadges'

const baseRow: SubmissionInboxRow = {
  id: 'sub-1',
  status: 'submitted',
  formVersionNumber: 3,
  revisionCount: 5,
  distinctRoleCount: 1,
  pdfSnapshotAttachmentId: null,
  anonymizedAt: null,
}

describe('inbox RowBadges', () => {
  it('returns status, version, revision_count for a vanilla submitted row', () => {
    const badges = fromSubmission(baseRow)
    expect(badges.find((b) => b.kind === 'status')).toEqual({ kind: 'status', status: 'submitted' })
    expect(badges.find((b) => b.kind === 'version')).toEqual({ kind: 'version', versionNumber: 3 })
    expect(badges.find((b) => b.kind === 'revision_count')).toEqual({ kind: 'revision_count', count: 5 })
    expect(badges.find((b) => b.kind === 'multi_role')).toBeUndefined()
    expect(badges.find((b) => b.kind === 'pdf_available')).toBeUndefined()
    expect(badges.find((b) => b.kind === 'anonymized')).toBeUndefined()
  })

  it('emits multi_role when distinctRoleCount >= 2', () => {
    const badges = fromSubmission({ ...baseRow, distinctRoleCount: 2 })
    expect(badges.find((b) => b.kind === 'multi_role')).toEqual({ kind: 'multi_role' })
  })

  it('emits pdf_available when pdfSnapshotAttachmentId set', () => {
    const badges = fromSubmission({ ...baseRow, pdfSnapshotAttachmentId: 'attachment-1' })
    expect(badges.find((b) => b.kind === 'pdf_available')).toEqual({ kind: 'pdf_available' })
  })

  it('emits anonymized first when anonymizedAt set', () => {
    const badges = fromSubmission({ ...baseRow, anonymizedAt: '2026-05-08T10:00:00Z' })
    expect(badges[0]).toEqual({ kind: 'anonymized' })
  })

  it('maps every status to a tone token', () => {
    const statuses: SubmissionInboxRow['status'][] = [
      'draft',
      'submitted',
      'reopened',
      'archived',
      'anonymized',
    ]
    for (const status of statuses) {
      expect(ROW_BADGE_TONE[status]).toBeDefined()
    }
  })
})

describe('colorForSavedByRole', () => {
  it('maps known roles to expected tones', () => {
    expect(colorForSavedByRole('admin')).toBe('primary')
    expect(colorForSavedByRole('patient')).toBe('success')
    expect(colorForSavedByRole('clinician')).toBe('info')
    expect(colorForSavedByRole('system')).toBe('neutral')
  })

  it('returns neutral for null/undefined', () => {
    expect(colorForSavedByRole(null)).toBe('neutral')
    expect(colorForSavedByRole(undefined)).toBe('neutral')
  })

  it('returns warning for unknown roles', () => {
    expect(colorForSavedByRole('mystery_role')).toBe('warning')
  })
})
