"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

type Lead = {
  id: string
  displayName: string | null
  pipelineId: string | null
  stageId: string | null
  outcome: string | null
  lostReasonId: string | null
  source: string | null
  sourceChannel: string | null
  primaryEmail: string | null
  primaryPhone: string | null
  vatId: string | null
  qualificationNotes: string | null
  personData: Record<string, unknown> | null
  companyData: Record<string, unknown> | null
  dealData: Record<string, unknown> | null
  createdPersonId: string | null
  createdCompanyId: string | null
  createdDealId: string | null
  linkedPersonId: string | null
  linkedCompanyId: string | null
  linkedDealId: string | null
  convertedAt: string | null
  conversionLockedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

type Stage = { id: string; pipelineId: string; name: string; position: number; kind: string; isActive: boolean }
type LostReason = { id: string; name: string; isActive: boolean; pipelineId: string | null }
type HistoryEntry = {
  id: string
  entryType: string
  message: string | null
  createdAt: string | null
}
type Option = { id: string; label: string }
type Duplicate = {
  id: string
  kind: string
  displayName: string | null
  primaryEmail: string | null
  primaryPhone: string | null
  matchedOn: string[]
}

type LeadFormValues = {
  id?: string
  updatedAt?: string
  displayName: string
  source?: string
  sourceChannel?: string
  primaryEmail?: string
  primaryPhone?: string
  vatId?: string
  qualificationNotes?: string
  personFirstName?: string
  personLastName?: string
  personJobTitle?: string
  companyName?: string
  companyIndustry?: string
  dealTitle?: string
  dealValueAmount?: string
  dealValueCurrency?: string
}

function readString(record: Record<string, unknown> | null, key: string): string {
  if (!record) return ''
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> | null {
  const entries = Object.entries(record).filter(([, value]) => (
    typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null
  ))
  return entries.length ? Object.fromEntries(entries) : null
}

function outcomeVariant(outcome: string | null): 'neutral' | 'success' | 'error' {
  if (outcome === 'won') return 'success'
  if (outcome === 'lost') return 'error'
  return 'neutral'
}

export default function LeadDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id ?? ''
  const t = useT()
  const [lead, setLead] = React.useState<Lead | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [stages, setStages] = React.useState<Stage[]>([])
  const [lostReasons, setLostReasons] = React.useState<LostReason[]>([])
  const [history, setHistory] = React.useState<HistoryEntry[]>([])
  const [people, setPeople] = React.useState<Option[]>([])
  const [companies, setCompanies] = React.useState<Option[]>([])
  const [deals, setDeals] = React.useState<Option[]>([])
  const [selectedStageId, setSelectedStageId] = React.useState('')
  const [lostReasonId, setLostReasonId] = React.useState('')
  const [lostNote, setLostNote] = React.useState('')
  const [duplicates, setDuplicates] = React.useState<Duplicate[] | null>(null)
  const [linkPersonId, setLinkPersonId] = React.useState('')
  const [linkCompanyId, setLinkCompanyId] = React.useState('')
  const [linkDealId, setLinkDealId] = React.useState('')
  const [convertPersonMode, setConvertPersonMode] = React.useState<'skip' | 'create' | 'link'>('skip')
  const [convertCompanyMode, setConvertCompanyMode] = React.useState<'skip' | 'create' | 'link'>('skip')
  const [convertDealMode, setConvertDealMode] = React.useState<'skip' | 'create' | 'link'>('skip')
  const [convertPersonId, setConvertPersonId] = React.useState('')
  const [convertCompanyId, setConvertCompanyId] = React.useState('')
  const [convertDealId, setConvertDealId] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: `customer-lead:${id || 'pending'}`,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const loadLead = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const response = await apiCall<{ items?: Lead[] }>(`/api/customers/leads?id=${encodeURIComponent(id)}`)
      if (response.status === 404) {
        setNotFound(true)
        return
      }
      if (!response.ok || !response.result) {
        setError(t('customers.leads.detail.loadError', 'Failed to load the lead.'))
        return
      }
      const found = (response.result.items ?? []).find((item) => item.id === id) ?? null
      if (!found) {
        setNotFound(true)
        return
      }
      setLead(found)
      setSelectedStageId(found.stageId ?? '')
      setLostReasonId(found.lostReasonId ?? '')
      setConvertPersonMode(found.linkedPersonId || found.createdPersonId ? 'skip' : 'create')
      setConvertCompanyMode(found.linkedCompanyId || found.createdCompanyId ? 'skip' : 'create')
      setConvertDealMode(found.linkedDealId || found.createdDealId ? 'skip' : 'create')
    } catch (err) {
      logger.warn('Lead detail load failed', { err })
      setError(t('customers.leads.detail.loadError', 'Failed to load the lead.'))
    } finally {
      setLoading(false)
    }
  }, [id, t])

  React.useEffect(() => {
    void loadLead()
  }, [loadLead, reloadToken])

  React.useEffect(() => {
    if (!lead) return
    let cancelled = false
    Promise.all([
      apiCall<{ items?: Stage[] }>('/api/customers/lead-pipeline-stages'),
      apiCall<{ items?: LostReason[] }>(`/api/customers/lead-lost-reasons?pipelineId=${encodeURIComponent(lead.pipelineId ?? '')}`),
      apiCall<{ items?: HistoryEntry[] }>(`/api/customers/leads/history?leadId=${encodeURIComponent(lead.id)}`),
      apiCall<{ items?: Array<Record<string, unknown>> }>('/api/customers/people?pageSize=100'),
      apiCall<{ items?: Array<Record<string, unknown>> }>('/api/customers/companies?pageSize=100'),
      apiCall<{ items?: Array<Record<string, unknown>> }>('/api/customers/deals?pageSize=100'),
    ])
      .then(([stageCall, reasonCall, historyCall, peopleCall, companyCall, dealCall]) => {
        if (cancelled) return
        setStages(Array.isArray(stageCall.result?.items) ? stageCall.result.items : [])
        setLostReasons(Array.isArray(reasonCall.result?.items) ? reasonCall.result.items : [])
        setHistory(Array.isArray(historyCall.result?.items) ? historyCall.result.items : [])
        setPeople((peopleCall.result?.items ?? []).map((item) => ({
          id: String(item.id ?? ''),
          label: String(item.displayName ?? item.name ?? item.id ?? ''),
        })).filter((item) => item.id))
        setCompanies((companyCall.result?.items ?? []).map((item) => ({
          id: String(item.id ?? ''),
          label: String(item.displayName ?? item.name ?? item.id ?? ''),
        })).filter((item) => item.id))
        setDeals((dealCall.result?.items ?? []).map((item) => ({
          id: String(item.id ?? ''),
          label: String(item.title ?? item.name ?? item.id ?? ''),
        })).filter((item) => item.id))
      })
      .catch(() => {
        if (!cancelled) flash(t('customers.leads.detail.configError', 'Failed to load lead configuration.'), 'error')
      })
    return () => {
      cancelled = true
    }
  }, [lead, t])

  const runAction = React.useCallback(async (label: string, path: string, body: Record<string, unknown>) => {
    if (!lead) return null
    setBusy(label)
    try {
      const result = await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(lead.updatedAt),
          () => apiCallOrThrow(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        ),
        mutationPayload: { operation: label, leadId: lead.id, ...body },
        context: {
          formId: `customer-lead:${lead.id}`,
          resourceKind: 'customers.lead',
          resourceId: lead.id,
          retryLastMutation,
        },
      })
      setReloadToken((token) => token + 1)
      return result
    } catch (err) {
      if (extractOptimisticLockConflict(err)) return null
      flash(t('customers.leads.detail.actionError', 'The action failed.'), 'error')
      return null
    } finally {
      setBusy(null)
    }
  }, [lead, retryLastMutation, t])

  const fields = React.useMemo<CrudField[]>(() => {
    if (!lead) return []
    const personData = lead.personData ?? {}
    const companyData = lead.companyData ?? {}
    const dealData = lead.dealData ?? {}
    return [
      { id: 'displayName', label: t('customers.leads.form.displayName', 'Display name'), type: 'text', required: true },
      { id: 'source', label: t('customers.leads.form.source', 'Source'), type: 'text' },
      { id: 'sourceChannel', label: t('customers.leads.form.sourceChannel', 'Source channel'), type: 'text' },
      { id: 'primaryEmail', label: t('customers.leads.form.primaryEmail', 'Email'), type: 'text' },
      { id: 'primaryPhone', label: t('customers.leads.form.primaryPhone', 'Phone'), type: 'text' },
      { id: 'vatId', label: t('customers.leads.form.vatId', 'VAT ID'), type: 'text' },
      { id: 'qualificationNotes', label: t('customers.leads.form.qualificationNotes', 'Qualification notes'), type: 'textarea' },
      { id: 'personFirstName', label: t('customers.leads.form.personFirstName', 'Contact first name'), type: 'text', defaultValue: readString(personData, 'firstName') },
      { id: 'personLastName', label: t('customers.leads.form.personLastName', 'Contact last name'), type: 'text', defaultValue: readString(personData, 'lastName') },
      { id: 'personJobTitle', label: t('customers.leads.form.personJobTitle', 'Contact job title'), type: 'text', defaultValue: readString(personData, 'jobTitle') },
      { id: 'companyName', label: t('customers.leads.form.companyName', 'Company name'), type: 'text', defaultValue: readString(companyData, 'displayName') },
      { id: 'companyIndustry', label: t('customers.leads.form.companyIndustry', 'Company industry'), type: 'text', defaultValue: readString(companyData, 'industry') },
      { id: 'dealTitle', label: t('customers.leads.form.dealTitle', 'Potential deal title'), type: 'text', defaultValue: readString(dealData, 'title') },
      { id: 'dealValueAmount', label: t('customers.leads.form.dealValueAmount', 'Potential deal value'), type: 'text', defaultValue: readString(dealData, 'valueAmount') },
      { id: 'dealValueCurrency', label: t('customers.leads.form.dealValueCurrency', 'Deal currency'), type: 'text', defaultValue: readString(dealData, 'valueCurrency') },
    ]
  }, [lead, t])

  if (!id || notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('customers.leads.detail.notFound', 'Lead not found')}
            backHref="/backend/customers/leads"
            backLabel={t('customers.leads.list.title', 'Leads')}
          />
        </PageBody>
      </Page>
    )
  }

  if (loading && !lead) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('customers.leads.loading', 'Loading leads…')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !lead) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('customers.leads.detail.loadError', 'Failed to load the lead.')} />
        </PageBody>
      </Page>
    )
  }

  const openStages = stages
    .filter((stage) => stage.pipelineId === lead.pipelineId && stage.kind === 'open' && stage.isActive)
    .sort((left, right) => left.position - right.position)
  const converted = Boolean(lead.convertedAt || lead.conversionLockedAt)
  const linkedPerson = lead.linkedPersonId ?? lead.createdPersonId
  const linkedCompany = lead.linkedCompanyId ?? lead.createdCompanyId
  const linkedDeal = lead.linkedDealId ?? lead.createdDealId

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{lead.displayName}</h1>
            <p className="text-sm text-muted-foreground">
              {formatDateTime(lead.createdAt) ?? ''}
            </p>
          </div>
          <StatusBadge variant={outcomeVariant(lead.outcome)} dot>
            {t(`customers.leads.outcome.${lead.outcome ?? 'open'}`, lead.outcome ?? 'open')}
          </StatusBadge>
          <div className="ms-auto flex gap-2">
            <Button asChild variant="outline">
              <Link href="/backend/customers/leads">{t('customers.leads.list.title', 'Leads')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/backend/customers/leads/pipeline">{t('customers.leads.pipeline.title', 'Pipeline board')}</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <CrudForm<LeadFormValues>
              title={t('customers.leads.detail.editTitle', 'Lead details')}
              titleHeadingLevel={2}
              embedded
              fields={fields}
              initialValues={{
                id: lead.id,
                updatedAt: lead.updatedAt ?? undefined,
                displayName: lead.displayName ?? '',
                source: lead.source ?? '',
                sourceChannel: lead.sourceChannel ?? '',
                primaryEmail: lead.primaryEmail ?? '',
                primaryPhone: lead.primaryPhone ?? '',
                vatId: lead.vatId ?? '',
                qualificationNotes: lead.qualificationNotes ?? '',
              }}
              submitLabel={t('customers.leads.form.save', 'Save')}
              onSubmit={async (values) => {
                await updateCrud('customers/leads', {
                  id: lead.id,
                  displayName: values.displayName,
                  source: values.source,
                  sourceChannel: values.sourceChannel,
                  primaryEmail: values.primaryEmail,
                  primaryPhone: values.primaryPhone,
                  vatId: values.vatId,
                  qualificationNotes: values.qualificationNotes,
                  personData: compactRecord({
                    firstName: values.personFirstName,
                    lastName: values.personLastName,
                    jobTitle: values.personJobTitle,
                  }),
                  companyData: compactRecord({
                    displayName: values.companyName,
                    industry: values.companyIndustry,
                  }),
                  dealData: compactRecord({
                    title: values.dealTitle,
                    valueAmount: values.dealValueAmount,
                    valueCurrency: values.dealValueCurrency,
                  }),
                })
                flash(t('customers.leads.detail.saved', 'Lead saved.'), 'success')
                setReloadToken((token) => token + 1)
              }}
            />

            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">{t('customers.leads.detail.history', 'History')}</h2>
              {history.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t('customers.leads.detail.noHistory', 'No history yet.')}</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {history.map((entry) => (
                    <li key={entry.id} className="rounded-md border border-border px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{t(`customers.leads.history.${entry.entryType}`, entry.entryType)}</span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt) ?? ''}</span>
                      </div>
                      {entry.message ? <p className="mt-1 text-xs text-muted-foreground">{entry.message}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">{t('customers.leads.detail.qualification', 'Qualification')}</h2>
              <div className="mt-3 space-y-3">
                <Select value={selectedStageId} onValueChange={setSelectedStageId}>
                  <SelectTrigger aria-label={t('customers.leads.form.stage', 'Stage')}>
                    <SelectValue placeholder={t('customers.leads.form.stage', 'Stage')} />
                  </SelectTrigger>
                  <SelectContent>
                    {openStages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  disabled={!selectedStageId || busy !== null || converted}
                  onClick={() => { void runAction('advance-stage', '/api/customers/leads/advance-stage', { id: lead.id, stageId: selectedStageId }) }}
                  className="w-full"
                >
                  {t('customers.leads.detail.advance', 'Move stage')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => { void runAction('duplicate-check', '/api/customers/leads/duplicate-check', {
                    primaryEmail: lead.primaryEmail ?? undefined,
                    primaryPhone: lead.primaryPhone ?? undefined,
                    vatId: lead.vatId ?? undefined,
                    excludeLeadId: lead.id,
                  }).then((result) => {
                    const payload = result as { result?: { items?: Duplicate[] } } | null
                    setDuplicates(Array.isArray(payload?.result?.items) ? payload.result.items : [])
                  }) }}
                >
                  {t('customers.leads.detail.checkDuplicates', 'Check duplicates')}
                </Button>
                {duplicates ? (
                  <div className="rounded-md border border-border p-2 text-xs">
                    {duplicates.length === 0 ? (
                      <p className="text-muted-foreground">{t('customers.leads.detail.noDuplicates', 'No duplicates found.')}</p>
                    ) : (
                      <ul className="space-y-1">
                        {duplicates.map((duplicate) => (
                          <li key={`${duplicate.kind}-${duplicate.id}`}>
                            <span className="font-medium">{duplicate.displayName ?? duplicate.id}</span>
                            {' · '}
                            {duplicate.kind}
                            {' · '}
                            {duplicate.matchedOn.join(', ')}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">{t('customers.leads.detail.links', 'Linked records')}</h2>
              <div className="mt-3 space-y-3 text-sm">
                <LinkedRecord
                  label={t('customers.leads.detail.person', 'Person')}
                  id={linkedPerson}
                  hrefBase="/backend/customers/people"
                  options={people}
                  selectedId={linkPersonId}
                  onSelect={setLinkPersonId}
                  onLink={() => { void runAction('link-person', '/api/customers/leads/link-person', { id: lead.id, personId: linkPersonId }) }}
                  onCreate={() => { void runAction('create-person', '/api/customers/leads/create-person', { id: lead.id }) }}
                  linkLabel={t('customers.leads.detail.link', 'Link')}
                  createLabel={t('customers.leads.detail.create', 'Create')}
                />
                <LinkedRecord
                  label={t('customers.leads.detail.company', 'Company')}
                  id={linkedCompany}
                  hrefBase="/backend/customers/companies"
                  options={companies}
                  selectedId={linkCompanyId}
                  onSelect={setLinkCompanyId}
                  onLink={() => { void runAction('link-company', '/api/customers/leads/link-company', { id: lead.id, companyId: linkCompanyId }) }}
                  onCreate={() => { void runAction('create-company', '/api/customers/leads/create-company', { id: lead.id }) }}
                  linkLabel={t('customers.leads.detail.link', 'Link')}
                  createLabel={t('customers.leads.detail.create', 'Create')}
                />
                <LinkedRecord
                  label={t('customers.leads.detail.deal', 'Deal')}
                  id={linkedDeal}
                  hrefBase="/backend/customers/deals"
                  options={deals}
                  selectedId={linkDealId}
                  onSelect={setLinkDealId}
                  onLink={() => { void runAction('link-deal', '/api/customers/leads/link-deal', { id: lead.id, dealId: linkDealId }) }}
                  onCreate={() => { void runAction('create-deal', '/api/customers/leads/create-deal', { id: lead.id }) }}
                  linkLabel={t('customers.leads.detail.link', 'Link')}
                  createLabel={t('customers.leads.detail.create', 'Create')}
                />
              </div>
            </section>

            {!converted ? (
              <section className="rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold">{t('customers.leads.detail.convert', 'Convert lead')}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('customers.leads.detail.convertHint', 'Choose which records to create or link. Conversion is one-time.')}
                </p>
                <div className="mt-3 space-y-3 text-sm">
                  <ConvertTarget
                    label={t('customers.leads.detail.person', 'Person')}
                    mode={convertPersonMode}
                    onModeChange={setConvertPersonMode}
                    options={people}
                    selectedId={convertPersonId}
                    onSelect={setConvertPersonId}
                  />
                  <ConvertTarget
                    label={t('customers.leads.detail.company', 'Company')}
                    mode={convertCompanyMode}
                    onModeChange={setConvertCompanyMode}
                    options={companies}
                    selectedId={convertCompanyId}
                    onSelect={setConvertCompanyId}
                  />
                  <ConvertTarget
                    label={t('customers.leads.detail.deal', 'Deal')}
                    mode={convertDealMode}
                    onModeChange={setConvertDealMode}
                    options={deals}
                    selectedId={convertDealId}
                    onSelect={setConvertDealId}
                  />
                  <Button
                    type="button"
                    className="w-full"
                    disabled={busy !== null || (
                      convertPersonMode === 'skip' && convertCompanyMode === 'skip' && convertDealMode === 'skip'
                    )}
                    onClick={() => { void runAction('convert', '/api/customers/leads/convert', {
                      id: lead.id,
                      ...(convertPersonMode === 'skip' ? {} : { person: { mode: convertPersonMode, ...(convertPersonMode === 'link' ? { id: convertPersonId } : {}) } }),
                      ...(convertCompanyMode === 'skip' ? {} : { company: { mode: convertCompanyMode, ...(convertCompanyMode === 'link' ? { id: convertCompanyId } : {}) } }),
                      ...(convertDealMode === 'skip' ? {} : { deal: { mode: convertDealMode, ...(convertDealMode === 'link' ? { id: convertDealId } : {}) } }),
                    }) }}
                  >
                    {t('customers.leads.detail.convertAction', 'Convert')}
                  </Button>
                </div>
              </section>
            ) : (
              <section className="rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold">{t('customers.leads.detail.converted', 'Converted')}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDateTime(lead.convertedAt) ?? ''}
                </p>
              </section>
            )}

            {!converted ? (
              <section className="rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold">{t('customers.leads.detail.markLost', 'Mark lost')}</h2>
                <div className="mt-3 space-y-2">
                  <Select value={lostReasonId} onValueChange={setLostReasonId}>
                    <SelectTrigger aria-label={t('customers.leads.form.lostReason', 'Lost reason')}>
                      <SelectValue placeholder={t('customers.leads.form.lostReason', 'Lost reason')} />
                    </SelectTrigger>
                    <SelectContent>
                      {lostReasons.filter((reason) => reason.isActive).map((reason) => (
                        <SelectItem key={reason.id} value={reason.id}>{reason.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    value={lostNote}
                    onChange={(event) => setLostNote(event.target.value)}
                    placeholder={t('customers.leads.form.lostNote', 'Optional note')}
                    rows={2}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={!lostReasonId || busy !== null}
                    onClick={() => { void runAction('mark-lost', '/api/customers/leads/mark-lost', {
                      id: lead.id,
                      lostReasonId,
                      note: lostNote || undefined,
                    }) }}
                  >
                    {t('customers.leads.detail.markLostAction', 'Mark as lost')}
                  </Button>
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </PageBody>
    </Page>
  )
}

function LinkedRecord({
  label,
  id,
  hrefBase,
  options,
  selectedId,
  onSelect,
  onLink,
  onCreate,
  linkLabel,
  createLabel,
}: {
  label: string
  id: string | null
  hrefBase: string
  options: Option[]
  selectedId: string
  onSelect: (value: string) => void
  onLink: () => void
  onCreate: () => void
  linkLabel: string
  createLabel: string
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        {id ? (
          <Link href={`${hrefBase}/${id}`} className="text-xs text-primary hover:underline">
            {id.slice(0, 8)}…
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
      {!id ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedId} onValueChange={onSelect}>
            <SelectTrigger className="h-8 min-w-32 flex-1 text-xs">
              <SelectValue placeholder={label} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" disabled={!selectedId} onClick={onLink}>
            {linkLabel}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCreate}>
            {createLabel}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function ConvertTarget({
  label,
  mode,
  onModeChange,
  options,
  selectedId,
  onSelect,
}: {
  label: string
  mode: 'skip' | 'create' | 'link'
  onModeChange: (value: 'skip' | 'create' | 'link') => void
  options: Option[]
  selectedId: string
  onSelect: (value: string) => void
}) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs font-medium">{label}</span>
      <div className="flex gap-2">
        <Select value={mode} onValueChange={(value) => onModeChange(value as 'skip' | 'create' | 'link')}>
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="skip">Skip</SelectItem>
            <SelectItem value="create">Create</SelectItem>
            <SelectItem value="link">Link</SelectItem>
          </SelectContent>
        </Select>
        {mode === 'link' ? (
          <Select value={selectedId} onValueChange={onSelect}>
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue placeholder={label} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  )
}
