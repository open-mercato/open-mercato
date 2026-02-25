"use client"

import * as React from 'react'
import { z } from 'zod'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useInjectedMenuItems } from '@open-mercato/ui/backend/injection/useInjectedMenuItems'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'

function print(value: unknown) {
  return JSON.stringify(value ?? null)
}

type CustomerRecord = {
  id?: string
  firstName?: string
  lastName?: string
  displayName?: string
  _example?: {
    todoCount?: number
    openTodoCount?: number
  }
}

type CustomersResponse = {
  items?: CustomerRecord[]
  data?: CustomerRecord[]
  _meta?: {
    enrichedBy?: string[]
    enricherErrors?: string[]
  }
}

function readCustomerItems(payload: CustomersResponse | null): CustomerRecord[] {
  if (!payload) return []
  if (Array.isArray(payload.items)) return payload.items
  if (Array.isArray(payload.data)) return payload.data
  return []
}

export default function UmesHandlersPage() {
  const t = useT()
  const schema = React.useMemo(
    () => z.object({
      title: z.string().min(1, t('example.umes.handlers.validation.titleRequired')),
      note: z.string().optional(),
    }),
    [t],
  )
  const [submittedData, setSubmittedData] = React.useState<unknown>(null)
  const [appEventResult, setAppEventResult] = React.useState<unknown>(null)
  const [serverEmitStatus, setServerEmitStatus] = React.useState<'idle' | 'pending' | 'ok' | 'error'>('idle')
  const [serverEmitError, setServerEmitError] = React.useState<string | null>(null)
  const [draftTitle, setDraftTitle] = React.useState('display me')
  const [personId, setPersonId] = React.useState('')
  const [probeTodoTitle, setProbeTodoTitle] = React.useState('UMES enricher probe')
  const [enricherProbeStatus, setEnricherProbeStatus] = React.useState<'idle' | 'pending' | 'ok' | 'error'>('idle')
  const [enricherProbeError, setEnricherProbeError] = React.useState<string | null>(null)
  const [enricherProbeResult, setEnricherProbeResult] = React.useState<unknown>(null)
  const { items: sidebarMenuItems, isLoading: sidebarMenuLoading } = useInjectedMenuItems('menu:sidebar:main')
  const { items: profileMenuItems, isLoading: profileMenuLoading } = useInjectedMenuItems('menu:topbar:profile-dropdown')

  useAppEvent('example.todo.*', (event) => {
    setAppEventResult(event)
  }, [])

  const dispatchMockEvent = React.useCallback(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('om:event', {
        detail: {
          id: 'example.todo.created',
          payload: { title: draftTitle },
          timestamp: Date.now(),
          organizationId: 'demo-org',
        },
      }),
    )
  }, [draftTitle])

  const emitServerTodoCreated = React.useCallback(async () => {
    setServerEmitStatus('pending')
    setServerEmitError(null)
    try {
      const title = draftTitle.trim().length > 0 ? draftTitle.trim() : `SSE Test ${Date.now()}`
      await readApiResultOrThrow<{ id: string }>(
        '/api/example/todos',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        },
        { allowNullResult: true },
      )
      setServerEmitStatus('ok')
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t('example.umes.handlers.emitServer.error')
      setServerEmitError(message)
      setServerEmitStatus('error')
    }
  }, [draftTitle, t])

  const runEnricherProbe = React.useCallback(async () => {
    setEnricherProbeStatus('pending')
    setEnricherProbeError(null)
    setEnricherProbeResult(null)
    try {
      const title = probeTodoTitle.trim()
      if (title.length > 0) {
        await apiCallOrThrow('/api/example/todos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        })
      }

      const params = new URLSearchParams()
      params.set('pageSize', '5')
      if (personId.trim().length > 0) {
        params.set('id', personId.trim())
      }
      const payload = await readApiResultOrThrow<CustomersResponse>(`/api/customers/people?${params.toString()}`)
      const items = readCustomerItems(payload)
      const selected = personId.trim().length > 0
        ? items.find((item) => item.id === personId.trim()) ?? null
        : items[0] ?? null

      setEnricherProbeResult({
        selectedRecord: selected,
        meta: payload?._meta ?? null,
        inspectedCount: items.length,
      })
      setEnricherProbeStatus('ok')
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t('example.umes.handlers.enricher.error')
      setEnricherProbeError(message)
      setEnricherProbeStatus('error')
    }
  }, [personId, probeTodoTitle, t])

  const phaseASidebarItems = React.useMemo(
    () => sidebarMenuItems.filter((item) => item.id.startsWith('example-')),
    [sidebarMenuItems],
  )
  const phaseBProfileItems = React.useMemo(
    () => profileMenuItems.filter((item) => item.id.startsWith('example-')),
    [profileMenuItems],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'title',
        label: t('example.umes.handlers.fields.title'),
        type: 'text',
        required: true,
      },
      {
        id: 'note',
        label: t('example.umes.handlers.fields.note'),
        type: 'text',
      },
    ],
    [t],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [{ id: 'phase-c-main', title: t('example.umes.handlers.group.main'), fields: ['title', 'note'] }],
    [t],
  )

  const contentHeader = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button data-testid="phase-c-trigger-app-event" type="button" onClick={dispatchMockEvent}>
          {t('example.umes.handlers.actions.onAppEvent')}
        </Button>
        <Button data-testid="phase-c-trigger-server-event" type="button" onClick={() => void emitServerTodoCreated()}>
          {t('example.umes.handlers.actions.emitServerEvent')}
        </Button>
        <Button asChild data-testid="phase-c-link-blocked" type="button" variant="outline">
          <Link href="/backend/blocked">{t('example.umes.handlers.actions.navigateBlocked')}</Link>
        </Button>
        <Button asChild data-testid="phase-c-link-allowed" type="button" variant="outline">
          <Link href="/backend/umes-handlers?allowed=1">{t('example.umes.handlers.actions.navigateAllowed')}</Link>
        </Button>
      </div>
      <div data-testid="phase-c-server-emit-status" className="text-xs text-muted-foreground">
        serverEmitStatus={serverEmitStatus}
      </div>
      {serverEmitError ? (
        <div data-testid="phase-c-server-emit-error" className="text-xs text-destructive">
          {serverEmitError}
        </div>
      ) : null}
    </div>
  )

  return (
    <Page>
      <PageBody className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t('example.umes.handlers.page.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('example.umes.handlers.page.description')}</p>
        </div>

        <CrudForm<{ title: string; note?: string }>
          schema={schema}
          title={t('example.umes.handlers.form.title')}
          fields={fields}
          groups={groups}
          injectionSpotId="example:phase-c-handlers"
          initialValues={{ title: draftTitle, note: '  draft note  ' }}
          contentHeader={contentHeader}
          cancelHref="/backend/blocked"
          onSubmit={async (values) => {
            setDraftTitle(values.title)
            setSubmittedData(values)
          }}
        />

        <div className="grid gap-1 rounded border border-border p-4 text-xs">
          <div data-testid="phase-c-submit-result">submitResult={print(submittedData)}</div>
          <div data-testid="phase-c-app-event-result">appEventResult={print(appEventResult)}</div>
        </div>

        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-lg font-semibold">{t('example.umes.handlers.phaseAB.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('example.umes.handlers.phaseAB.description')}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('example.umes.handlers.phaseAB.sidebar')}</div>
              <div data-testid="phase-ab-sidebar-items" className="text-xs text-muted-foreground">
                {sidebarMenuLoading ? t('example.umes.handlers.phaseAB.loading') : print(phaseASidebarItems)}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('example.umes.handlers.phaseAB.profile')}</div>
              <div data-testid="phase-ab-profile-items" className="text-xs text-muted-foreground">
                {profileMenuLoading ? t('example.umes.handlers.phaseAB.loading') : print(phaseBProfileItems)}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild type="button" variant="outline">
              <Link href="/backend">{t('example.umes.handlers.phaseAB.openBackend')}</Link>
            </Button>
            <Button asChild type="button" variant="outline">
              <Link href="/backend/todos">{t('example.umes.handlers.phaseAB.openTodos')}</Link>
            </Button>
            <Button asChild type="button" variant="outline">
              <Link href="/backend/todos/create">{t('example.umes.handlers.phaseAB.openTodoCreate')}</Link>
            </Button>
          </div>
        </div>

        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-lg font-semibold">{t('example.umes.handlers.phaseD.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('example.umes.handlers.phaseD.description')}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span>{t('example.umes.handlers.phaseD.fields.personId')}</span>
              <input
                data-testid="phase-d-person-id"
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
                className="h-9 rounded border border-input bg-background px-3 text-sm"
                placeholder={t('example.umes.handlers.phaseD.fields.personIdPlaceholder')}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t('example.umes.handlers.phaseD.fields.probeTodoTitle')}</span>
              <input
                data-testid="phase-d-probe-title"
                value={probeTodoTitle}
                onChange={(event) => setProbeTodoTitle(event.target.value)}
                className="h-9 rounded border border-input bg-background px-3 text-sm"
                placeholder={t('example.umes.handlers.phaseD.fields.probeTodoTitlePlaceholder')}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button data-testid="phase-d-run-probe" type="button" onClick={() => void runEnricherProbe()}>
              {t('example.umes.handlers.phaseD.actions.runProbe')}
            </Button>
            <Button asChild type="button" variant="outline">
              <Link href="/backend/customers/people">{t('example.umes.handlers.phaseD.actions.openPeople')}</Link>
            </Button>
          </div>
          <div data-testid="phase-d-status" className="text-xs text-muted-foreground">
            enricherProbeStatus={enricherProbeStatus}
          </div>
          {enricherProbeError ? (
            <div data-testid="phase-d-error" className="text-xs text-destructive">
              {enricherProbeError}
            </div>
          ) : null}
          <div data-testid="phase-d-result" className="text-xs text-muted-foreground">
            enricherProbeResult={print(enricherProbeResult)}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
