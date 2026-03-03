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
