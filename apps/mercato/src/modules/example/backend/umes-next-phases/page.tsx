'use client'

import * as React from 'react'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useNotificationEffect } from '@open-mercato/ui/backend/notifications'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'

type CustomerRecord = {
  id?: string
  display_name?: string
  _example?: {
    todoCount?: number
    openTodoCount?: number
    priority?: string
  }
}

type CustomersResponse = {
  items?: CustomerRecord[]
  _meta?: {
    enrichedBy?: string[]
    enricherErrors?: string[]
  }
}

function parseIds(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function print(value: unknown) {
  return JSON.stringify(value ?? null)
}

export default function UmesNextPhasesPage() {
  const t = useT()

  // --- Notifications state ---
  const [emitStatus, setEmitStatus] = React.useState<'idle' | 'pending' | 'ok' | 'error'>('idle')
  const [emitError, setEmitError] = React.useState<string | null>(null)
  const [emittedNotificationId, setEmittedNotificationId] = React.useState<string | null>(null)
  const [handledNotificationIds, setHandledNotificationIds] = React.useState<string[]>([])

  // --- Multi-ID probe state ---
  const [idsInput, setIdsInput] = React.useState('')
  const [probeStatus, setProbeStatus] = React.useState<'idle' | 'pending' | 'ok' | 'error'>('idle')
  const [probeError, setProbeError] = React.useState<string | null>(null)
  const [probePayload, setProbePayload] = React.useState<CustomersResponse | null>(null)

  // --- Phase J recursive widget state ---
  const [submittedData, setSubmittedData] = React.useState<unknown>(null)
  const [addonDetected, setAddonDetected] = React.useState(false)

  useNotificationEffect(
    'example.umes.actionable',
    (notification) => {
      setHandledNotificationIds((prev) => [notification.id, ...prev.filter((id) => id !== notification.id)].slice(0, 5))
    },
    [],
  )

  const emitNotification = React.useCallback(async () => {
    setEmitStatus('pending')
    setEmitError(null)
    try {
      const payload = await readApiResultOrThrow<{ id: string }>('/api/example/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ linkHref: '/backend/umes-next-phases?allowed=1' }),
      })
      setEmittedNotificationId(payload.id)
      setEmitStatus('ok')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('example.umes.next.notifications.emitError')
      setEmitError(message)
      setEmitStatus('error')
    }
  }, [t])

  const loadSampleIds = React.useCallback(async () => {
    setProbeStatus('pending')
    setProbeError(null)
    try {
      const payload = await readApiResultOrThrow<CustomersResponse>('/api/customers/people?page=1&pageSize=5')
      const ids = (payload.items ?? [])
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .slice(0, 2)
      setIdsInput(ids.join(','))
      setProbeStatus('idle')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('example.umes.next.probe.loadIdsError')
      setProbeError(message)
      setProbeStatus('error')
    }
  }, [t])

  const runMultiIdProbe = React.useCallback(async () => {
    setProbeStatus('pending')
    setProbeError(null)
    setProbePayload(null)

    try {
      const ids = parseIds(idsInput)
      if (ids.length === 0) {
        throw new Error(t('example.umes.next.probe.idsRequired'))
      }

      const params = new URLSearchParams()
      params.set('ids', ids.join(','))
      params.set('pageSize', '50')
      const payload = await readApiResultOrThrow<CustomersResponse>(`/api/customers/people?${params.toString()}`)
      setProbePayload(payload)
      setProbeStatus('ok')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('example.umes.next.probe.runError')
      setProbeError(message)
      setProbeStatus('error')
    }
  }, [idsInput, t])

  const probeSummary = React.useMemo(() => {
    const items = probePayload?.items ?? []
    const enrichedBy = probePayload?._meta?.enrichedBy ?? []
    const allHaveExampleNamespace = items.length > 0 && items.every((item) => item._example != null)
    return {
      count: items.length,
      enrichedBy,
      allHaveExampleNamespace,
    }
  }, [probePayload])

  // --- Phase J CrudForm ---
  const schema = React.useMemo(
    () => z.object({
      title: z.string().min(1, t('example.umes.handlers.validation.titleRequired')),
      note: z.string().optional(),
    }),
    [t],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'title', label: t('example.umes.handlers.fields.title'), type: 'text', required: true },
      { id: 'note', label: t('example.umes.handlers.fields.note'), type: 'text' },
    ],
    [t],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [{ id: 'phase-j-main', title: t('example.umes.next.form.group'), fields: ['title', 'note'] }],
    [t],
  )

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const check = () => {
      setAddonDetected(Boolean(document.querySelector('[data-testid="recursive-widget-addon"]')))
    }
    check()
    const interval = window.setInterval(check, 500)
    return () => { window.clearInterval(interval) }
  }, [])

  const phaseJOk = addonDetected
  const phaseRows = React.useMemo(
    () => [
      {
        id: 'J',
        ok: phaseJOk,
        label: t('example.umes.next.phaseJ.label'),
        signal: { addonDetected },
      },
    ],
    [phaseJOk, addonDetected, t],
  )

  return (
    <Page>
      <PageBody className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t('example.umes.next.page.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('example.umes.next.page.description')}</p>
        </div>

        {/* --- Notifications section --- */}
        <div className="space-y-3 rounded border border-border p-4">
          <h2 className="text-lg font-semibold">{t('example.umes.next.notifications.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('example.umes.next.notifications.description')}</p>
          <div className="flex flex-wrap gap-2">
            <Button data-testid="phase-next-emit-notification" type="button" onClick={() => void emitNotification()}>
              {t('example.umes.next.notifications.emitActionable')}
            </Button>
          </div>
          <div data-testid="phase-next-emit-status" className="text-xs text-muted-foreground">
            emitStatus={emitStatus}; emittedId={emittedNotificationId ?? 'none'}
          </div>
          {emitError ? (
            <div data-testid="phase-next-emit-error" className="text-xs text-destructive">
              {emitError}
            </div>
          ) : null}
          <div data-testid="phase-next-handled-notifications" className="text-xs text-muted-foreground">
            handledNotificationIds={JSON.stringify(handledNotificationIds)}
          </div>
        </div>

        {/* --- Multi-ID probe section --- */}
        <div className="space-y-3 rounded border border-border p-4">
          <h2 className="text-lg font-semibold">{t('example.umes.next.probe.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('example.umes.next.probe.description')}</p>
          <label className="grid gap-1 text-sm">
            <span>{t('example.umes.next.probe.idsLabel')}</span>
            <input
              data-testid="phase-next-ids-input"
              value={idsInput}
              onChange={(event) => setIdsInput(event.target.value)}
              className="h-9 rounded border border-input bg-background px-3 text-sm"
              placeholder={t('example.umes.next.probe.idsPlaceholder')}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button data-testid="phase-next-load-ids" type="button" variant="outline" onClick={() => void loadSampleIds()}>
              {t('example.umes.next.probe.loadSampleIds')}
            </Button>
            <Button data-testid="phase-next-run-probe" type="button" onClick={() => void runMultiIdProbe()}>
              {t('example.umes.next.probe.run')}
            </Button>
          </div>
          <div data-testid="phase-next-probe-status" className="text-xs text-muted-foreground">
            probeStatus={probeStatus}; summary={JSON.stringify(probeSummary)}
          </div>
          {probeError ? (
            <div data-testid="phase-next-probe-error" className="text-xs text-destructive">
              {probeError}
            </div>
          ) : null}
          <div data-testid="phase-next-probe-payload" className="text-xs text-muted-foreground">
            payload={JSON.stringify(probePayload)}
          </div>
        </div>

        {/* --- Phase J: Recursive Widget Readiness --- */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-lg font-semibold">{t('example.umes.next.readiness.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('example.umes.next.readiness.description')}</p>
          </div>
          <div className="grid gap-2">
            {phaseRows.map((row) => (
              <div key={row.id} className="grid gap-2 rounded border border-border p-3 md:grid-cols-[120px_120px_1fr]">
                <div className="text-sm font-medium">
                  {row.id}: {row.label}
                </div>
                <div
                  data-testid={`phase-status-${row.id.toLowerCase()}`}
                  className={row.ok ? 'text-sm text-green-700' : 'text-sm text-amber-700'}
                >
                  {row.ok ? t('example.umes.handlers.phaseAD.status.ok') : t('example.umes.handlers.phaseAD.status.missing')}
                </div>
                <div className="text-xs text-muted-foreground">
                  signal={print(row.signal)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* --- Phase J: Recursive Widget InjectionSpot demo --- */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-lg font-semibold">{t('example.umes.next.recursive.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('example.umes.next.recursive.description')}</p>
          </div>
          <div data-testid="phase-j-standalone-spot" className="rounded border border-dashed border-border p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              {t('example.umes.next.recursive.spotLabel')} widget:example.injection.crud-validation:addon
            </div>
            <InjectionSpot
              spotId="example:phase-j-recursive"
              context={{}}
              data={{}}
            />
          </div>
        </div>

        {/* --- Phase J: CrudForm with recursive injection --- */}
        <CrudForm<{ title: string; note?: string }>
          schema={schema}
          title={t('example.umes.next.form.title')}
          fields={fields}
          groups={groups}
          injectionSpotId="example:phase-j-recursive"
          initialValues={{ title: 'recursive widget test', note: '' }}
          cancelHref="/backend/umes-handlers"
          onSubmit={async (values) => {
            setSubmittedData(values)
          }}
        />

        <div className="grid gap-1 rounded border border-border p-4 text-xs">
          <div data-testid="phase-j-submit-result">submitResult={print(submittedData)}</div>
        </div>
      </PageBody>
    </Page>
  )
}
