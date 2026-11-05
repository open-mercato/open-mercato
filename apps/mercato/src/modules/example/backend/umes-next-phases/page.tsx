'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useNotificationEffect } from '@open-mercato/ui/backend/notifications'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

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

export default function UmesNextPhasesPage() {
  const t = useT()
  const [emitStatus, setEmitStatus] = React.useState<'idle' | 'pending' | 'ok' | 'error'>('idle')
  const [emitError, setEmitError] = React.useState<string | null>(null)
  const [emittedNotificationId, setEmittedNotificationId] = React.useState<string | null>(null)
  const [handledNotificationIds, setHandledNotificationIds] = React.useState<string[]>([])
  const [idsInput, setIdsInput] = React.useState('')
  const [probeStatus, setProbeStatus] = React.useState<'idle' | 'pending' | 'ok' | 'error'>('idle')
  const [probeError, setProbeError] = React.useState<string | null>(null)
  const [probePayload, setProbePayload] = React.useState<CustomersResponse | null>(null)
  const [progressStatus, setProgressStatus] = React.useState<'idle' | 'running' | 'ok' | 'error'>('idle')
  const [progressError, setProgressError] = React.useState<string | null>(null)
  const [progressJobId, setProgressJobId] = React.useState<string | null>(null)
  const [progressPercent, setProgressPercent] = React.useState(0)
  const [progressSseEvents, setProgressSseEvents] = React.useState(0)
  const idsInputRef = React.useRef<HTMLInputElement | null>(null)
  const progressTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const progressTickInFlightRef = React.useRef(false)
  const progressStepRef = React.useRef(0)
  const progressJobIdRef = React.useRef<string | null>(null)

  const stopProgressTimer = React.useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }
  }, [])

  const clearProgressDemo = React.useCallback(async () => {
    stopProgressTimer()
    progressTickInFlightRef.current = false
    progressStepRef.current = 0
    const existingJobId = progressJobIdRef.current
    progressJobIdRef.current = null
    if (existingJobId) {
      await readApiResultOrThrow(`/api/progress/jobs/${existingJobId}`, { method: 'DELETE' }).catch(() => undefined)
    }
  }, [stopProgressTimer])

  useNotificationEffect(
    'example.umes.actionable',
    (notification) => {
      setHandledNotificationIds((prev) => [notification.id, ...prev.filter((id) => id !== notification.id)].slice(0, 5))
    },
    [],
  )

  useAppEvent(
    'progress.job.updated',
    (event) => {
      const payload = event.payload as { jobId?: unknown; progressPercent?: unknown }
      if (payload.jobId !== progressJobIdRef.current) return
      setProgressSseEvents((prev) => prev + 1)
      if (typeof payload.progressPercent === 'number') {
        setProgressPercent(payload.progressPercent)
      }
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
      const currentIdsInput = idsInputRef.current?.value ?? idsInput
      const ids = parseIds(currentIdsInput)
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

  const startProgressDemo = React.useCallback(async () => {
    if (progressStatus === 'running') return

    const totalSteps = 10
    await clearProgressDemo()
    setProgressStatus('running')
    setProgressError(null)
    setProgressJobId(null)
    setProgressPercent(0)
    setProgressSseEvents(0)

    try {
      const created = await readApiResultOrThrow<{ id: string }>('/api/progress/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobType: 'example.umes.next.progress-demo',
          name: t('example.umes.next.progress.demoJobName'),
          description: t('example.umes.next.progress.demoJobDescription'),
          totalCount: totalSteps,
          cancellable: true,
        }),
      })

      progressJobIdRef.current = created.id
      setProgressJobId(created.id)

      progressTimerRef.current = setInterval(() => {
        if (progressTickInFlightRef.current) return
        const currentJobId = progressJobIdRef.current
        if (!currentJobId) return

        progressTickInFlightRef.current = true
        void (async () => {
          try {
            const nextStep = Math.min(progressStepRef.current + 1, totalSteps)
            progressStepRef.current = nextStep
            const nextPercent = Math.round((nextStep / totalSteps) * 100)
            setProgressPercent(nextPercent)

            await readApiResultOrThrow(`/api/progress/jobs/${currentJobId}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                processedCount: nextStep,
                totalCount: totalSteps,
                progressPercent: nextPercent,
                etaSeconds: Math.max(0, totalSteps - nextStep),
              }),
            })

            if (nextStep >= totalSteps) {
              stopProgressTimer()
              await readApiResultOrThrow(`/api/progress/jobs/${currentJobId}`, {
                method: 'DELETE',
              }).catch(() => undefined)
              progressJobIdRef.current = null
              setProgressStatus('ok')
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : t('example.umes.next.progress.simulateError')
            setProgressError(message)
            setProgressStatus('error')
            await clearProgressDemo()
          } finally {
            progressTickInFlightRef.current = false
          }
        })()
      }, 650)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('example.umes.next.progress.simulateError')
      setProgressError(message)
      setProgressStatus('error')
      await clearProgressDemo()
    }
  }, [clearProgressDemo, progressStatus, stopProgressTimer, t])

  React.useEffect(() => {
    return () => {
      void clearProgressDemo()
    }
  }, [clearProgressDemo])

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

  return (
    <Page>
      <PageBody className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t('example.umes.next.page.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('example.umes.next.page.description')}</p>
        </div>

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

        <div className="space-y-3 rounded border border-border p-4">
          <h2 className="text-lg font-semibold">{t('example.umes.next.probe.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('example.umes.next.probe.description')}</p>
          <label className="grid gap-1 text-sm">
            <span>{t('example.umes.next.probe.idsLabel')}</span>
            <input
              data-testid="phase-next-ids-input"
              ref={idsInputRef}
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

        <div className="space-y-3 rounded border border-border p-4">
          <h2 className="text-lg font-semibold">{t('example.umes.next.progress.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('example.umes.next.progress.description')}</p>
          <div className="flex flex-wrap gap-2">
            <Button data-testid="phase-next-progress-simulate" type="button" onClick={() => void startProgressDemo()}>
              {t('example.umes.next.progress.simulate')}
            </Button>
          </div>
          <div data-testid="phase-next-progress-status" className="text-xs text-muted-foreground">
            {t('example.umes.next.progress.statusLine', {
              status: progressStatus,
              jobId: progressJobId ?? t('common.none'),
              percent: progressPercent,
              events: progressSseEvents,
            })}
          </div>
          {progressError ? (
            <div data-testid="phase-next-progress-error" className="text-xs text-destructive">
              {progressError}
            </div>
          ) : null}
        </div>
      </PageBody>
    </Page>
  )
}
