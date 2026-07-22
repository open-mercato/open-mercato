"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatementSelectField } from '../../../../components/formConfig'
import {
  RiskCriteriaField,
  type RiskCriteriaEntry,
  type RiskCriteriaValue,
} from '../../../../components/RiskCriteriaField'
import {
  EUDR_CRITERIA_ANSWERS,
  EUDR_RISK_CONCLUSIONS,
  type EudrCriteriaAnswer,
} from '../../../../data/validators'

type RiskAssessmentFormValues = {
  statementId: string
  criteria: RiskCriteriaValue
  conclusion: string
  assessedAt: string
  reviewDueAt: string
  notes: string
} & Record<string, unknown>

type CreateRiskAssessmentResponse = {
  id?: string | null
}

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

function toDateTimeLocalInput(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function defaultReviewDueDate(): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 1)
  return date.toISOString().slice(0, 10)
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

export default function CreateEudrRiskAssessmentPage() {
  const translate = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefilledStatementId = searchParams.get('statementId') ?? ''

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

  return (
    <Page>
      <PageBody>
        <CrudForm<RiskAssessmentFormValues>
          title={translate('eudr.riskAssessments.create.title')}
          backHref="/backend/eudr/risk-assessments"
          cancelHref="/backend/eudr/risk-assessments"
          submitLabel={translate('eudr.riskAssessments.form.submitCreate')}
          fields={fields}
          groups={groups}
          initialValues={{
            statementId: prefilledStatementId,
            criteria: {},
            conclusion: '',
            assessedAt: toDateTimeLocalInput(new Date()),
            reviewDueAt: defaultReviewDueDate(),
            notes: '',
          }}
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
            const result = await createCrud<CreateRiskAssessmentResponse>('eudr/risk-assessments', {
              statementId,
              criteria: normalizeCriteria(values.criteria),
              conclusion,
              assessedAt,
              reviewDueAt: optionalText(values.reviewDueAt),
              notes: optionalText(values.notes),
            }, {
              errorMessage: translate('eudr.riskAssessments.form.createError'),
            })
            flash(translate('eudr.riskAssessments.form.createSuccess'), 'success')
            const id = typeof result.result?.id === 'string' ? result.result.id : null
            router.push(id ? `/backend/eudr/risk-assessments/${id}` : '/backend/eudr/risk-assessments')
          }}
        />
      </PageBody>
    </Page>
  )
}
