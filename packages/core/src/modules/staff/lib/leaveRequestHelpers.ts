export type LeaveRequestRecord = {
  id: string
  member?: { id?: string; displayName?: string }
  memberId?: string | null
  member_id?: string | null
  startDate?: string | null
  start_date?: string | null
  endDate?: string | null
  end_date?: string | null
  timezone?: string | null
  status?: 'pending' | 'approved' | 'rejected'
  unavailabilityReasonEntryId?: string | null
  unavailability_reason_entry_id?: string | null
  unavailabilityReasonValue?: string | null
  unavailability_reason_value?: string | null
  note?: string | null
  decisionComment?: string | null
  decision_comment?: string | null
  decidedAt?: string | null
  decided_at?: string | null
} & Record<string, unknown>

export type NormalizedLeaveRequest = {
  id: string
  member?: { id?: string; displayName?: string }
  memberId: string | null
  startDate: string | null
  endDate: string | null
  timezone: string | null
  status: 'pending' | 'approved' | 'rejected'
  unavailabilityReasonEntryId: string | null
  unavailabilityReasonValue: string | null
  note: string | null
  decisionComment: string | null
  decidedAt: string | null
} & Record<string, unknown>

export function normalizeLeaveRequest(record: LeaveRequestRecord): NormalizedLeaveRequest {
  return {
    ...record,
    id: record.id,
    member: record.member,
    memberId: record.memberId ?? record.member_id ?? null,
    startDate: record.startDate ?? record.start_date ?? null,
    endDate: record.endDate ?? record.end_date ?? null,
    timezone: record.timezone ?? null,
    status: record.status ?? 'pending',
    unavailabilityReasonEntryId: record.unavailabilityReasonEntryId ?? record.unavailability_reason_entry_id ?? null,
    unavailabilityReasonValue: record.unavailabilityReasonValue ?? record.unavailability_reason_value ?? null,
    note: record.note ?? null,
    decisionComment: record.decisionComment ?? record.decision_comment ?? null,
    decidedAt: record.decidedAt ?? record.decided_at ?? null,
  }
}

export type LeaveRequestsResponse = {
  items?: LeaveRequestRecord[]
}

export function resolveStatusVariant(status: 'pending' | 'approved' | 'rejected') {
  if (status === 'approved') return 'default'
  if (status === 'rejected') return 'destructive'
  return 'secondary'
}

export function formatDateLabel(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

export function formatDateRange(start?: string | null, end?: string | null): string {
  const startLabel = formatDateLabel(start)
  const endLabel = formatDateLabel(end)
  if (startLabel && endLabel) return `${startLabel} -> ${endLabel}`
  return startLabel || endLabel || '-'
}
