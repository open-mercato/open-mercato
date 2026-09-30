"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CalendarEventTypePanelProps } from '@open-mercato/core/modules/customers/calendar-event-types'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { visitAvailabilityRequestUrl, type VisitAvailabilityResponse, type VisitAvailabilitySubject } from '../lib/visitAvailabilityClient'

type Preview = { state: 'idle' | 'pending' | 'available' | 'unavailable' | 'retry'; subjects: VisitAvailabilitySubject[]; warnings?: string[] }
type Choice = { id: string; label: string; isCustomer?: boolean; email?: string }

function rowsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : []
}

async function loadPeople(query: string, staffEnabled: boolean): Promise<Choice[]> {
  const search = new URLSearchParams({ page: '1', pageSize: '20', search: query })
  const [staff, contacts] = await Promise.all([
    staffEnabled
      ? readApiResultOrThrow<{ items?: Record<string, unknown>[] }>(`/api/staff/team-members/assignable?${search}`)
      : Promise.resolve({ items: [] }),
    readApiResultOrThrow<{ items?: Record<string, unknown>[] }>(`/api/customers/people?${search}`),
  ])
  return [
    ...rowsOf(staff.items).flatMap((row): Choice[] => {
      const id = row.userId ?? row.user_id
      return typeof id === 'string' ? [{ id, label: String(row.displayName ?? row.display_name ?? row.email ?? id),
        ...(typeof row.email === 'string' ? { email: row.email } : {}) }] : []
    }),
    ...rowsOf(contacts.items).flatMap((row): Choice[] =>
      typeof row.id === 'string' ? [{ id: row.id, label: String(row.displayName ?? row.name ?? row.primaryEmail ?? row.id),
        isCustomer: true }] : []),
  ]
}

async function loadResources(query: string): Promise<Choice[]> {
  const search = new URLSearchParams({ page: '1', pageSize: '20', search: query, isActive: 'true' })
  const result = await readApiResultOrThrow<{ items?: Record<string, unknown>[] }>(`/api/resources/resources?${search}`)
  return rowsOf(result.items).flatMap((row): Choice[] =>
    typeof row.id === 'string' ? [{ id: row.id, label: String(row.name ?? row.id) }] : [])
}

function MultiPicker({ label, placeholder, selected, load, onAdd, onRemove, disabled, error }: {
  label: string
  placeholder: string
  selected: Choice[]
  load(query: string): Promise<Choice[]>
  onAdd(choice: Choice): void
  onRemove(id: string): void
  disabled: boolean
  error?: string
}) {
  const t = useT()
  const [choices, setChoices] = React.useState<Choice[]>([])
  const [pickerKey, setPickerKey] = React.useState(0)
  const [lookupFailed, setLookupFailed] = React.useState(false)
  const loadSuggestions = React.useCallback(async (query = ''): Promise<ComboboxOption[]> => {
    try {
      const found = await load(query)
      setChoices(found)
      setLookupFailed(false)
      return found.map((choice) => ({ value: choice.id, label: choice.label }))
    } catch {
      setLookupFailed(true)
      return []
    }
  }, [load])
  return <div className="space-y-2">
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      <ComboboxInput key={pickerKey} value="" loadSuggestions={loadSuggestions} allowCustomValues={false}
        placeholder={placeholder} disabled={disabled || selected.length >= 20} onChange={(id) => {
          const choice = choices.find((item) => item.id === id)
          if (choice && !selected.some((item) => item.id === id)) onAdd(choice)
          setPickerKey((value) => value + 1)
        }} />
    </label>
    {selected.length ? <div className="flex flex-wrap gap-2">{selected.map((choice) =>
      <span key={choice.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm">
        {choice.label}
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onRemove(choice.id)}
          aria-label={t('example.calendar.visitAvailability.removeSelection', 'Remove selection')}>×</Button>
      </span>)}</div> : null}
    {error ? <p role="alert" className="text-sm text-status-error-text">{error}</p> : null}
    {lookupFailed ? <p role="alert" className="text-sm text-status-error-text">
      {t('example.calendar.visitAvailability.lookupFailed', 'Options could not be loaded. Try the search again.')}
    </p> : null}
    {selected.length >= 20 ? <p className="text-sm text-muted-foreground">
      {t('example.calendar.visitAvailability.selectionLimit', 'Choose at most 20.')}
    </p> : null}
  </div>
}

export function VisitPanel({ definition, values, errors, disabled, capabilities, setValue }: CalendarEventTypePanelProps) {
  const t = useT()
  const url = React.useMemo(() => visitAvailabilityRequestUrl({
    ...values,
    participants: capabilities.staffEnabled && definition.behavior.fields.people !== 'none' ? values.participants : [],
    resources: capabilities.resourcesEnabled && definition.behavior.fields.resources ? values.resources : [],
  }), [values, definition.behavior.fields.people, definition.behavior.fields.resources, capabilities.resourcesEnabled, capabilities.staffEnabled])
  const [preview, setPreview] = React.useState<Preview>({ state: 'idle', subjects: [] })
  const [retry, setRetry] = React.useState(0)
  const people = rowsOf(values.participants)
  const resources = rowsOf(values.resources)
  const loadPeopleForPanel = React.useCallback((query: string) => loadPeople(query, capabilities.staffEnabled), [capabilities.staffEnabled])

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
  const textValue = (field: string) => typeof values[field] === 'string' ? values[field] as string : ''

  return <div className="space-y-4" data-testid="example-visit-panel">
    <div className="grid gap-3 sm:grid-cols-2">
      {(['date', 'startTime', 'endDate', 'endTime'] as const)
        .filter((field) => definition.behavior.fields.endTime || (field !== 'endDate' && field !== 'endTime'))
        .map((field) =>
        <label key={field} className="space-y-1 text-sm font-medium">
          <span>{t(`example.calendar.visitAvailability.${field}`, field)}</span>
          <Input type={field.toLowerCase().includes('date') ? 'date' : 'time'} value={textValue(field)} disabled={disabled}
            onChange={(event) => setValue(field, event.target.value)} />
        </label>)}
    </div>
    {errors.ends || errors.scheduledAt || errors.durationMinutes ? <p role="alert" className="text-sm text-status-error-text">{errors.ends ?? errors.scheduledAt ?? errors.durationMinutes}</p> : null}
    {definition.behavior.fields.location !== 'none' ? <label className="block space-y-1 text-sm font-medium">
      <span>{t('example.calendar.visitAvailability.location', 'Location')}</span>
      <Input value={textValue('location')} disabled={disabled} onChange={(event) => setValue('location', event.target.value)} />
    </label> : null}
    {definition.behavior.fields.people !== 'none' ? <MultiPicker label={t('example.calendar.visitAvailability.recipients', 'Recipients')}
      placeholder={t('example.calendar.visitAvailability.addRecipient', 'Add a recipient…')}
      selected={people.flatMap((row): Choice[] => typeof row.userId === 'string'
        ? [{ id: row.userId, label: String(row.name ?? row.userId) }] : [])}
      load={loadPeopleForPanel} disabled={disabled} error={errors.participants}
      onAdd={(choice) => setValue('participants', [...people, { userId: choice.id, name: choice.label,
        ...(choice.email ? { email: choice.email } : {}), isCustomer: choice.isCustomer === true }])}
      onRemove={(id) => setValue('participants', people.filter((row) => row.userId !== id))} /> : null}
    {capabilities.resourcesEnabled && definition.behavior.fields.resources ? <MultiPicker label={t('example.calendar.visitAvailability.resources', 'Resources')}
      placeholder={t('example.calendar.visitAvailability.addResource', 'Add a resource…')}
      selected={resources.flatMap((row): Choice[] => typeof row.id === 'string'
        ? [{ id: row.id, label: String(row.label ?? row.id) }] : [])}
      load={loadResources} disabled={disabled} error={errors.resources ?? errors.linkedEntities}
      onAdd={(choice) => setValue('resources', [...resources, { id: choice.id, label: choice.label }])}
      onRemove={(id) => setValue('resources', resources.filter((row) => row.id !== id))} /> : null}
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
