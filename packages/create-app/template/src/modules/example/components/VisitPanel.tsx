"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CalendarEventTypePanelProps } from '@open-mercato/core/modules/customers/calendar-event-types'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { visitAvailabilityRequestUrl, type VisitAvailabilityResponse, type VisitAvailabilitySubject } from '../lib/visitAvailabilityClient'

type Preview = { state: 'idle' | 'pending' | 'available' | 'unavailable' | 'retry'; subjects: VisitAvailabilitySubject[]; warnings?: string[] }

export function VisitPanel({ definition, values, errors, disabled, capabilities, children }: React.PropsWithChildren<CalendarEventTypePanelProps>) {
  const t = useT()
  const url = React.useMemo(() => visitAvailabilityRequestUrl({
    ...values,
    participants: capabilities.staffEnabled && definition.behavior.fields.people !== 'none' ? values.participants : [],
    resources: capabilities.resourcesEnabled && definition.behavior.fields.resources ? values.resources : [],
  }), [values, definition.behavior.fields.people, definition.behavior.fields.resources, capabilities.resourcesEnabled, capabilities.staffEnabled])
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

  const warnings = [...new Set([
    ...(!capabilities.staffEnabled && definition.behavior.fields.people !== 'none' ? ['example.calendar.visitAvailability.staffDisabled'] : []),
    ...(!capabilities.resourcesEnabled && definition.behavior.fields.resources ? ['example.calendar.visitAvailability.resourcesDisabled'] : []),
    ...(preview.warnings ?? []),
  ])]
  const reason = preview.subjects.find((subject) => subject.status !== 'available')?.reasonKey
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
          : reason ? t(reason, t('example.calendar.visitAvailability.unavailable', 'A selected person or resource is unavailable.'))
            : t('example.calendar.visitAvailability.unavailable', 'A selected person or resource is unavailable.')

  return <div className="space-y-4" data-testid="example-visit-panel">
    {children}
    {errors.participants ? <p role="alert" className="text-sm text-status-error-text">{errors.participants}</p> : null}
    {errors.resources || errors.linkedEntities ? <p role="alert" className="text-sm text-status-error-text">{errors.resources ?? errors.linkedEntities}</p> : null}
    {warnings.length ? <Alert status="warning" data-testid="example-visit-optional-modules-warning">
      <AlertTitle>{t('example.calendar.visitAvailability.optionalModulesTitle')}</AlertTitle>
      <AlertDescription>{warnings.map((warning) => <p key={warning}>{t(warning)}</p>)}</AlertDescription>
    </Alert> : null}
    <Alert status={preview.state === 'available' ? (warnings.length && !preview.subjects.length ? 'information' : 'success') : preview.state === 'unavailable' ? 'warning' : 'information'}>
      <AlertTitle>{t('example.calendar.visitAvailability.title', 'Visit availability')}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      {preview.state === 'retry' ? <Button type="button" variant="outline" disabled={disabled}
        onClick={() => setRetry((value) => value + 1)}>{t('example.calendar.visitAvailability.retryAction', 'Retry availability')}</Button> : null}
    </Alert>
  </div>
}
