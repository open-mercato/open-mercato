"use client"

import * as React from 'react'
import { format } from 'date-fns/format'
import { parseISO } from 'date-fns/parseISO'
import { useOptionalLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { DictionarySelectField } from '../../../../../components/formConfig'
import { createDictionarySelectLabels } from '../../../../../components/detail/utils'
import { DealOwnerSelect, type DealOwnerOption } from '../../../../../components/detail/DealOwnerSelect'
import { DealCurrencyField } from '../../../../../components/detail/create/DealCurrencyField'
import { PipelineSelect } from '../../../../../components/detail/create/PipelineSelect'
import { SuffixInput } from '../../../../../components/detail/create/SuffixInput'
import { sanitizeAmount, sanitizeProbability } from '../../../../../components/detail/create/dealNumericInput'
import { isLostDealStatus } from '../../../../../lib/dealStatus'
import type { DealMergeLookups } from './useDealMergeLookups'

export type PipelineCustomValue = { pipelineId: string; pipelineStageId: string }
export type ClosureCustomValue = { status: string; lossReasonId: string; lossNotes: string }

export function isLostStatus(status: string): boolean {
  return isLostDealStatus(status.trim().toLowerCase())
}

function toDate(value: string): Date | null {
  if (!value) return null
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-status-error-text">{message}</p>
}

export function ScalarCustomEditor({
  field,
  label,
  value,
  currency,
  ownerInitialOption,
  error,
  onChange,
}: {
  field: string
  label: string
  value: string
  currency: string
  ownerInitialOption: DealOwnerOption | null
  error?: string
  onChange: (value: string) => void
}) {
  const t = useT()
  const locale = useOptionalLocale()
  const ariaLabel = t('customers.deals.merge.customValueFor', 'New value for {field}', { field: label })
  let control: React.ReactNode
  if (field === 'description') {
    control = <Textarea value={value} onChange={(event) => onChange(event.target.value)} aria-label={ariaLabel} />
  } else if (field === 'valueAmount') {
    control = (
      <SuffixInput
        suffix={currency}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(sanitizeAmount(event.target.value, locale))}
        aria-label={ariaLabel}
      />
    )
  } else if (field === 'probability') {
    control = (
      <SuffixInput
        suffix="%"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(sanitizeProbability(event.target.value))}
        aria-label={ariaLabel}
      />
    )
  } else if (field === 'valueCurrency') {
    control = <DealCurrencyField value={value} onChange={onChange} />
  } else if (field === 'expectedCloseAt') {
    control = (
      <DatePicker
        value={toDate(value)}
        onChange={(date) => onChange(date ? format(date, 'yyyy-MM-dd') : '')}
        placeholder={t('customers.deals.create.fields.datePlaceholder', 'Pick a date')}
      />
    )
  } else if (field === 'ownerUserId') {
    control = (
      <DealOwnerSelect
        value={value || null}
        onChange={(next) => onChange(next ?? '')}
        initialOption={ownerInitialOption}
      />
    )
  } else {
    control = <Input value={value} onChange={(event) => onChange(event.target.value)} aria-label={ariaLabel} />
  }
  return (
    <div className="space-y-1">
      {control}
      <FieldError message={error} />
    </div>
  )
}

export function PipelineCustomEditor({
  value,
  lookups,
  error,
  onChange,
}: {
  value: PipelineCustomValue
  lookups: DealMergeLookups
  error?: string
  onChange: (value: PipelineCustomValue) => void
}) {
  const t = useT()
  const { loadStages, stagesPipelineId, stagesLoading } = lookups
  const requestedPipelineId = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!value.pipelineId) return
    if (stagesPipelineId === value.pipelineId || stagesLoading) return
    if (requestedPipelineId.current === value.pipelineId) return
    requestedPipelineId.current = value.pipelineId
    void loadStages(value.pipelineId)
  }, [loadStages, stagesLoading, stagesPipelineId, value.pipelineId])

  const stages = stagesPipelineId === value.pipelineId ? lookups.stages : []
  const stageLabel = t('customers.people.detail.deals.fields.pipelineStage', 'Pipeline stage')
  const pipelineLabel = t('customers.people.detail.deals.fields.pipeline', 'Pipeline')

  return (
    <div className="space-y-2" data-merge-editor="pipeline">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{pipelineLabel}</Label>
        <PipelineSelect
          pipelines={lookups.pipelines}
          value={value.pipelineId}
          onChange={(pipelineId) => {
            requestedPipelineId.current = pipelineId || null
            onChange({ pipelineId, pipelineStageId: '' })
            if (pipelineId) void loadStages(pipelineId)
          }}
          placeholder={t('customers.deals.form.pipeline.placeholder', 'Select pipeline…')}
        />
      </div>
      {value.pipelineId ? (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{stageLabel}</Label>
          <Select
            value={value.pipelineStageId || undefined}
            onValueChange={(pipelineStageId) => onChange({ ...value, pipelineStageId: pipelineStageId ?? '' })}
            disabled={stages.length === 0}
          >
            <SelectTrigger aria-label={stageLabel}>
              <SelectValue placeholder={t('customers.deals.merge.stagePlaceholder', 'Select stage…')} />
            </SelectTrigger>
            <SelectContent>
              {stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>{stage.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <FieldError message={error} />
    </div>
  )
}

export function ClosureCustomEditor({
  value,
  lookups,
  error,
  onChange,
}: {
  value: ClosureCustomValue
  lookups: DealMergeLookups
  error?: string
  onChange: (value: ClosureCustomValue) => void
}) {
  const t = useT()
  const statusLabels = React.useMemo(
    () => createDictionarySelectLabels('deal-statuses', (key, fallback) => t(key, fallback)),
    [t],
  )
  const lost = isLostStatus(value.status)
  const lossReasonLabel = t('customers.deals.merge.field.lossReasonId', 'Loss reason')
  const lossNotesLabel = t('customers.deals.merge.field.lossNotes', 'Loss notes')
  return (
    <div className="space-y-2" data-merge-editor="closure">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{t('customers.deals.merge.field.status', 'Status')}</Label>
        <DictionarySelectField
          kind="deal-statuses"
          value={value.status || undefined}
          onChange={(next) => {
            const status = next ?? ''
            onChange(isLostStatus(status) ? { ...value, status } : { status, lossReasonId: '', lossNotes: '' })
          }}
          labels={statusLabels}
          selectClassName="w-full"
          showActiveAppearance={false}
        />
      </div>
      {lost ? (
        <>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{lossReasonLabel}</Label>
            <Select
              value={value.lossReasonId || undefined}
              onValueChange={(lossReasonId) => onChange({ ...value, lossReasonId: lossReasonId ?? '' })}
            >
              <SelectTrigger aria-label={lossReasonLabel}>
                <SelectValue placeholder={t('customers.deals.merge.lossReasonPlaceholder', 'Select loss reason…')} />
              </SelectTrigger>
              <SelectContent>
                {lookups.lossReasons.map((reason) => (
                  <SelectItem key={reason.id} value={reason.id}>{reason.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{lossNotesLabel}</Label>
            <Textarea
              value={value.lossNotes}
              onChange={(event) => onChange({ ...value, lossNotes: event.target.value })}
              aria-label={lossNotesLabel}
            />
          </div>
        </>
      ) : null}
      <FieldError message={error} />
    </div>
  )
}
