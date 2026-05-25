"use client"

import * as React from 'react'
import { format } from 'date-fns/format'
import { parseISO } from 'date-fns/parseISO'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { DictionarySelectField } from '../../formConfig'
import { createDictionarySelectLabels } from '../utils'
import { DealFormField } from './DealFormField'
import { PipelineSelect } from './PipelineSelect'
import { PipelineStageSelect } from './PipelineStageSelect'
import { SuffixInput } from './SuffixInput'
import { DealCurrencyField } from './DealCurrencyField'
import { sanitizeAmount, sanitizeProbability } from './dealNumericInput'
import type { BaseValues } from './dealFormTypes'
import type { PipelineOption, PipelineStageOption } from './useDealPipelines'

type Translate = (key: string, fallback: string, params?: Record<string, string | number>) => string

export type DealDetailsFieldsProps = {
  values: BaseValues
  errors: Record<string, string>
  isSubmitting: boolean
  patch: (partial: Partial<BaseValues>) => void
  onPipelineChange: (id: string) => void
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
  statusLabels: ReturnType<typeof createDictionarySelectLabels>
  tr: Translate
}

function toDate(value: string): Date | null {
  if (!value) return null
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function DealDetailsFields({
  values,
  errors,
  isSubmitting,
  patch,
  onPipelineChange,
  pipelines,
  stages,
  statusLabels,
  tr,
}: DealDetailsFieldsProps) {
  return (
    <>
      <DealFormField
        fieldId="title"
        label={tr('customers.deals.create.fields.title', 'Deal title')}
        required
        hint={tr('customers.deals.create.hints.title', 'Short, descriptive name shown on pipeline cards')}
        error={errors.title}
      >
        <Input
          value={values.title}
          onChange={(event) => patch({ title: event.target.value })}
          aria-invalid={errors.title ? true : undefined}
          disabled={isSubmitting}
        />
      </DealFormField>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DealFormField fieldId="status" label={tr('customers.people.detail.deals.fields.status', 'Status')}>
          <DictionarySelectField
            kind="deal-statuses"
            value={values.status || undefined}
            onChange={(next) => patch({ status: next ?? '' })}
            labels={statusLabels}
            selectClassName="w-full"
            showActiveAppearance={false}
          />
        </DealFormField>
        <DealFormField fieldId="pipelineId" label={tr('customers.people.detail.deals.fields.pipeline', 'Pipeline')}>
          <PipelineSelect
            pipelines={pipelines}
            value={values.pipelineId}
            onChange={onPipelineChange}
            disabled={isSubmitting}
            placeholder={tr('customers.deals.form.pipeline.placeholder', 'Select pipeline…')}
          />
        </DealFormField>
      </div>

      <DealFormField
        fieldId="pipelineStageId"
        label={tr('customers.people.detail.deals.fields.pipelineStage', 'Pipeline stage')}
        hint={tr('customers.deals.create.hints.pipelineStage', 'Stages depend on the selected pipeline')}
      >
        <PipelineStageSelect
          stages={stages}
          value={values.pipelineStageId}
          onChange={(id) => patch({ pipelineStageId: id })}
          disabled={isSubmitting || !values.pipelineId}
          placeholder={tr('customers.deals.form.pipelineStage.placeholder', 'Select stage…')}
          formatCount={(position, total) =>
            tr('customers.deals.create.fields.stageOf', '· stage {position} of {total}', { position, total })
          }
        />
      </DealFormField>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DealFormField
          fieldId="valueAmount"
          label={tr('customers.deals.create.fields.valueAmount', 'Deal value')}
          hint={tr('customers.deals.create.hints.valueAmount', 'Potential revenue from this opportunity')}
          error={errors.valueAmount}
        >
          <SuffixInput
            suffix={values.valueCurrency}
            inputMode="decimal"
            value={values.valueAmount}
            onChange={(event) => patch({ valueAmount: sanitizeAmount(event.target.value) })}
            placeholder="0"
            aria-invalid={errors.valueAmount ? true : undefined}
            disabled={isSubmitting}
          />
        </DealFormField>
        <DealFormField fieldId="valueCurrency" label={tr('customers.people.detail.deals.fields.valueCurrency', 'Currency')}>
          <DealCurrencyField
            value={values.valueCurrency}
            onChange={(code) => patch({ valueCurrency: code })}
            disabled={isSubmitting}
          />
        </DealFormField>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DealFormField
          fieldId="probability"
          label={tr('customers.deals.create.fields.probability', 'Probability')}
          hint={tr('customers.deals.create.hints.probability', '0 – 100%, used for weighted pipeline value')}
          error={errors.probability}
        >
          <SuffixInput
            suffix="%"
            inputMode="numeric"
            value={values.probability}
            onChange={(event) => patch({ probability: sanitizeProbability(event.target.value) })}
            placeholder="0"
            aria-invalid={errors.probability ? true : undefined}
            disabled={isSubmitting}
          />
        </DealFormField>
        <DealFormField fieldId="expectedCloseAt" label={tr('customers.deals.create.fields.expectedCloseAt', 'Expected close date')}>
          <DatePicker
            value={toDate(values.expectedCloseAt)}
            onChange={(date) => patch({ expectedCloseAt: date ? format(date, 'yyyy-MM-dd') : '' })}
            disabled={isSubmitting}
            placeholder={tr('customers.deals.create.fields.datePlaceholder', 'Pick a date')}
          />
        </DealFormField>
      </div>

      <DealFormField fieldId="description" label={tr('customers.people.detail.deals.fields.description', 'Description')}>
        <Textarea
          value={values.description}
          onChange={(event) => patch({ description: event.target.value })}
          disabled={isSubmitting}
        />
      </DealFormField>
    </>
  )
}

export default DealDetailsFields
