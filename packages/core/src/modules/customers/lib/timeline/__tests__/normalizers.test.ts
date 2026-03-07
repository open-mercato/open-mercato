import { describe, it, expect } from 'vitest'
import {
  normalizeAuditLogs,
  normalizeStageHistory,
  normalizeComments,
  normalizeActivities,
  normalizeAttachments,
  normalizeEmails,
} from '../normalizers'
import type {
  AuditLogEntry,
  StageHistoryEntry,
  CommentEntry,
  ActivityEntry,
  AttachmentEntry,
  EmailEntry,
} from '../normalizers'

const KNOWN_USER_ID = 'user-abc-123'
const UNKNOWN_USER_ID = 'user-unknown-456'
const KNOWN_USER_NAME = 'Alice Johnson'

const displayUsers: Record<string, string> = {
  [KNOWN_USER_ID]: KNOWN_USER_NAME,
}

const FIXED_ISO = '2026-03-01T12:00:00.000Z'

function makeAuditLog(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'log-1',
    commandId: 'customers.deals.update',
    actionLabel: null,
    executionState: 'done',
    actorUserId: KNOWN_USER_ID,
    resourceKind: 'deal',
    resourceId: 'deal-1',
    createdAt: FIXED_ISO,
    changesJson: { title: { from: 'Old', to: 'New' } },
    snapshotBefore: null,
    snapshotAfter: null,
    ...overrides,
  }
}

function makeStageHistoryEntry(overrides: Partial<StageHistoryEntry> = {}): StageHistoryEntry {
  return {
    id: 'stage-1',
    fromStageLabel: 'Qualification',
    toStageLabel: 'Proposal',
    changedByUserId: KNOWN_USER_ID,
    durationSeconds: 86400,
    fromStageId: 'stage-id-1',
    createdAt: FIXED_ISO,
    ...overrides,
  }
}

function makeComment(overrides: Partial<CommentEntry> = {}): CommentEntry {
  return {
    id: 'comment-1',
    body: 'This is a comment',
    authorUserId: KNOWN_USER_ID,
    createdAt: FIXED_ISO,
    ...overrides,
  }
}

function makeActivity(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'activity-1',
    activityType: 'Call',
    subject: 'Follow-up call',
    body: 'Discussed pricing options',
    occurredAt: FIXED_ISO,
    authorUserId: KNOWN_USER_ID,
    assignedToUserId: null,
    ...overrides,
  }
}

function makeAttachment(overrides: Partial<AttachmentEntry> = {}): AttachmentEntry {
  return {
    id: 'attachment-1',
    fileName: 'proposal.pdf',
    fileSize: 204800,
    mimeType: 'application/pdf',
    createdAt: FIXED_ISO,
    ...overrides,
  }
}

function makeEmail(overrides: Partial<EmailEntry> = {}): EmailEntry {
  return {
    id: 'email-1',
    direction: 'outbound',
    fromAddress: 'sales@example.com',
    fromName: 'Sales Team',
    toAddresses: [{ email: 'client@example.com', name: 'Client' }],
    subject: 'Proposal Attached',
    bodyText: 'Please find attached the proposal.',
    sentAt: FIXED_ISO,
    hasAttachments: true,
    ...overrides,
  }
}

describe('normalizeAuditLogs', () => {
  describe('execution state filtering', () => {
    it('includes logs with executionState "done"', () => {
      const logs = [makeAuditLog({ executionState: 'done' })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result).toHaveLength(1)
    })

    it('includes logs with executionState "redone"', () => {
      const logs = [makeAuditLog({ executionState: 'redone' })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result).toHaveLength(1)
    })

    it('excludes logs with executionState "undone"', () => {
      const logs = [makeAuditLog({ executionState: 'undone' })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result).toHaveLength(0)
    })

    it('excludes logs with executionState "pending"', () => {
      const logs = [makeAuditLog({ executionState: 'pending' })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result).toHaveLength(0)
    })
  })

  describe('command type classification', () => {
    it('maps ".create" commandId to deal_created kind', () => {
      const logs = [makeAuditLog({ commandId: 'customers.deals.create', changesJson: null })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result).toHaveLength(1)
      expect(result[0].kind).toBe('deal_created')
    })

    it('maps ".delete" commandId to deal_deleted kind', () => {
      const logs = [makeAuditLog({ commandId: 'customers.deals.delete', changesJson: null })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result).toHaveLength(1)
      expect(result[0].kind).toBe('deal_deleted')
    })

    it('maps other commandIds to deal_updated kind', () => {
      const logs = [makeAuditLog({ commandId: 'customers.deals.update' })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result).toHaveLength(1)
      expect(result[0].kind).toBe('deal_updated')
    })
  })

  describe('ID prefixing', () => {
    it('prefixes entry IDs with "audit:"', () => {
      const logs = [makeAuditLog({ id: 'abc-123' })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].id).toBe('audit:abc-123')
    })
  })

  describe('summary and actionLabel', () => {
    it('uses actionLabel for create if provided', () => {
      const logs = [makeAuditLog({
        commandId: 'customers.deals.create',
        actionLabel: 'Custom create label',
        changesJson: null,
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].summary).toBe('Custom create label')
    })

    it('falls back to "Deal created" when actionLabel is null on create', () => {
      const logs = [makeAuditLog({
        commandId: 'customers.deals.create',
        actionLabel: null,
        changesJson: null,
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].summary).toBe('Deal created')
    })

    it('uses actionLabel for delete if provided', () => {
      const logs = [makeAuditLog({
        commandId: 'customers.deals.delete',
        actionLabel: 'Custom delete label',
        changesJson: null,
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].summary).toBe('Custom delete label')
    })

    it('falls back to "Deal deleted" when actionLabel is null on delete', () => {
      const logs = [makeAuditLog({
        commandId: 'customers.deals.delete',
        actionLabel: null,
        changesJson: null,
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].summary).toBe('Deal deleted')
    })

    it('shows "Updated <field label>" for single field change', () => {
      const logs = [makeAuditLog({
        changesJson: { title: { from: 'Old', to: 'New' } },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].summary).toBe('Updated title')
    })

    it('shows "Updated N fields" for multiple field changes', () => {
      const logs = [makeAuditLog({
        changesJson: {
          title: { from: 'Old', to: 'New' },
          status: { from: 'open', to: 'closed' },
          probability: { from: 50, to: 90 },
        },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].summary).toBe('Updated 3 fields')
    })
  })

  describe('field change extraction', () => {
    it('extracts field changes with from/to values', () => {
      const logs = [makeAuditLog({
        changesJson: {
          title: { from: 'Old Title', to: 'New Title' },
          status: { from: 'open', to: 'won' },
        },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].changes).toEqual([
        { field: 'title', label: 'Title', from: 'Old Title', to: 'New Title' },
        { field: 'status', label: 'Status', from: 'open', to: 'won' },
      ])
    })

    it('uses FIELD_LABELS mapping for known fields', () => {
      const logs = [makeAuditLog({
        changesJson: { valueAmount: { from: 1000, to: 2000 } },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].changes).toEqual([
        { field: 'valueAmount', label: 'Deal value', from: 1000, to: 2000 },
      ])
    })

    it('uses field name as label for unknown fields', () => {
      const logs = [makeAuditLog({
        changesJson: { customField: { from: 'a', to: 'b' } },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].changes).toEqual([
        { field: 'customField', label: 'customField', from: 'a', to: 'b' },
      ])
    })

    it('defaults from/to to null when not present in change record', () => {
      const logs = [makeAuditLog({
        changesJson: { title: {} },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].changes).toEqual([
        { field: 'title', label: 'Title', from: null, to: null },
      ])
    })

    it('skips non-object change values', () => {
      const logs = [makeAuditLog({
        changesJson: {
          title: { from: 'Old', to: 'New' },
          badField: 'not-an-object',
          nullField: null,
        },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].changes).toEqual([
        { field: 'title', label: 'Title', from: 'Old', to: 'New' },
      ])
    })

    it('sets detail to null for create entries', () => {
      const logs = [makeAuditLog({ commandId: 'customers.deals.create' })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].detail).toBeNull()
      expect(result[0].changes).toBeNull()
    })

    it('sets detail to null for delete entries', () => {
      const logs = [makeAuditLog({ commandId: 'customers.deals.delete' })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].detail).toBeNull()
      expect(result[0].changes).toBeNull()
    })
  })

  describe('stage history deduplication', () => {
    it('skips logs with only pipelineStageId changes when hasStageHistory is true', () => {
      const logs = [makeAuditLog({
        changesJson: { pipelineStageId: { from: 'stage-1', to: 'stage-2' } },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, true)
      expect(result).toHaveLength(0)
    })

    it('skips logs with only pipelineStage changes when hasStageHistory is true', () => {
      const logs = [makeAuditLog({
        changesJson: { pipelineStage: { from: 'Old Stage', to: 'New Stage' } },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, true)
      expect(result).toHaveLength(0)
    })

    it('skips logs with both pipelineStageId and pipelineStage when hasStageHistory is true', () => {
      const logs = [makeAuditLog({
        changesJson: {
          pipelineStageId: { from: 'stage-1', to: 'stage-2' },
          pipelineStage: { from: 'Old Stage', to: 'New Stage' },
        },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, true)
      expect(result).toHaveLength(0)
    })

    it('excludes stage fields but keeps other changes when hasStageHistory is true', () => {
      const logs = [makeAuditLog({
        changesJson: {
          title: { from: 'Old', to: 'New' },
          pipelineStageId: { from: 'stage-1', to: 'stage-2' },
        },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, true)
      expect(result).toHaveLength(1)
      expect(result[0].changes).toEqual([
        { field: 'title', label: 'Title', from: 'Old', to: 'New' },
      ])
    })

    it('includes stage fields in changes when hasStageHistory is false', () => {
      const logs = [makeAuditLog({
        changesJson: {
          pipelineStageId: { from: 'stage-1', to: 'stage-2' },
        },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result).toHaveLength(1)
      expect(result[0].changes).toEqual([
        { field: 'pipelineStageId', label: 'Pipeline stage', from: 'stage-1', to: 'stage-2' },
      ])
    })
  })

  describe('empty changes filtering', () => {
    it('skips update logs with null changesJson', () => {
      const logs = [makeAuditLog({
        commandId: 'customers.deals.update',
        changesJson: null,
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result).toHaveLength(0)
    })

    it('skips update logs with empty changesJson', () => {
      const logs = [makeAuditLog({
        commandId: 'customers.deals.update',
        changesJson: {},
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result).toHaveLength(0)
    })

    it('skips update logs where all changes are non-object values', () => {
      const logs = [makeAuditLog({
        commandId: 'customers.deals.update',
        changesJson: { someField: 'string-not-object' },
      })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result).toHaveLength(0)
    })
  })

  describe('actor resolution', () => {
    it('resolves known user to display name', () => {
      const logs = [makeAuditLog({ actorUserId: KNOWN_USER_ID })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].actor).toEqual({ id: KNOWN_USER_ID, label: KNOWN_USER_NAME })
    })

    it('uses userId as label when user is not in displayUsers', () => {
      const logs = [makeAuditLog({ actorUserId: UNKNOWN_USER_ID })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].actor).toEqual({ id: UNKNOWN_USER_ID, label: UNKNOWN_USER_ID })
    })

    it('uses "System" label when actorUserId is null', () => {
      const logs = [makeAuditLog({ actorUserId: null })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].actor).toEqual({ id: null, label: 'System' })
    })
  })

  describe('timestamp handling', () => {
    it('converts Date objects to ISO strings', () => {
      const date = new Date('2026-06-15T10:30:00.000Z')
      const logs = [makeAuditLog({ createdAt: date })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].occurredAt).toBe('2026-06-15T10:30:00.000Z')
    })

    it('passes through string dates unchanged', () => {
      const logs = [makeAuditLog({ createdAt: '2026-01-01T00:00:00.000Z' })]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result[0].occurredAt).toBe('2026-01-01T00:00:00.000Z')
    })
  })

  describe('multiple logs', () => {
    it('processes multiple logs correctly', () => {
      const logs = [
        makeAuditLog({ id: 'log-1', commandId: 'customers.deals.create' }),
        makeAuditLog({ id: 'log-2', executionState: 'undone' }),
        makeAuditLog({ id: 'log-3', changesJson: { title: { from: 'A', to: 'B' } } }),
      ]
      const result = normalizeAuditLogs(logs, displayUsers, false)
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('audit:log-1')
      expect(result[0].kind).toBe('deal_created')
      expect(result[1].id).toBe('audit:log-3')
      expect(result[1].kind).toBe('deal_updated')
    })

    it('returns empty array for empty input', () => {
      const result = normalizeAuditLogs([], displayUsers, false)
      expect(result).toEqual([])
    })
  })
})

describe('normalizeStageHistory', () => {
  it('returns entries with kind "stage_changed"', () => {
    const entries = [makeStageHistoryEntry()]
    const result = normalizeStageHistory(entries, displayUsers)
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('stage_changed')
  })

  it('prefixes entry IDs with "stage:"', () => {
    const entries = [makeStageHistoryEntry({ id: 'sh-99' })]
    const result = normalizeStageHistory(entries, displayUsers)
    expect(result[0].id).toBe('stage:sh-99')
  })

  describe('summary generation', () => {
    it('shows "fromStageLabel -> toStageLabel" when fromStageLabel exists', () => {
      const entries = [makeStageHistoryEntry({
        fromStageLabel: 'Lead',
        toStageLabel: 'Qualified',
      })]
      const result = normalizeStageHistory(entries, displayUsers)
      expect(result[0].summary).toBe('Lead \u2192 Qualified')
    })

    it('shows "Assigned to toStageLabel" when fromStageLabel is null', () => {
      const entries = [makeStageHistoryEntry({
        fromStageLabel: null,
        toStageLabel: 'New Lead',
      })]
      const result = normalizeStageHistory(entries, displayUsers)
      expect(result[0].summary).toBe('Assigned to New Lead')
    })
  })

  describe('detail fields', () => {
    it('includes fromStageLabel, toStageLabel, and durationSeconds in detail', () => {
      const entries = [makeStageHistoryEntry({
        fromStageLabel: 'Qualification',
        toStageLabel: 'Proposal',
        durationSeconds: 172800,
      })]
      const result = normalizeStageHistory(entries, displayUsers)
      expect(result[0].detail).toEqual({
        fromStageLabel: 'Qualification',
        toStageLabel: 'Proposal',
        durationSeconds: 172800,
      })
    })

    it('includes null durationSeconds when not available', () => {
      const entries = [makeStageHistoryEntry({ durationSeconds: null })]
      const result = normalizeStageHistory(entries, displayUsers)
      expect(result[0].detail).toMatchObject({ durationSeconds: null })
    })
  })

  it('sets changes to null', () => {
    const entries = [makeStageHistoryEntry()]
    const result = normalizeStageHistory(entries, displayUsers)
    expect(result[0].changes).toBeNull()
  })

  describe('actor resolution', () => {
    it('resolves known changedByUserId', () => {
      const entries = [makeStageHistoryEntry({ changedByUserId: KNOWN_USER_ID })]
      const result = normalizeStageHistory(entries, displayUsers)
      expect(result[0].actor).toEqual({ id: KNOWN_USER_ID, label: KNOWN_USER_NAME })
    })

    it('uses userId as label for unknown changedByUserId', () => {
      const entries = [makeStageHistoryEntry({ changedByUserId: UNKNOWN_USER_ID })]
      const result = normalizeStageHistory(entries, displayUsers)
      expect(result[0].actor).toEqual({ id: UNKNOWN_USER_ID, label: UNKNOWN_USER_ID })
    })

    it('returns System actor when changedByUserId is null', () => {
      const entries = [makeStageHistoryEntry({ changedByUserId: null })]
      const result = normalizeStageHistory(entries, displayUsers)
      expect(result[0].actor).toEqual({ id: null, label: 'System' })
    })
  })

  it('returns empty array for empty input', () => {
    const result = normalizeStageHistory([], displayUsers)
    expect(result).toEqual([])
  })

  it('processes multiple entries preserving order', () => {
    const entries = [
      makeStageHistoryEntry({ id: 'sh-1', toStageLabel: 'First' }),
      makeStageHistoryEntry({ id: 'sh-2', toStageLabel: 'Second' }),
    ]
    const result = normalizeStageHistory(entries, displayUsers)
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('stage:sh-1')
    expect(result[1].id).toBe('stage:sh-2')
  })
})

describe('normalizeComments', () => {
  it('returns entries with kind "comment_added"', () => {
    const comments = [makeComment()]
    const result = normalizeComments(comments, displayUsers)
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('comment_added')
  })

  it('prefixes entry IDs with "comment:"', () => {
    const comments = [makeComment({ id: 'c-42' })]
    const result = normalizeComments(comments, displayUsers)
    expect(result[0].id).toBe('comment:c-42')
  })

  describe('body truncation', () => {
    it('uses full body as summary when 120 chars or fewer', () => {
      const body = 'Short comment'
      const comments = [makeComment({ body })]
      const result = normalizeComments(comments, displayUsers)
      expect(result[0].summary).toBe(body)
    })

    it('uses body of exactly 120 chars without truncation', () => {
      const body = 'A'.repeat(120)
      const comments = [makeComment({ body })]
      const result = normalizeComments(comments, displayUsers)
      expect(result[0].summary).toBe(body)
    })

    it('truncates body longer than 120 chars with "..."', () => {
      const body = 'B'.repeat(200)
      const comments = [makeComment({ body })]
      const result = normalizeComments(comments, displayUsers)
      expect(result[0].summary).toBe('B'.repeat(120) + '...')
      expect(result[0].summary.length).toBe(123)
    })
  })

  it('includes full body in detail', () => {
    const body = 'C'.repeat(200)
    const comments = [makeComment({ body })]
    const result = normalizeComments(comments, displayUsers)
    expect(result[0].detail).toEqual({ body })
  })

  it('sets changes to null', () => {
    const comments = [makeComment()]
    const result = normalizeComments(comments, displayUsers)
    expect(result[0].changes).toBeNull()
  })

  describe('actor resolution', () => {
    it('resolves known authorUserId', () => {
      const comments = [makeComment({ authorUserId: KNOWN_USER_ID })]
      const result = normalizeComments(comments, displayUsers)
      expect(result[0].actor).toEqual({ id: KNOWN_USER_ID, label: KNOWN_USER_NAME })
    })

    it('uses userId as label for unknown authorUserId', () => {
      const comments = [makeComment({ authorUserId: UNKNOWN_USER_ID })]
      const result = normalizeComments(comments, displayUsers)
      expect(result[0].actor).toEqual({ id: UNKNOWN_USER_ID, label: UNKNOWN_USER_ID })
    })

    it('returns System actor when authorUserId is null', () => {
      const comments = [makeComment({ authorUserId: null })]
      const result = normalizeComments(comments, displayUsers)
      expect(result[0].actor).toEqual({ id: null, label: 'System' })
    })
  })

  it('returns empty array for empty input', () => {
    const result = normalizeComments([], displayUsers)
    expect(result).toEqual([])
  })
})

describe('normalizeActivities', () => {
  it('returns entries with kind "activity_logged"', () => {
    const activities = [makeActivity()]
    const result = normalizeActivities(activities, displayUsers)
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('activity_logged')
  })

  it('prefixes entry IDs with "activity:"', () => {
    const activities = [makeActivity({ id: 'act-7' })]
    const result = normalizeActivities(activities, displayUsers)
    expect(result[0].id).toBe('activity:act-7')
  })

  describe('summary generation', () => {
    it('shows "activityType: subject" when subject is present', () => {
      const activities = [makeActivity({ activityType: 'Meeting', subject: 'Quarterly Review' })]
      const result = normalizeActivities(activities, displayUsers)
      expect(result[0].summary).toBe('Meeting: Quarterly Review')
    })

    it('shows just activityType when subject is null', () => {
      const activities = [makeActivity({ activityType: 'Email', subject: null })]
      const result = normalizeActivities(activities, displayUsers)
      expect(result[0].summary).toBe('Email')
    })
  })

  describe('detail fields', () => {
    it('includes activityType and subject in detail', () => {
      const activities = [makeActivity({ activityType: 'Call', subject: 'Check in' })]
      const result = normalizeActivities(activities, displayUsers)
      expect(result[0].detail).toMatchObject({
        activityType: 'Call',
        subject: 'Check in',
      })
    })

    it('truncates body to 120 chars as bodyPreview', () => {
      const longBody = 'D'.repeat(200)
      const activities = [makeActivity({ body: longBody })]
      const result = normalizeActivities(activities, displayUsers)
      const detail = result[0].detail as Record<string, unknown>
      expect(detail.bodyPreview).toBe('D'.repeat(120) + '...')
    })

    it('does not truncate body of 120 chars or fewer', () => {
      const shortBody = 'E'.repeat(120)
      const activities = [makeActivity({ body: shortBody })]
      const result = normalizeActivities(activities, displayUsers)
      const detail = result[0].detail as Record<string, unknown>
      expect(detail.bodyPreview).toBe(shortBody)
    })

    it('sets bodyPreview to null when body is null', () => {
      const activities = [makeActivity({ body: null })]
      const result = normalizeActivities(activities, displayUsers)
      const detail = result[0].detail as Record<string, unknown>
      expect(detail.bodyPreview).toBeNull()
    })
  })

  it('uses occurredAt field for timestamp instead of createdAt', () => {
    const activities = [makeActivity({ occurredAt: '2026-05-01T08:00:00.000Z' })]
    const result = normalizeActivities(activities, displayUsers)
    expect(result[0].occurredAt).toBe('2026-05-01T08:00:00.000Z')
  })

  it('sets changes to null', () => {
    const activities = [makeActivity()]
    const result = normalizeActivities(activities, displayUsers)
    expect(result[0].changes).toBeNull()
  })

  describe('actor resolution', () => {
    it('resolves known authorUserId', () => {
      const activities = [makeActivity({ authorUserId: KNOWN_USER_ID })]
      const result = normalizeActivities(activities, displayUsers)
      expect(result[0].actor).toEqual({ id: KNOWN_USER_ID, label: KNOWN_USER_NAME })
    })

    it('uses userId for unknown authorUserId', () => {
      const activities = [makeActivity({ authorUserId: UNKNOWN_USER_ID })]
      const result = normalizeActivities(activities, displayUsers)
      expect(result[0].actor).toEqual({ id: UNKNOWN_USER_ID, label: UNKNOWN_USER_ID })
    })

    it('returns System actor when authorUserId is null', () => {
      const activities = [makeActivity({ authorUserId: null })]
      const result = normalizeActivities(activities, displayUsers)
      expect(result[0].actor).toEqual({ id: null, label: 'System' })
    })
  })

  it('returns empty array for empty input', () => {
    const result = normalizeActivities([], displayUsers)
    expect(result).toEqual([])
  })
})

describe('normalizeAttachments', () => {
  it('returns entries with kind "file_uploaded"', () => {
    const attachments = [makeAttachment()]
    const result = normalizeAttachments(attachments)
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('file_uploaded')
  })

  it('prefixes entry IDs with "file:"', () => {
    const attachments = [makeAttachment({ id: 'att-5' })]
    const result = normalizeAttachments(attachments)
    expect(result[0].id).toBe('file:att-5')
  })

  it('always sets actor to System with null id', () => {
    const attachments = [makeAttachment()]
    const result = normalizeAttachments(attachments)
    expect(result[0].actor).toEqual({ id: null, label: 'System' })
  })

  it('uses fileName as summary', () => {
    const attachments = [makeAttachment({ fileName: 'contract.docx' })]
    const result = normalizeAttachments(attachments)
    expect(result[0].summary).toBe('contract.docx')
  })

  it('includes fileName, fileSize, and mimeType in detail', () => {
    const attachments = [makeAttachment({
      fileName: 'image.png',
      fileSize: 1024,
      mimeType: 'image/png',
    })]
    const result = normalizeAttachments(attachments)
    expect(result[0].detail).toEqual({
      fileName: 'image.png',
      fileSize: 1024,
      mimeType: 'image/png',
    })
  })

  it('sets changes to null', () => {
    const attachments = [makeAttachment()]
    const result = normalizeAttachments(attachments)
    expect(result[0].changes).toBeNull()
  })

  it('returns empty array for empty input', () => {
    const result = normalizeAttachments([])
    expect(result).toEqual([])
  })

  it('processes multiple attachments preserving order', () => {
    const attachments = [
      makeAttachment({ id: 'a-1', fileName: 'first.pdf' }),
      makeAttachment({ id: 'a-2', fileName: 'second.pdf' }),
    ]
    const result = normalizeAttachments(attachments)
    expect(result).toHaveLength(2)
    expect(result[0].summary).toBe('first.pdf')
    expect(result[1].summary).toBe('second.pdf')
  })
})

describe('normalizeEmails', () => {
  describe('email direction', () => {
    it('maps outbound emails to kind "email_sent"', () => {
      const emails = [makeEmail({ direction: 'outbound' })]
      const result = normalizeEmails(emails)
      expect(result[0].kind).toBe('email_sent')
    })

    it('maps inbound emails to kind "email_received"', () => {
      const emails = [makeEmail({ direction: 'inbound' })]
      const result = normalizeEmails(emails)
      expect(result[0].kind).toBe('email_received')
    })

    it('maps unknown direction to kind "email_received"', () => {
      const emails = [makeEmail({ direction: 'unknown' })]
      const result = normalizeEmails(emails)
      expect(result[0].kind).toBe('email_received')
    })
  })

  it('prefixes entry IDs with "email:"', () => {
    const emails = [makeEmail({ id: 'em-99' })]
    const result = normalizeEmails(emails)
    expect(result[0].id).toBe('email:em-99')
  })

  describe('actor label', () => {
    it('uses fromName as actor label when available', () => {
      const emails = [makeEmail({ fromName: 'John Doe', fromAddress: 'john@example.com' })]
      const result = normalizeEmails(emails)
      expect(result[0].actor).toEqual({ id: null, label: 'John Doe' })
    })

    it('falls back to fromAddress when fromName is null', () => {
      const emails = [makeEmail({ fromName: null, fromAddress: 'noreply@system.com' })]
      const result = normalizeEmails(emails)
      expect(result[0].actor).toEqual({ id: null, label: 'noreply@system.com' })
    })
  })

  it('uses subject as summary', () => {
    const emails = [makeEmail({ subject: 'Meeting follow-up' })]
    const result = normalizeEmails(emails)
    expect(result[0].summary).toBe('Meeting follow-up')
  })

  describe('detail fields', () => {
    it('includes subject, fromAddress, toAddresses, and hasAttachments', () => {
      const toAddresses = [
        { email: 'alice@example.com', name: 'Alice' },
        { email: 'bob@example.com' },
      ]
      const emails = [makeEmail({
        subject: 'Test Subject',
        fromAddress: 'sender@example.com',
        toAddresses,
        hasAttachments: false,
      })]
      const result = normalizeEmails(emails)
      const detail = result[0].detail as Record<string, unknown>
      expect(detail.subject).toBe('Test Subject')
      expect(detail.fromAddress).toBe('sender@example.com')
      expect(detail.toAddresses).toEqual(toAddresses)
      expect(detail.hasAttachments).toBe(false)
    })

    it('truncates bodyText to 120 chars as bodyPreview', () => {
      const longBody = 'F'.repeat(200)
      const emails = [makeEmail({ bodyText: longBody })]
      const result = normalizeEmails(emails)
      const detail = result[0].detail as Record<string, unknown>
      expect(detail.bodyPreview).toBe('F'.repeat(120) + '...')
    })

    it('does not truncate bodyText of 120 chars or fewer', () => {
      const shortBody = 'G'.repeat(120)
      const emails = [makeEmail({ bodyText: shortBody })]
      const result = normalizeEmails(emails)
      const detail = result[0].detail as Record<string, unknown>
      expect(detail.bodyPreview).toBe(shortBody)
    })

    it('sets bodyPreview to null when bodyText is null', () => {
      const emails = [makeEmail({ bodyText: null })]
      const result = normalizeEmails(emails)
      const detail = result[0].detail as Record<string, unknown>
      expect(detail.bodyPreview).toBeNull()
    })
  })

  it('uses sentAt for timestamp', () => {
    const emails = [makeEmail({ sentAt: '2026-02-14T09:00:00.000Z' })]
    const result = normalizeEmails(emails)
    expect(result[0].occurredAt).toBe('2026-02-14T09:00:00.000Z')
  })

  it('sets changes to null', () => {
    const emails = [makeEmail()]
    const result = normalizeEmails(emails)
    expect(result[0].changes).toBeNull()
  })

  it('returns empty array for empty input', () => {
    const result = normalizeEmails([])
    expect(result).toEqual([])
  })

  it('processes multiple emails with mixed directions', () => {
    const emails = [
      makeEmail({ id: 'e-1', direction: 'outbound', subject: 'Sent' }),
      makeEmail({ id: 'e-2', direction: 'inbound', subject: 'Received' }),
    ]
    const result = normalizeEmails(emails)
    expect(result).toHaveLength(2)
    expect(result[0].kind).toBe('email_sent')
    expect(result[0].summary).toBe('Sent')
    expect(result[1].kind).toBe('email_received')
    expect(result[1].summary).toBe('Received')
  })
})
