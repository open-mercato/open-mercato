"use client"

import * as React from 'react'
import { endOfDay } from 'date-fns/endOfDay'
import { startOfDay } from 'date-fns/startOfDay'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { computeDurationMinutes, type EditorFormState, type EditorKindConfig } from '../../../lib/calendar/editorPayload'
import { findEditorConflictItems } from '../../../lib/calendar/conflicts'
import type { ConflictScope } from '../../../lib/calendar/preferences'
import { mapInteractionToCalendarItem } from '../../../lib/calendar/mapItem'
import { expandOccurrences } from '../../../lib/calendar/recurrence'
import { getFetchWindow } from '../../../lib/calendar/range'
import type { CalendarItem } from '../types'
import { fetchInteractionWindow } from '../useCalendarItems'
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

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Debounced save-time conflict probe. Detection uses the SAME `findConflicts`
// logic the grid uses (overlap + shared owner/participant) against a freshly
// fetched ±1-day window, so the editor warning is always consistent with the
// conflict badges/rings the user sees on the calendar. The warning is
// informational and never blocks saving.
export function useConflictProbe(
  open: boolean,
  form: EditorFormState,
  config: EditorKindConfig,
  excludeId: string | null,
  draftOwnerUserId: string | null,
  scope: ConflictScope,
  currentUserId: string | null,
): string | null {
  const t = useT()
  const [conflict, setConflict] = React.useState<string | null>(null)
  const participantsKey = form.participants.map((participant) => participant.userId).join(',')
  React.useEffect(() => {
    if (!open || !form.date) {
      setConflict(null)
      return
    }
    // Resolve the draft's [start, end] span exactly as the grid will after save:
    // all-day spans startOfDay..endOfDay (matching mapInteractionToCalendarItem),
    // timed events use the start + computed duration (multi-day endDate included).
    const isAllDay = config.hasAllDay && form.allDay
    let start: Date
    let end: Date
    if (isAllDay) {
      const dayDate = new Date(`${form.date}T00:00:00`)
      if (Number.isNaN(dayDate.getTime())) {
        setConflict(null)
        return
      }
      start = startOfDay(dayDate)
      end = endOfDay(dayDate)
    } else {
      if (!form.startTime) {
        setConflict(null)
        return
      }
      start = new Date(`${form.date}T${form.startTime}:00`)
      if (Number.isNaN(start.getTime())) {
        setConflict(null)
        return
      }
      const durationMinutes = config.hasEnd ? computeDurationMinutes(form) ?? 30 : 30
      end = new Date(start.getTime() + durationMinutes * 60_000)
    }
    // The same padded window + recurrence expansion the grid uses, so the probe
    // sees the exact candidate set behind the grid's conflict badges/rings. The
    // window pads ±1 day around the FULL draft span so multi-day drafts still
    // catch neighbours near their end, not just their start day.
    const dayStart = startOfDay(start)
    dayStart.setDate(dayStart.getDate() - 1)
    const dayEnd = endOfDay(end)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const fetchWindow = getFetchWindow({ from: dayStart, to: dayEnd })
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(async () => {
      try {
        const { payloads } = await fetchInteractionWindow(fetchWindow, controller.signal)
        if (!active) return
        const others: CalendarItem[] = []
        for (const payload of payloads) {
          const item = mapInteractionToCalendarItem(payload, {})
          if (!item) continue
          others.push(...expandOccurrences(item, fetchWindow))
        }
        const conflictItems = findEditorConflictItems(
          {
            start,
            end,
            ownerUserId: draftOwnerUserId,
            participants: form.participants.map((participant) => ({ userId: participant.userId, name: participant.name })),
            status: form.status,
          },
          others,
          excludeId,
          { scope, currentUserId },
        )
        if (!active) return
        if (conflictItems.length === 0) {
          setConflict(null)
          return
        }
        const summary = conflictItems
          .map((item) => `${formatClock(item.start)}–${formatClock(item.end)}: ${item.title || t('customers.calendar.grid.untitled', 'Untitled')}`)
          .join(', ')
        setConflict(summary ? t('customers.calendar.editor.conflictWarning', 'Overlaps with: {items}', { items: summary }) : null)
      } catch {
        if (active) setConflict(null)
      }
    }, 500)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
    // Re-probe when schedule-relevant inputs change (time window, all-day, attendees, owner, status, scope).
  }, [open, form.date, form.startTime, form.endDate, form.endTime, form.allDay, form.status, participantsKey, config.hasAllDay, config.hasEnd, excludeId, draftOwnerUserId, scope, currentUserId, t]) // eslint-disable-line react-hooks/exhaustive-deps
  return conflict
}
