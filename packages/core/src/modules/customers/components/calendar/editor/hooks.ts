"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { computeDurationMinutes, type EditorFormState, type EditorKindConfig } from '../../../lib/calendar/editorPayload'
import { fetchDealById, fetchRelatedEntityById, findStaffMemberName } from './lookups'

// Edit-mode prefill stores ids only (parseItemToFormState is pure); resolve the
// human labels for the related entity, the deal chip and the task assignee.
export function useEditorLabelResolution(
  open: boolean,
  form: EditorFormState,
  update: (patch: Partial<EditorFormState>) => void,
): void {
  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let cancelled = false
    async function resolveLabels() {
      if (form.relatedTo && form.relatedTo.kind === 'unknown') {
        const resolved = await fetchRelatedEntityById(form.relatedTo.id, controller.signal)
        if (!cancelled && resolved) update({ relatedTo: { id: resolved.id, kind: resolved.kind, label: resolved.label } })
      }
      if (form.dealId && !form.dealLabel) {
        const deal = await fetchDealById(form.dealId, controller.signal)
        if (!cancelled && deal) update({ dealLabel: deal.label })
      }
      if (form.assigneeUserId && !form.assigneeName) {
        const name = await findStaffMemberName(form.assigneeUserId, controller.signal)
        if (!cancelled && name) update({ assigneeName: name })
      }
    }
    resolveLabels().catch(() => {
      if (cancelled || controller.signal.aborted || !form.relatedTo || form.relatedTo.kind !== 'unknown' || form.relatedTo.label) {
        return
      }
      update({ relatedTo: { ...form.relatedTo, label: form.relatedTo.id } })
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [open, form.relatedTo, form.dealId, form.dealLabel, form.assigneeUserId, form.assigneeName, update])
}

// Debounced save-time conflict probe against the existing conflicts endpoint;
// the warning is informational and never blocks saving (mirrors ScheduleActivityDialog).
export function useConflictProbe(
  open: boolean,
  form: EditorFormState,
  config: EditorKindConfig,
  excludeId: string | null,
): string | null {
  const t = useT()
  const [conflict, setConflict] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!open || (config.hasAllDay && form.allDay) || !form.date || !form.startTime) {
      setConflict(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const localStart = new Date(`${form.date}T${form.startTime}:00`)
        const params = new URLSearchParams({
          date: form.date,
          startTime: form.startTime,
          duration: String(config.hasEnd ? computeDurationMinutes(form) ?? 30 : 30),
        })
        if (excludeId) params.set('excludeId', excludeId)
        if (!Number.isNaN(localStart.getTime())) params.set('timezoneOffsetMinutes', String(-localStart.getTimezoneOffset()))
        const body = await readApiResultOrThrow<{
          ok?: boolean
          result?: {
            hasConflicts?: boolean
            conflicts?: Array<{ id: string; title: string | null; startTime: string; endTime: string; type: string }>
          }
        }>(`/api/customers/interactions/conflicts?${params.toString()}`)
        const data = body?.result
        if (data?.hasConflicts && Array.isArray(data.conflicts) && data.conflicts.length > 0) {
          const items = data.conflicts.map((entry) => `${entry.startTime}–${entry.endTime}: ${entry.title ?? entry.type}`).join(', ')
          setConflict(t('customers.calendar.editor.conflictWarning', 'Overlaps with: {items}', { items }))
        } else {
          setConflict(null)
        }
      } catch {
        setConflict(null)
      }
    }, 500)
    return () => clearTimeout(timer)
    // Re-probe only when the schedule-relevant inputs change (mirrors ScheduleActivityDialog).
  }, [open, form.date, form.startTime, form.endDate, form.endTime, form.allDay, config.hasAllDay, config.hasEnd, excludeId, t]) // eslint-disable-line react-hooks/exhaustive-deps
  return conflict
}
