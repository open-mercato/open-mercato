"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Pipeline = { id: string; name: string; isDefault: boolean; isActive: boolean }
type Stage = { id: string; pipelineId: string; name: string; position: number; kind: string; isActive: boolean }
type Lead = {
  id: string
  displayName: string | null
  stageId: string | null
  outcome: string | null
  source: string | null
  primaryEmail: string | null
  updatedAt: string | null
}

export default function LeadPipelinePage() {
  const t = useT()
  const [pipelines, setPipelines] = React.useState<Pipeline[]>([])
  const [stages, setStages] = React.useState<Stage[]>([])
  const [pipelineId, setPipelineId] = React.useState<string>('')
  const [leads, setLeads] = React.useState<Lead[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [movingId, setMovingId] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      apiCall<{ items?: Pipeline[] }>('/api/customers/lead-pipelines'),
      apiCall<{ items?: Stage[] }>('/api/customers/lead-pipeline-stages'),
    ])
      .then(([pipelineCall, stageCall]) => {
        if (cancelled) return
        const nextPipelines = Array.isArray(pipelineCall.result?.items) ? pipelineCall.result.items : []
        setPipelines(nextPipelines)
        setStages(Array.isArray(stageCall.result?.items) ? stageCall.result.items : [])
        const active = nextPipelines.find((pipeline) => pipeline.isDefault) ?? nextPipelines[0]
        if (active) setPipelineId((current) => current || active.id)
      })
      .catch(() => {
        if (!cancelled) setError(t('customers.leads.pipeline.loadConfigError', 'Failed to load lead pipelines.'))
      })
    return () => {
      cancelled = true
    }
  }, [t])

  React.useEffect(() => {
    if (!pipelineId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ pipelineId, pageSize: '100', page: '1' })
    apiCall<{ items?: Lead[] }>(`/api/customers/leads?${params.toString()}`)
      .then((response) => {
        if (cancelled) return
        if (response.ok && response.result) {
          setLeads(Array.isArray(response.result.items) ? response.result.items : [])
          return
        }
        setError(t('customers.leads.list.loadError', 'Failed to load leads.'))
      })
      .catch(() => {
        if (!cancelled) setError(t('customers.leads.list.loadError', 'Failed to load leads.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pipelineId, reloadToken, t])

  const laneStages = React.useMemo(
    () => stages
      .filter((stage) => stage.pipelineId === pipelineId && stage.kind === 'open' && stage.isActive)
      .sort((left, right) => left.position - right.position),
    [stages, pipelineId],
  )

  const moveLead = React.useCallback(async (lead: Lead, stageId: string) => {
    setMovingId(lead.id)
    try {
      const response = await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(lead.updatedAt),
        () => apiCall('/api/customers/leads/advance-stage', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: lead.id, stageId }),
        }),
      )
      if (!response.ok) {
        flash(t('customers.leads.pipeline.moveError', 'Failed to move the lead.'), 'error')
        return
      }
      setReloadToken((token) => token + 1)
    } finally {
      setMovingId(null)
    }
  }, [t])

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button asChild>
            <Link href="/backend/customers/leads/create">{t('customers.leads.list.new', 'New lead')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/backend/customers/leads">{t('customers.leads.list.title', 'Leads')}</Link>
          </Button>
          <div className="ms-auto">
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger aria-label={t('customers.leads.form.pipeline', 'Pipeline')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pipelines.filter((pipeline) => pipeline.isActive).map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {error ? (
          <ErrorMessage label={error} />
        ) : loading ? (
          <LoadingMessage label={t('customers.leads.loading', 'Loading leads…')} />
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {laneStages.map((stage) => {
              const stageLeads = leads.filter((lead) => lead.stageId === stage.id)
              return (
                <section key={stage.id} className="min-w-72 flex-1 rounded-lg border border-border bg-muted/30 p-3">
                  <header className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-foreground">{stage.name}</h2>
                    <span className="text-xs text-muted-foreground">{stageLeads.length}</span>
                  </header>
                  <div className="space-y-2">
                    {stageLeads.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                        {t('customers.leads.pipeline.emptyLane', 'No leads in this stage.')}
                      </p>
                    ) : stageLeads.map((lead) => (
                      <article key={lead.id} className="rounded-md border border-border bg-card p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <Link
                            href={`/backend/customers/leads/${lead.id}`}
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            {lead.displayName ?? t('customers.leads.list.unnamed', 'Unnamed lead')}
                          </Link>
                          <StatusBadge variant={lead.outcome === 'lost' ? 'error' : lead.outcome === 'won' ? 'success' : 'neutral'} dot>
                            {t(`customers.leads.outcome.${lead.outcome ?? 'open'}`, lead.outcome ?? 'open')}
                          </StatusBadge>
                        </div>
                        {lead.primaryEmail ? (
                          <p className="mt-1 truncate text-xs text-muted-foreground">{lead.primaryEmail}</p>
                        ) : null}
                        <div className="mt-2">
                          <Select
                            value={stage.id}
                            disabled={movingId === lead.id}
                            onValueChange={(next) => {
                              if (next !== stage.id) void moveLead(lead, next)
                            }}
                          >
                            <SelectTrigger
                              className="h-8 text-xs"
                              aria-label={t('customers.leads.pipeline.moveLead', 'Move lead')}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {laneStages.map((option) => (
                                <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </PageBody>
    </Page>
  )
}
