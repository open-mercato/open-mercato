"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CalendarEventTypePanelProps } from '@open-mercato/core/modules/customers/calendar-event-types'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { visitAvailabilityRequestUrl, visitAvailabilitySubjectMessage, type VisitAvailabilityResponse, type VisitAvailabilitySubject } from '../lib/visitAvailabilityClient'

type Preview = { state: 'idle' | 'pending' | 'available' | 'unavailable' | 'retry'; subjects: VisitAvailabilitySubject[]; warnings?: string[] }

export type VisitPanelProps = React.PropsWithChildren<CalendarEventTypePanelProps> & {
  /**
   * Shown on every other event type that can book staff or resources. The same
   * preview, but informational: it appears only once someone or something is
   * selected for a timed interval, and saving is not blocked by it.
   */
  advisory?: boolean
}

function advisoryStaff(values: CalendarEventTypePanelProps['values'], people: string): unknown {
  if (people !== 'assignee') return values.participants
  return typeof values.assigneeUserId === 'string' && values.assigneeUserId
    ? [{ userId: values.assigneeUserId, name: values.assigneeName }]
    : []
}

function hasBookableSubject(participants: unknown, resources: unknown): boolean {
  const staffSelected = Array.isArray(participants) && participants.some((entry) =>
    entry !== null && typeof entry === 'object' && !(entry as { isCustomer?: unknown }).isCustomer
    && typeof (entry as { userId?: unknown }).userId === 'string')
  const resourceSelected = Array.isArray(resources) && resources.some((entry) =>
    entry !== null && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string')
  return staffSelected || resourceSelected
}

export function VisitPanel({ definition, values, errors, disabled, capabilities, advisory = false, children }: VisitPanelProps) {
  const t = useT()
  const fields = definition.behavior.fields
  // The staff the preview actually asks about. An assignee-only type books its
  // assignee, who is not one of `values.participants`, so the reported subjects
  // are resolved against this list rather than the raw form value.
  const checkedParticipants = React.useMemo(
    () => (advisory ? advisoryStaff(values, fields.people) : values.participants),
    [advisory, values, fields.people],
  )
  const url = React.useMemo(() => {
    const participants = capabilities.staffEnabled && fields.people !== 'none' ? checkedParticipants : []
    const resources = capabilities.resourcesEnabled && fields.resources ? values.resources : []
    if (advisory && (!fields.endTime || values.allDay === true || !hasBookableSubject(participants, resources))) return null
    return visitAvailabilityRequestUrl({ ...values, participants, resources })
  }, [values, checkedParticipants, advisory, fields.people, fields.resources, fields.endTime, capabilities.resourcesEnabled, capabilities.staffEnabled])
  const [preview, setPreview] = React.useState<Preview>({ state: 'idle', subjects: [] })
  const [retry, setRetry] = React.useState(0)

  React.useEffect(() => {
    if (!url) { setPreview({ state: 'idle', subjects: [] }); return }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setPreview({ state: 'pending', subjects: [] })
      void apiCall<VisitAvailabilityResponse>(url, { signal: controller.signal }).then(({ ok, result }) => {
        if (controller.signal.aborted) return
        if (!ok || !result || !Array.isArray(result.subjects)) { setPreview({ state: 'retry', subjects: [] }); return }
        const subjects = result.subjects.filter((subject) => subject &&
          ['available', 'unavailable', 'unknown'].includes(subject.status))
        setPreview({ state: subjects.every((subject) => subject.status === 'available') ? 'available' : 'unavailable', subjects,
          warnings: Array.isArray(result.warnings) ? result.warnings.filter((warning): warning is string => typeof warning === 'string') : [] })
      }).catch(() => { if (!controller.signal.aborted) setPreview({ state: 'retry', subjects: [] }) })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [url, retry])

  // Children stay at the same position in both modes, so switching event types
  // or revealing the alert never remounts the standard fields.
  if (advisory && (!url || preview.state === 'idle')) {
    return <div className="space-y-4">{children}</div>
  }

  // The server's warnings say why nothing could be evaluated — a disabled planner
  // leaves the subject list empty, which on its own reads as "available". They
  // belong in both modes. The capability warnings name fields this type requires
  // and an optional module does not provide, which only the Visit panel owns.
  const warnings = [...new Set([
    ...(advisory ? [] : [
      ...(!capabilities.staffEnabled && fields.people !== 'none' ? ['example.calendar.visitAvailability.staffDisabled'] : []),
      ...(!capabilities.resourcesEnabled && fields.resources ? ['example.calendar.visitAvailability.resourcesDisabled'] : []),
    ]),
    ...(preview.warnings ?? []),
  ])]
  const blocked = preview.subjects.filter((subject) => subject.status !== 'available')
  const description = preview.state === 'idle'
    ? t('example.calendar.visitAvailability.invalidInterval', 'Choose a valid visit start and end time.')
    : preview.state === 'pending'
      ? t('example.calendar.visitAvailability.pending', 'Checking availability…')
      : preview.state === 'available' && !preview.subjects.length && warnings.length
        ? t('example.calendar.visitAvailability.skipped')
        : preview.state === 'available'
        ? t('example.calendar.visitAvailability.available', 'Selected staff and resources are available.')
        : preview.state === 'retry'
          ? t('example.calendar.visitAvailability.retry', 'Availability could not be checked. Try again.')
          : t('example.calendar.visitAvailability.unavailable', 'A selected person or resource is unavailable.')

  return <div className="space-y-4" data-testid={advisory ? 'example-availability-panel' : 'example-visit-panel'}>
    {children}
    {errors.participants ? <p role="alert" className="text-sm text-status-error-text">{errors.participants}</p> : null}
    {errors.resources || errors.linkedEntities ? <p role="alert" className="text-sm text-status-error-text">{errors.resources ?? errors.linkedEntities}</p> : null}
    {warnings.length ? <Alert status="warning" data-testid="example-visit-optional-modules-warning">
      <AlertTitle>{t('example.calendar.visitAvailability.optionalModulesTitle')}</AlertTitle>
      <AlertDescription>{warnings.map((warning) => <p key={warning}>{t(warning)}</p>)}</AlertDescription>
    </Alert> : null}
    <Alert status={preview.state === 'available' ? (warnings.length && !preview.subjects.length ? 'information' : 'success') : preview.state === 'unavailable' ? 'warning' : 'information'}>
      <AlertTitle>{advisory
        ? t('example.calendar.availability.title', 'Availability')
        : t('example.calendar.visitAvailability.title', 'Visit availability')}</AlertTitle>
      <AlertDescription>
        {description}
        {blocked.length ? <ul className="mt-2 list-disc space-y-1 pl-5" data-testid="example-visit-unavailable-subjects">
          {blocked.map((subject) => <li key={`${subject.type}:${subject.id}`}>{visitAvailabilitySubjectMessage(subject, { ...values, participants: checkedParticipants }, t)}</li>)}
        </ul> : null}
      </AlertDescription>
      {preview.state === 'retry' ? <Button type="button" variant="outline" disabled={disabled}
        onClick={() => setRetry((value) => value + 1)}>{t('example.calendar.visitAvailability.retryAction', 'Retry availability')}</Button> : null}
    </Alert>
  </div>
}
