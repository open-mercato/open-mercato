'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useNotificationEffect } from '@open-mercato/ui/backend/notifications'

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
      </PageBody>
    </Page>
  )
}
