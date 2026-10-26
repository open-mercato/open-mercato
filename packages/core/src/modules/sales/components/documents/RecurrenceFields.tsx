"use client"

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  SALES_RECURRENCE_FREQUENCIES,
  endsOn,
  isIsoDate,
  localToday,
  type SalesRecurrenceFrequency,
} from '../../lib/recurrence'
import { formatRecurrenceDate, formatRecurrenceFrequency } from '../../lib/recurrenceLabel'
import { recurrenceInputSchema, type RecurrenceInput } from '../../lib/recurrenceInput'

export type RecurrenceDraft = {
  enabled: boolean
  frequency: SalesRecurrenceFrequency
  startsOn: string
  openEnded: boolean
  periodCount: string
  anchorDay: number | null
}

export type RecurrenceValue = {
  frequency: SalesRecurrenceFrequency
  startsOn: string
  anchorDay?: number | null
  periodCount?: number | null
}

export function createRecurrenceDraft(recurrence?: RecurrenceValue | null): RecurrenceDraft {
  return {
    enabled: !!recurrence,
    frequency: recurrence?.frequency ?? 'monthly',
    startsOn: recurrence?.startsOn ?? localToday(),
    openEnded: recurrence ? !recurrence.periodCount : false,
    periodCount: recurrence?.periodCount ? String(recurrence.periodCount) : '12',
    anchorDay: recurrence?.anchorDay ?? null,
  }
}

export type RecurrenceDraftResult =
  | { ok: true; recurrence: RecurrenceInput | null }
  | { ok: false; fieldErrors: Partial<Record<'startsOn' | 'periodCount' | 'anchorDay' | 'frequency', string>> }

/** Validates a draft with the server schema; `recurrence: null` means "not recurring". */
export function resolveRecurrenceDraft(draft: RecurrenceDraft | null | undefined): RecurrenceDraftResult {
  if (!draft?.enabled) return { ok: true, recurrence: null }
  const parsed = recurrenceInputSchema.safeParse({
    frequency: draft.frequency,
    startsOn: draft.startsOn,
    anchorDay: draft.anchorDay,
    periodCount: draft.openEnded ? null : draft.periodCount,
  })
  if (parsed.success) return { ok: true, recurrence: parsed.data }
  const fieldErrors: Partial<Record<'startsOn' | 'periodCount' | 'anchorDay' | 'frequency', string>> = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0]
    if (field === 'startsOn' || field === 'periodCount' || field === 'anchorDay' || field === 'frequency') {
      fieldErrors[field] ??= issue.message
    }
  }
  return { ok: false, fieldErrors }
}

function toLocalDate(value: string): Date | null {
  if (!isIsoDate(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

type RecurrenceFieldsProps = {
  value: RecurrenceDraft
  onChange: (next: RecurrenceDraft) => void
  disabled?: boolean
  hideToggle?: boolean
  errors?: Partial<Record<'startsOn' | 'periodCount' | 'anchorDay' | 'frequency', string>>
}

export function RecurrenceFields({ value, onChange, disabled, hideToggle, errors }: RecurrenceFieldsProps) {
  const t = useT()
  const locale = useLocale()
  const update = React.useCallback(
    (patch: Partial<RecurrenceDraft>) => onChange({ ...value, ...patch }),
    [onChange, value],
  )
  const preview = React.useMemo(() => {
    const result = resolveRecurrenceDraft({ ...value, enabled: true })
    if (!result.ok || !result.recurrence) return null
    return { firstInvoiceOn: result.recurrence.startsOn, endsOn: endsOn(result.recurrence) }
  }, [value])
  const translateError = (message?: string) => (message ? t(message, message) : undefined)

  return (
    <div className="space-y-4" data-testid="sales-recurrence-fields">
      {hideToggle ? null : (
        <SwitchField
          label={t('sales.recurring.form.toggle', 'Recurring')}
          description={t('sales.recurring.form.toggleDescription', 'Bill this document on a repeating schedule.')}
          checked={value.enabled}
          disabled={disabled}
          onCheckedChange={(checked) => update({ enabled: checked === true })}
          data-testid="sales-recurrence-toggle"
        />
      )}
      {value.enabled ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('sales.recurring.form.frequency', 'Frequency')} error={translateError(errors?.frequency)} disabled={disabled}>
            <Select
              value={value.frequency}
              onValueChange={(next) => update({ frequency: next as SalesRecurrenceFrequency, anchorDay: null })}
              disabled={disabled}
            >
              <SelectTrigger data-testid="sales-recurrence-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SALES_RECURRENCE_FREQUENCIES.map((frequency) => (
                  <SelectItem key={frequency} value={frequency}>
                    {formatRecurrenceFrequency(frequency, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t('sales.recurring.form.startsOn', 'Start date')} error={translateError(errors?.startsOn)} disabled={disabled}>
            <div data-testid="sales-recurrence-starts-on">
              <DatePicker
                value={toLocalDate(value.startsOn)}
                onChange={(date) => {
                  if (date) update({ startsOn: localToday(date), anchorDay: null })
                }}
                footer="none"
                disabled={disabled}
              />
            </div>
          </FormField>
          <FormField
            label={t('sales.recurring.form.periodCount', 'Number of periods')}
            error={translateError(errors?.periodCount ?? errors?.anchorDay)}
            disabled={disabled || value.openEnded}
          >
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={value.openEnded ? '' : value.periodCount}
              disabled={disabled || value.openEnded}
              onChange={(event) => update({ periodCount: event.target.value })}
              data-testid="sales-recurrence-period-count"
            />
          </FormField>
          <SwitchField
            label={t('sales.recurring.form.openEnded', 'No end date')}
            checked={value.openEnded}
            disabled={disabled}
            onCheckedChange={(checked) => update({ openEnded: checked === true })}
            data-testid="sales-recurrence-open-ended"
          />
          <p className="text-sm text-muted-foreground sm:col-span-2" data-testid="sales-recurrence-preview">
            {preview
              ? [
                  t('sales.recurring.form.firstInvoice', 'First invoice on {date}', {
                    date: formatRecurrenceDate(preview.firstInvoiceOn, locale),
                  }),
                  preview.endsOn
                    ? t('sales.recurring.form.endsOn', 'Ends on {date}', { date: formatRecurrenceDate(preview.endsOn, locale) })
                    : t('sales.recurring.form.noEnd', 'No end date'),
                ].join(' · ')
              : t('sales.recurring.form.previewUnavailable', 'Complete the schedule to see its dates.')}
          </p>
        </div>
      ) : null}
    </div>
  )
}
