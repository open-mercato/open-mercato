"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

type Pipeline = { id: string; name: string; code: string; isDefault: boolean; isActive: boolean }
type Stage = { id: string; pipelineId: string; name: string; code: string; position: number; kind: string; isActive: boolean }
type LostReason = { id: string; pipelineId: string | null; name: string; code: string; isActive: boolean; sortOrder: number }

export default function LeadSettingsPage() {
  const t = useT()
  const [enabled, setEnabled] = React.useState(true)
  const [pipelines, setPipelines] = React.useState<Pipeline[]>([])
  const [stages, setStages] = React.useState<Stage[]>([])
  const [reasons, setReasons] = React.useState<LostReason[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [pipelineName, setPipelineName] = React.useState('')
  const [pipelineCode, setPipelineCode] = React.useState('')
  const [stageName, setStageName] = React.useState('')
  const [stageCode, setStageCode] = React.useState('')
  const [stageKind, setStageKind] = React.useState<'open' | 'won' | 'lost'>('open')
  const [reasonName, setReasonName] = React.useState('')
  const [reasonCode, setReasonCode] = React.useState('')

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'customers-lead-settings',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      apiCall<{ leadsEnabled?: boolean }>('/api/customers/lead-settings'),
      apiCall<{ items?: Pipeline[] }>('/api/customers/lead-pipelines'),
      apiCall<{ items?: Stage[] }>('/api/customers/lead-pipeline-stages'),
      apiCall<{ items?: LostReason[] }>('/api/customers/lead-lost-reasons'),
    ])
      .then(([settingsCall, pipelineCall, stageCall, reasonCall]) => {
        if (cancelled) return
        setEnabled(settingsCall.result?.leadsEnabled ?? true)
        const nextPipelines = Array.isArray(pipelineCall.result?.items) ? pipelineCall.result.items : []
        setPipelines(nextPipelines)
        setStages(Array.isArray(stageCall.result?.items) ? stageCall.result.items : [])
        setReasons(Array.isArray(reasonCall.result?.items) ? reasonCall.result.items : [])
        const preferred = nextPipelines.find((pipeline) => pipeline.isDefault) ?? nextPipelines[0]
        setSelectedPipelineId((current) => current || preferred?.id || '')
      })
      .catch((err) => {
        logger.warn('Lead settings load failed', { err })
        if (!cancelled) setError(t('customers.leads.settings.loadError', 'Failed to load lead settings.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken, t])

  const mutate = React.useCallback(async (
    operation: string,
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body: Record<string, unknown>,
  ) => {
    setBusy(true)
    try {
      await runMutation({
        operation: () => apiCallOrThrow(path, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        mutationPayload: { operation, ...body },
        context: {
          formId: 'customers-lead-settings',
          resourceKind: 'customers.lead_settings',
          resourceId: String(body.id ?? 'settings'),
          retryLastMutation,
        },
      })
      setReloadToken((token) => token + 1)
      return true
    } catch {
      flash(t('customers.leads.settings.saveError', 'Failed to save the change.'), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }, [retryLastMutation, t])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('customers.leads.settings.loading', 'Loading lead settings…')} />
        </PageBody>
      </Page>
    )
  }

  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  const pipelineStages = stages
    .filter((stage) => stage.pipelineId === selectedPipelineId)
    .sort((left, right) => left.position - right.position)
  const pipelineReasons = reasons.filter((reason) => !reason.pipelineId || reason.pipelineId === selectedPipelineId)

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{t('customers.leads.settings.title', 'Lead settings')}</h1>
          <Button asChild variant="outline" className="ms-auto">
            <Link href="/backend/customers/leads">{t('customers.leads.list.title', 'Leads')}</Link>
          </Button>
        </div>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{t('customers.leads.settings.enabled', 'Lead capability')}</h2>
              <p className="text-xs text-muted-foreground">
                {t('customers.leads.settings.enabledHint', 'When disabled, lead APIs reject requests and lead-first flows are unavailable.')}
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={busy}
              onCheckedChange={(next) => {
                setEnabled(next)
                void mutate('save-settings', '/api/customers/lead-settings', 'PUT', { leadsEnabled: next })
              }}
              aria-label={t('customers.leads.settings.enabled', 'Lead capability')}
            />
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">{t('customers.leads.settings.pipelines', 'Pipelines')}</h2>
          <ul className="mt-3 space-y-2">
            {pipelines.map((pipeline) => (
              <li key={pipeline.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span className="font-medium">{pipeline.name}</span>
                <span className="text-xs text-muted-foreground">{pipeline.code}</span>
                {pipeline.isDefault ? <span className="text-xs text-muted-foreground">default</span> : null}
                <div className="ms-auto flex gap-2">
                  {!pipeline.isDefault ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => { void mutate('default-pipeline', '/api/customers/lead-pipelines', 'PUT', { id: pipeline.id, isDefault: true }) }}
                    >
                      {t('customers.leads.settings.makeDefault', 'Make default')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => { void mutate('delete-pipeline', '/api/customers/lead-pipelines', 'DELETE', { id: pipeline.id }) }}
                  >
                    {t('customers.leads.settings.delete', 'Delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input
              value={pipelineName}
              onChange={(event) => setPipelineName(event.target.value)}
              placeholder={t('customers.leads.settings.pipelineName', 'Pipeline name')}
            />
            <Input
              value={pipelineCode}
              onChange={(event) => setPipelineCode(event.target.value)}
              placeholder={t('customers.leads.settings.pipelineCode', 'Code')}
            />
            <Button
              type="button"
              disabled={busy || !pipelineName.trim() || !pipelineCode.trim()}
              onClick={() => {
                void mutate('create-pipeline', '/api/customers/lead-pipelines', 'POST', {
                  name: pipelineName,
                  code: pipelineCode,
                }).then((ok) => {
                  if (ok) {
                    setPipelineName('')
                    setPipelineCode('')
                  }
                })
              }}
            >
              {t('customers.leads.settings.addPipeline', 'Add pipeline')}
            </Button>
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">{t('customers.leads.settings.stages', 'Stages')}</h2>
          <Select value={selectedPipelineId} onValueChange={setSelectedPipelineId}>
            <SelectTrigger className="mt-2 w-64" aria-label={t('customers.leads.form.pipeline', 'Pipeline')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((pipeline) => (
                <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ul className="mt-3 space-y-2">
            {pipelineStages.map((stage) => (
              <li key={stage.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span className="font-medium">{stage.name}</span>
                <span className="text-xs text-muted-foreground">{stage.code} · {stage.kind} · {stage.position}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ms-auto"
                  disabled={busy}
                  onClick={() => { void mutate('delete-stage', '/api/customers/lead-pipeline-stages', 'DELETE', { id: stage.id }) }}
                >
                  {t('customers.leads.settings.delete', 'Delete')}
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input
              value={stageName}
              onChange={(event) => setStageName(event.target.value)}
              placeholder={t('customers.leads.settings.stageName', 'Stage name')}
            />
            <Input
              value={stageCode}
              onChange={(event) => setStageCode(event.target.value)}
              placeholder={t('customers.leads.settings.stageCode', 'Code')}
            />
            <Select value={stageKind} onValueChange={(value) => setStageKind(value as 'open' | 'won' | 'lost')}>
              <SelectTrigger className="w-32" aria-label={t('customers.leads.settings.stageKind', 'Kind')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">open</SelectItem>
                <SelectItem value="won">won</SelectItem>
                <SelectItem value="lost">lost</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              disabled={busy || !selectedPipelineId || !stageName.trim() || !stageCode.trim()}
              onClick={() => {
                void mutate('create-stage', '/api/customers/lead-pipeline-stages', 'POST', {
                  pipelineId: selectedPipelineId,
                  name: stageName,
                  code: stageCode,
                  kind: stageKind,
                  position: pipelineStages.length,
                }).then((ok) => {
                  if (ok) {
                    setStageName('')
                    setStageCode('')
                  }
                })
              }}
            >
              {t('customers.leads.settings.addStage', 'Add stage')}
            </Button>
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">{t('customers.leads.settings.lostReasons', 'Lost reasons')}</h2>
          <ul className="mt-3 space-y-2">
            {pipelineReasons.map((reason) => (
              <li key={reason.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span className="font-medium">{reason.name}</span>
                <span className="text-xs text-muted-foreground">{reason.code}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ms-auto"
                  disabled={busy}
                  onClick={() => { void mutate('delete-reason', '/api/customers/lead-lost-reasons', 'DELETE', { id: reason.id }) }}
                >
                  {t('customers.leads.settings.delete', 'Delete')}
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input
              value={reasonName}
              onChange={(event) => setReasonName(event.target.value)}
              placeholder={t('customers.leads.settings.reasonName', 'Reason name')}
            />
            <Input
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
              placeholder={t('customers.leads.settings.reasonCode', 'Code')}
            />
            <Button
              type="button"
              disabled={busy || !reasonName.trim() || !reasonCode.trim()}
              onClick={() => {
                void mutate('create-reason', '/api/customers/lead-lost-reasons', 'POST', {
                  name: reasonName,
                  code: reasonCode,
                  pipelineId: selectedPipelineId || null,
                }).then((ok) => {
                  if (ok) {
                    setReasonName('')
                    setReasonCode('')
                  }
                })
              }}
            >
              {t('customers.leads.settings.addReason', 'Add reason')}
            </Button>
          </div>
        </section>
      </PageBody>
    </Page>
  )
}
