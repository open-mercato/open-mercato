"use client"

import * as React from 'react'
import { format } from 'date-fns/format'
import { parseISO } from 'date-fns/parseISO'
import { Input } from '@open-mercato/ui/primitives/input'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { useOptionalLocale } from '@open-mercato/shared/lib/i18n/context'
import { DealSectionCard } from './DealSectionCard'
import { DealFormField } from './DealFormField'
import { PipelineSelect } from './PipelineSelect'
import { DealStagePath, selectableDealStages } from './DealStagePath'
import { SuffixInput } from './SuffixInput'
import { DealCurrencyField } from './DealCurrencyField'
import { DealOwnerSelect, type DealOwnerOption } from '../DealOwnerSelect'
import { sanitizeAmount } from './dealNumericInput'
import type { BaseValues, Translate } from './dealFormTypes'
import type { PipelineOption, PipelineStageOption } from './useDealPipelines'

export type DealDetailsFieldsProps = {
  values: BaseValues
  errors: Record<string, string>
  isSubmitting: boolean
  patch: (partial: Partial<BaseValues>) => void
  onPipelineChange: (id: string) => void
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
  pipelineName?: string | null
  stagesFailed?: boolean
  stagesLoading?: boolean
  onRetryStages?: () => void
  /** Seeds the owner picker so a self-assigned user outside the roster still renders by name. */
  ownerInitialOption?: DealOwnerOption | null
  tr: Translate
}

function toDate(value: string): Date | null {
  if (!value) return null
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * The fields every new deal needs, in the order a rep thinks about them: what it is, where
 * it sits in the pipeline, then the numbers. Status, probability, notes and custom
 * attributes live under "More details" on the create page (#5109).
 */
export function DealDetailsFields({
  values,
  errors,
  isSubmitting,
  patch,
  onPipelineChange,
  pipelines,
  stages,
  pipelineName = null,
  stagesFailed = false,
  stagesLoading = false,
  onRetryStages,
  ownerInitialOption,
  tr,
}: DealDetailsFieldsProps) {
  const locale = useOptionalLocale()
  const hasSelectableStages = selectableDealStages(stages, values.pipelineStageId).length > 0
  return (
    <>
      <DealSectionCard>
        <DealFormField
          fieldId="title"
          label={tr('customers.deals.create.fields.title', 'Deal title')}
          required
          error={errors.title}
        >
          <Input
            size={40}
            className="text-lg"
            value={values.title}
            onChange={(event) => patch({ title: event.target.value })}
            aria-invalid={errors.title ? true : undefined}
            disabled={isSubmitting}
          />
        </DealFormField>
        <div className="md:max-w-sm">
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
        {values.pipelineId && stagesFailed ? (
          <ErrorMessage
            label={tr('customers.deals.create.stagesLoadFailed', 'Could not load the stages of this pipeline.')}
            action={(
              <Button type="button" variant="outline" size="sm" onClick={onRetryStages}>
                {tr('customers.deals.create.stagesRetry', 'Try again')}
              </Button>
            )}
          />
        ) : null}
        {values.pipelineId && stagesLoading && !stagesFailed ? (
          <div role="status">
            <LoadingMessage label={tr('customers.deals.create.stagesLoading', 'Stages are still loading. Try again in a moment.')} />
          </div>
        ) : null}
        {values.pipelineId && !stagesFailed && !stagesLoading && !hasSelectableStages ? (
          <p className="text-sm text-muted-foreground">
            {tr('customers.deals.create.noOpenStages', 'This pipeline has no open stages. The deal will be saved without a stage.')}
          </p>
        ) : null}
        {values.pipelineId && !stagesFailed && !stagesLoading && hasSelectableStages ? (
          <div className="space-y-2" data-crud-field-id="pipelineStageId">
            <Label>{tr('customers.people.detail.deals.fields.pipelineStage', 'Pipeline stage')}</Label>
            <DealStagePath
              stages={stages}
              value={values.pipelineStageId || null}
              onChange={(id) => patch({ pipelineStageId: id })}
              disabled={isSubmitting}
              label={pipelineName ?? tr('customers.people.detail.deals.fields.pipelineStage', 'Pipeline stage')}
            />
          </div>
        ) : null}
      </DealSectionCard>

      <DealSectionCard title={tr('customers.deals.create.sections.details.title', 'Details')}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <DealFormField
            fieldId="valueAmount"
            controlId="valueAmount"
            label={tr('customers.deals.create.fields.valueAmount', 'Deal value')}
            error={errors.valueAmount}
          >
            <SuffixInput
              id="valueAmount"
              suffix={values.valueCurrency}
              inputMode="decimal"
              value={values.valueAmount}
              onChange={(event) => patch({ valueAmount: sanitizeAmount(event.target.value, locale) })}
              placeholder="0"
              aria-invalid={errors.valueAmount ? true : undefined}
              disabled={isSubmitting}
            />
          </DealFormField>
          <DealFormField fieldId="valueCurrency" controlId="valueCurrency" label={tr('customers.people.detail.deals.fields.valueCurrency', 'Currency')}>
            <DealCurrencyField
              id="valueCurrency"
              value={values.valueCurrency}
              onChange={(code) => patch({ valueCurrency: code })}
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
          <DealFormField fieldId="ownerUserId" label={tr('customers.deals.fields.owner', 'Owner')}>
            <DealOwnerSelect
              value={values.ownerUserId ? values.ownerUserId : null}
              onChange={(next) => patch({ ownerUserId: next ?? '' })}
              initialOption={ownerInitialOption ?? null}
              disabled={isSubmitting}
            />
          </DealFormField>
        </div>
      </DealSectionCard>
    </>
  )
}

export default DealDetailsFields
