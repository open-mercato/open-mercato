"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { resolveCountryName } from '@open-mercato/shared/lib/location/countries'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { StatementSelectField } from '../../../../components/formConfig'
import {
  RiskCriteriaField,
  type RiskCriteriaEntry,
  type RiskCriteriaValue,
} from '../../../../components/RiskCriteriaField'
import { MitigationActionsSection } from '../../../../components/MitigationActionsSection'
import {
  riskConclusionBadgeVariant,
  riskTierBadgeVariant,
  type CountryRiskView,
} from '../../../../components/StatementRiskSection'
import {
  EUDR_CRITERIA_ANSWERS,
  EUDR_RISK_CONCLUSIONS,
  type EudrCriteriaAnswer,
  type EudrRiskConclusion,
  type EudrRiskTier,
} from '../../../../data/validators'

type RiskAssessmentRecord = {
  id: string
  statementId: string
  countryRisks: CountryRiskView[]
  overallTier: EudrRiskTier
  criteria: RiskCriteriaValue
  conclusion: EudrRiskConclusion
  isSimplified: boolean
  assessedAt: string | null
  reviewDueAt: string | null
  notes: string | null
  updatedAt: string
}

type RiskAssessmentDetailResponse = {
  items?: RiskAssessmentRecord[]
}

type RiskAssessmentFormValues = {
  id: string
  statementId: string
  criteria: RiskCriteriaValue
  conclusion: string
  assessedAt: string
  reviewDueAt: string
  notes: string
  updatedAt: string
} & Record<string, unknown>

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCriteriaAnswer(value: unknown): value is EudrCriteriaAnswer {
  return typeof value === 'string' && EUDR_CRITERIA_ANSWERS.some((answer) => answer === value)
}

function normalizeCriteria(value: unknown): RiskCriteriaValue {
  if (!isRecord(value)) return {}
  const normalized: RiskCriteriaValue = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry) || !isCriteriaAnswer(entry.answer)) continue
    const note = optionalText(entry.note)
    const nextEntry: RiskCriteriaEntry = note ? { answer: entry.answer, note } : { answer: entry.answer }
    normalized[key] = nextEntry
  }
  return normalized
}

function getRouteId(params?: { id?: string }): string | null {
  const rawId = params?.id
  return typeof rawId === 'string' && rawId.trim().length ? rawId : null
}

function toDateTimeLocalInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function formatDateInput(value: string | null): string {
  if (!value) return ''
  return value.slice(0, 10)
}

function toIsoDateTime(value: string | null): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

function conclusionOptions(translate: ReturnType<typeof useT>) {
  return EUDR_RISK_CONCLUSIONS.map((conclusion) => ({
    value: conclusion,
    label: translate(`eudr.conclusion.${conclusion}`),
  }))
}

export default function EditEudrRiskAssessmentPage({ params }: { params?: { id?: string } }) {
  const translate = useT()
  const locale = useLocale()
  const router = useRouter()
  const riskAssessmentId = React.useMemo(() => getRouteId(params), [params])
  const [record, setRecord] = React.useState<RiskAssessmentRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function loadRecord() {
      if (!riskAssessmentId) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const call = await apiCall<RiskAssessmentDetailResponse>(
          `/api/eudr/risk-assessments?id=${encodeURIComponent(riskAssessmentId)}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (!call.ok) {
          if (!cancelled) setError(translate('eudr.riskAssessments.form.loadError'))
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        if (cancelled) return
        if (items.length === 0) {
          setNotFound(true)
          setRecord(null)
          return
        }
        setRecord(items[0])
      } catch {
        if (!cancelled) setError(translate('eudr.riskAssessments.form.loadError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRecord()
    return () => {
      cancelled = true
    }
  }, [riskAssessmentId, translate])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'statementId',
      label: translate('eudr.riskAssessments.form.statement'),
      type: 'custom',
      required: true,
      component: ({ id, value, setValue }) => (
        <StatementSelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          placeholder={translate('eudr.riskAssessments.form.statementPlaceholder')}
          loadError={translate('eudr.riskAssessments.form.statementLoadError')}
        />
      ),
    },
    {
      id: 'criteria',
      label: translate('eudr.riskAssessments.form.criteria'),
      type: 'custom',
      layout: 'full',
      component: ({ id, value, setValue, disabled }) => (
        <RiskCriteriaField
          id={id}
          value={value}
          disabled={disabled}
          onChange={(nextValue) => setValue(nextValue)}
        />
      ),
    },
    {
      id: 'conclusion',
      label: translate('eudr.riskAssessments.form.conclusion'),
      type: 'select',
      required: true,
      options: conclusionOptions(translate),
    },
    {
      id: 'assessedAt',
      label: translate('eudr.riskAssessments.form.assessedAt'),
      type: 'datetime-local',
      required: true,
      maxDate: new Date(),
    },
    {
      id: 'reviewDueAt',
      label: translate('eudr.riskAssessments.form.reviewDueAt'),
      type: 'date',
      description: translate('eudr.riskAssessments.form.reviewDueAtHelp'),
    },
    {
      id: 'notes',
      label: translate('eudr.riskAssessments.form.notes'),
      type: 'textarea',
    },
  ], [translate])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: translate('eudr.riskAssessments.form.details'),
      column: 1,
      fields: ['statementId', 'conclusion', 'assessedAt', 'reviewDueAt', 'criteria', 'notes'],
    },
  ], [translate])

  const initialValues = React.useMemo<RiskAssessmentFormValues | null>(() => {
    if (!record) return null
    return {
      id: record.id,
      statementId: record.statementId,
      criteria: normalizeCriteria(record.criteria),
      conclusion: record.conclusion,
      assessedAt: toDateTimeLocalInput(record.assessedAt),
      reviewDueAt: formatDateInput(record.reviewDueAt),
      notes: record.notes ?? '',
      updatedAt: record.updatedAt,
    }
  }, [record])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={translate('eudr.riskAssessments.form.loading')} />
        </PageBody>
      </Page>
    )
  }

  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={translate('eudr.riskAssessments.form.notFound')}
            backHref="/backend/eudr/risk-assessments"
            backLabel={translate('eudr.riskAssessments.form.backToList')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !record || !initialValues) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? translate('eudr.riskAssessments.form.loadError')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<RiskAssessmentFormValues>
          title={translate('eudr.riskAssessments.edit.title')}
          backHref="/backend/eudr/risk-assessments"
          cancelHref="/backend/eudr/risk-assessments"
          deleteRedirect="/backend/eudr/risk-assessments"
          submitLabel={translate('eudr.riskAssessments.form.submitUpdate')}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          onSubmit={async (values) => {
            const statementId = optionalText(values.statementId)
            if (!statementId) {
              const message = translate('eudr.riskAssessments.form.statementRequired')
              throw createCrudFormError(message, { statementId: message })
            }
            const conclusion = optionalText(values.conclusion)
            if (!conclusion) {
              const message = translate('eudr.riskAssessments.form.conclusionRequired')
              throw createCrudFormError(message, { conclusion: message })
            }
            const assessedAt = toIsoDateTime(optionalText(values.assessedAt))
            if (!assessedAt) {
              const message = translate('eudr.riskAssessments.form.assessedAtInvalid')
              throw createCrudFormError(message, { assessedAt: message })
            }
            await updateCrud('eudr/risk-assessments', {
              id: record.id,
              statementId,
              criteria: normalizeCriteria(values.criteria),
              conclusion,
              assessedAt,
              reviewDueAt: optionalText(values.reviewDueAt),
              notes: optionalText(values.notes),
            }, {
              errorMessage: translate('eudr.riskAssessments.form.updateError'),
            })
            flash(translate('eudr.riskAssessments.form.updateSuccess'), 'success')
            router.push('/backend/eudr/risk-assessments')
          }}
          onDelete={async () => {
            await deleteCrud('eudr/risk-assessments', record.id, {
              errorMessage: translate('eudr.riskAssessments.form.deleteError'),
            })
          }}
        />

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-lg font-semibold">{translate('eudr.riskAssessments.computed.title')}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant={riskConclusionBadgeVariant(record.conclusion)} dot>
              {translate(`eudr.conclusion.${record.conclusion}`)}
            </StatusBadge>
            <StatusBadge variant={riskTierBadgeVariant(record.overallTier)}>
              {translate(`eudr.riskTier.${record.overallTier}`)}
            </StatusBadge>
            <StatusBadge variant={record.isSimplified ? 'success' : 'neutral'}>
              {record.isSimplified
                ? translate('eudr.riskAssessments.computed.simplified')
                : translate('eudr.riskAssessments.computed.fullDueDiligence')}
            </StatusBadge>
          </div>
          {record.countryRisks.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {record.countryRisks.map((risk) => (
                <StatusBadge key={`${risk.country}:${risk.tier}`} variant={riskTierBadgeVariant(risk.tier)}>
                  {resolveCountryName(risk.country, { locale })} ({translate(`eudr.riskTier.${risk.tier}`)})
                </StatusBadge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{translate('eudr.riskAssessments.computed.noCountryRisks')}</p>
          )}
        </section>

        <MitigationActionsSection riskAssessmentId={record.id} />
      </PageBody>
    </Page>
  )
}
