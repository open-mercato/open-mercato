"use client"

import * as React from 'react'
import { ChevronDown, ChevronRight, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ICON_SUGGESTIONS } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import {
  DictionaryForm,
  type DictionaryFormValues,
} from '@open-mercato/core/modules/dictionaries/components/DictionaryForm'
import {
  DictionaryTable,
  type DictionaryTableEntry,
} from '@open-mercato/core/modules/dictionaries/components/DictionaryTable'
import {
  fetchAssignableStaffMembersPage,
  type AssignableStaffMember,
} from '@open-mercato/core/modules/customers/lib/assignableStaff'
import { parseEscalationTiers, type EscalationTier } from '../../../lib/escalation'
import type { BusinessWeekday } from '../../../lib/businessHours'
import {
  buildBusinessHoursFormValue,
  createBusinessHoursIntervalRow,
  nextBusinessHoursRowKey,
  serializeBusinessHoursRecord,
  stringifyJsonValue,
  validateBusinessHoursValue,
  type BusinessHoursFormValue,
  type BusinessHoursIntervalRow,
} from '../../../lib/businessHoursForm'

type WarrantyDictionaryKind =
  | 'warranty-claim-fault-code'
  | 'warranty-claim-reason'
  | 'warranty-claim-rejection-reason'

type SectionDefinition = {
  kind: WarrantyDictionaryKind
  dictionaryKey: string
  titleKey: string
  descriptionKey: string
}

type DialogState =
  | { mode: 'create'; kind: WarrantyDictionaryKind }
  | { mode: 'edit'; kind: WarrantyDictionaryKind; entry: DictionaryTableEntry }

type DictionaryListItem = {
  id?: string
  key?: string
}

type EscalationTierRow = {
  key: string
  atPct: string
  action: EscalationTier['action']
  toUserId: string
}

type GeneralSettingsResult = {
  slaHours: number
  slaPauseOnInfoRequested: boolean
  slaAtRiskThresholdPct: number
  autoApproveEnabled: boolean
  autoApproveMaxAmount: number | null
  autoApproveCurrencyCode: string | null
  autoApproveRequireInWarranty: boolean
  defaultWarrantyMonths: number | null
  returnWindowDays: number | null
  businessHours: Record<string, unknown> | null
  escalationTiers: unknown[] | null
  adjudicationUseRules: boolean
  quarantineGrades: string[] | null
  returnLabelProvider: string | null
  updatedAt: string | null
}

type GeneralSettingsEnvelope = {
  ok?: boolean
  result?: GeneralSettingsResult
  error?: string
}

type GeneralSettingsFormValues = {
  slaHours: string
  slaPauseOnInfoRequested: boolean
  slaAtRiskThresholdPct: string
  autoApproveEnabled: boolean
  autoApproveMaxAmount: string
  autoApproveCurrencyCode: string
  autoApproveRequireInWarranty: boolean
  defaultWarrantyMonths: string
  returnWindowDays: string
  businessHours: BusinessHoursFormValue
  escalationTiers: EscalationTierRow[]
  adjudicationUseRules: boolean
  quarantineGrades: string[]
  returnLabelProvider: string
}

type EscalationTiersFieldTranslations = {
  rowLabel: (index: number) => string
  atPctLabel: string
  actionLabel: string
  actionNotify: string
  actionReassign: string
  toUserLabel: string
  toUserPlaceholder: string
  addRow: string
  removeRow: string
  empty: string
  error: {
    atPct: string
    toUserId: string
  }
}

type BusinessHoursFieldTranslations = {
  dayLabels: Record<BusinessWeekday, string>
  timezoneLabel: string
  timezonePlaceholder: string
  timezoneHelp: string
  startLabel: string
  endLabel: string
  addWindow: string
  removeWindow: string
  closed: string
  holidaysLabel: string
  holidaysHelp: string
  addHoliday: string
  removeHoliday: string
  holidayDateLabel: string
  advancedToggle: string
  advancedLabel: string
  advancedHelp: string
  error: {
    window: string
    holiday: string
    rows: string
  }
}

type GeneralSettingsTranslations = {
  title: string
  description: string
  loading: string
  saveError: string
  loadError: string
  invalidError: string
  success: string
  refresh: string
  save: string
  saving: string
  sections: {
    slaEscalation: string
    adjudication: string
    receiving: string
    returns: string
  }
  jsonErrors: {
    businessHours: string
    escalationTiers: string
  }
  escalationTiers: EscalationTiersFieldTranslations
  businessHours: BusinessHoursFieldTranslations
  fields: {
    slaHours: string
    slaHoursHelp: string
    slaPauseOnInfoRequested: string
    slaPauseOnInfoRequestedHelp: string
    slaAtRiskThresholdPct: string
    slaAtRiskThresholdPctHelp: string
    defaultWarrantyMonths: string
    defaultWarrantyMonthsHelp: string
    returnWindowDays: string
    returnWindowDaysHelp: string
    autoApproveEnabled: string
    autoApproveEnabledHelp: string
    autoApproveMaxAmount: string
    autoApproveMaxAmountHelp: string
    autoApproveCurrencyCode: string
    autoApproveCurrencyCodeHelp: string
    autoApproveRequireInWarranty: string
    autoApproveRequireInWarrantyHelp: string
    businessHours: string
    businessHoursHelp: string
    escalationTiers: string
    escalationTiersHelp: string
    adjudicationUseRules: string
    adjudicationUseRulesHelp: string
    quarantineGrades: string
    quarantineGradesHelp: string
    returnLabelProvider: string
    returnLabelProviderHelp: string
  }
}

type GeneralFieldErrors = {
  businessHours?: string
  businessHoursRowErrors?: Record<string, string>
  escalationTiers?: string
  escalationTierRowErrors?: Record<string, { atPct?: string; toUserId?: string }>
}

const DEFAULT_FORM_VALUES: DictionaryFormValues = {
  value: '',
  label: '',
  color: null,
  icon: null,
}

const SAVE_CONTEXT_ID = 'warranty-claims-settings'
const GENERAL_SETTINGS_FORM_ID = 'warranty-claims-general-settings'
const QUARANTINE_GRADE_OPTIONS = ['A', 'B', 'C', 'D'] as const

const DEFAULT_GENERAL_SETTINGS: GeneralSettingsResult = {
  slaHours: 48,
  slaPauseOnInfoRequested: true,
  slaAtRiskThresholdPct: 75,
  defaultWarrantyMonths: null,
  returnWindowDays: null,
  autoApproveEnabled: false,
  autoApproveMaxAmount: null,
  autoApproveCurrencyCode: null,
  autoApproveRequireInWarranty: true,
  updatedAt: null,
  businessHours: null,
  escalationTiers: null,
  adjudicationUseRules: false,
  quarantineGrades: null,
  returnLabelProvider: null,
}

const SECTIONS: SectionDefinition[] = [
  {
    kind: 'warranty-claim-fault-code',
    dictionaryKey: 'warranty_claims.warranty_claim_fault_code',
    titleKey: 'warranty_claims.settings.dictionary.faultCodes',
    descriptionKey: 'warranty_claims.settings.dictionary.faultCodes.description',
  },
  {
    kind: 'warranty-claim-reason',
    dictionaryKey: 'warranty_claims.warranty_claim_reason',
    titleKey: 'warranty_claims.settings.dictionary.claimReasons',
    descriptionKey: 'warranty_claims.settings.dictionary.claimReasons.description',
  },
  {
    kind: 'warranty-claim-rejection-reason',
    dictionaryKey: 'warranty_claims.warranty_claim_rejection_reason',
    titleKey: 'warranty_claims.settings.dictionary.rejectionReasons',
    descriptionKey: 'warranty_claims.settings.dictionary.rejectionReasons.description',
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

type JsonParseResult<T> =
  | { ok: true; value: T | null }
  | { ok: false }

function parseNullableJsonObject(value: string): JsonParseResult<Record<string, unknown>> {
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (isRecord(parsed)) return { ok: true, value: parsed }
  } catch {
    return { ok: false }
  }
  return { ok: false }
}

let escalationTierRowSeq = 0

function nextEscalationTierRowKey(): string {
  escalationTierRowSeq += 1
  return `escalation-tier-${escalationTierRowSeq}`
}

function buildEscalationTierRows(raw: unknown): EscalationTierRow[] {
  return parseEscalationTiers(raw).map((tier) => ({
    key: nextEscalationTierRowKey(),
    atPct: String(tier.atPct),
    action: tier.action,
    toUserId: tier.toUserId ?? '',
  }))
}

const ESCALATION_TIER_MIN_PCT = 1
const ESCALATION_TIER_MAX_PCT = 1000

type EscalationTierRowsValidation =
  | { ok: true; value: EscalationTier[] | null }
  | { ok: false; rowErrors: Record<string, { atPct?: string; toUserId?: string }> }

function validateEscalationTierRows(
  rows: EscalationTierRow[],
  translations: EscalationTiersFieldTranslations,
): EscalationTierRowsValidation {
  const rowErrors: Record<string, { atPct?: string; toUserId?: string }> = {}
  const parsed: EscalationTier[] = []

  for (const row of rows) {
    const atPctNumber = Number(row.atPct)
    const rowError: { atPct?: string; toUserId?: string } = {}
    if (!Number.isInteger(atPctNumber) || atPctNumber < ESCALATION_TIER_MIN_PCT || atPctNumber > ESCALATION_TIER_MAX_PCT) {
      rowError.atPct = translations.error.atPct
    }
    const toUserId = row.toUserId.trim()
    if (row.action === 'reassign' && !toUserId) {
      rowError.toUserId = translations.error.toUserId
    }
    if (Object.keys(rowError).length) {
      rowErrors[row.key] = rowError
      continue
    }
    parsed.push(row.action === 'reassign' ? { atPct: atPctNumber, action: row.action, toUserId } : { atPct: atPctNumber, action: row.action })
  }

  if (Object.keys(rowErrors).length) return { ok: false, rowErrors }

  const sorted = [...parsed].sort((left, right) => left.atPct - right.atPct)
  return { ok: true, value: sorted.length ? sorted : null }
}

function normalizeEntry(item: unknown): DictionaryTableEntry | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  const value = toStringOrNull(item.value)
  if (!id || !value) return null
  return {
    id,
    value,
    label: toStringOrNull(item.label) ?? value,
    color: toStringOrNull(item.color),
    icon: toStringOrNull(item.icon),
    organizationId: toStringOrNull(item.organizationId),
    tenantId: toStringOrNull(item.tenantId),
    isInherited: item.isInherited === true,
    createdAt: toStringOrNull(item.createdAt),
    updatedAt: toStringOrNull(item.updatedAt),
  }
}

function buildGeneralFormValues(settings: GeneralSettingsResult): GeneralSettingsFormValues {
  return {
    slaHours: String(settings.slaHours),
    slaPauseOnInfoRequested: settings.slaPauseOnInfoRequested,
    slaAtRiskThresholdPct: String(settings.slaAtRiskThresholdPct),
    autoApproveEnabled: settings.autoApproveEnabled,
    autoApproveMaxAmount: settings.autoApproveMaxAmount === null ? '' : String(settings.autoApproveMaxAmount),
    autoApproveCurrencyCode: settings.autoApproveCurrencyCode ?? '',
    autoApproveRequireInWarranty: settings.autoApproveRequireInWarranty,
    defaultWarrantyMonths: settings.defaultWarrantyMonths === null ? '' : String(settings.defaultWarrantyMonths),
    returnWindowDays: settings.returnWindowDays === null ? '' : String(settings.returnWindowDays),
    businessHours: buildBusinessHoursFormValue(settings.businessHours),
    escalationTiers: buildEscalationTierRows(settings.escalationTiers),
    adjudicationUseRules: settings.adjudicationUseRules,
    quarantineGrades: settings.quarantineGrades ?? [],
    returnLabelProvider: settings.returnLabelProvider ?? '',
  }
}

function normalizeCurrencyCodeInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
}

function translateApiErrorMessage(
  call: { result: unknown },
  fallbackMessage: string,
  translate: (key: string, fallback?: string) => string,
): string {
  const payload = isRecord(call.result) ? call.result : {}
  const message = typeof payload.error === 'string' ? payload.error : null
  if (!message) return fallbackMessage
  if (message === 'warranty_claims.errors.autoApproveConfigIncomplete') {
    return translate(message, 'Auto-approve requires both a maximum amount and currency.')
  }
  if (message.startsWith('warranty_claims.')) return translate(message, fallbackMessage)
  return message
}

function buildConflictError(
  call: { status: number; result: unknown },
  fallbackMessage: string,
  translate?: (key: string, fallback?: string) => string,
): Error & Record<string, unknown> {
  const payload = isRecord(call.result) ? call.result : {}
  const message = translate ? translateApiErrorMessage(call, fallbackMessage, translate) : typeof payload.error === 'string' ? payload.error : fallbackMessage
  return Object.assign(new Error(message), { status: call.status }, payload)
}

function errorStatus(error: unknown): number | null {
  return isRecord(error) && typeof error.status === 'number' ? error.status : null
}

function GeneralNumberField({
  id,
  label,
  description,
  value,
  min,
  max,
  step = '1',
  disabled,
  onChange,
}: {
  id: string
  label: string
  description: string
  value: string
  min: number
  max?: number
  step?: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function GeneralTextField({
  id,
  label,
  description,
  value,
  maxLength,
  disabled,
  onChange,
}: {
  id: string
  label: string
  description: string
  value: string
  maxLength?: number
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function GeneralSwitchField({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-background p-4">
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

function BusinessHoursField({
  id,
  label,
  description,
  value,
  rowErrors,
  error,
  disabled,
  translations,
  onChange,
}: {
  id: string
  label: string
  description: string
  value: BusinessHoursFormValue
  rowErrors?: Record<string, string>
  error?: string
  disabled?: boolean
  translations: BusinessHoursFieldTranslations
  onChange: (next: BusinessHoursFormValue) => void
}) {
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const advancedVisible = advancedOpen || value.rawDirty
  const controlsDisabled = disabled || value.rawDirty
  const advancedRegionId = `${id}-advanced`

  const timezoneOptions = React.useMemo<ComboboxOption[]>(() => {
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
    return Array.from(new Set<string>(['UTC', ...zones])).map((zone) => ({ value: zone, label: zone }))
  }, [])

  const applyStructuredChange = React.useCallback((patch: Partial<BusinessHoursFormValue>) => {
    const next = { ...value, ...patch }
    onChange({ ...next, raw: stringifyJsonValue(serializeBusinessHoursRecord(next)), rawDirty: false })
  }, [onChange, value])

  const handleRawChange = React.useCallback((text: string) => {
    const parsed = parseNullableJsonObject(text)
    if (!parsed.ok) {
      onChange({ ...value, raw: text, rawDirty: true })
      return
    }
    onChange({ ...buildBusinessHoursFormValue(parsed.value), raw: text })
  }, [onChange, value])

  const toggleDay = React.useCallback((weekday: BusinessWeekday, enabled: boolean) => {
    applyStructuredChange({
      days: value.days.map((day) => (day.weekday === weekday ? { ...day, enabled } : day)),
    })
  }, [applyStructuredChange, value.days])

  const updateInterval = React.useCallback((weekday: BusinessWeekday, key: string, patch: Partial<Pick<BusinessHoursIntervalRow, 'start' | 'end'>>) => {
    applyStructuredChange({
      days: value.days.map((day) => (day.weekday === weekday
        ? { ...day, intervals: day.intervals.map((interval) => (interval.key === key ? { ...interval, ...patch } : interval)) }
        : day)),
    })
  }, [applyStructuredChange, value.days])

  const addInterval = React.useCallback((weekday: BusinessWeekday) => {
    applyStructuredChange({
      days: value.days.map((day) => (day.weekday === weekday
        ? { ...day, intervals: [...day.intervals, createBusinessHoursIntervalRow('', '')] }
        : day)),
    })
  }, [applyStructuredChange, value.days])

  const removeInterval = React.useCallback((weekday: BusinessWeekday, key: string) => {
    applyStructuredChange({
      days: value.days.map((day) => (day.weekday === weekday
        ? { ...day, intervals: day.intervals.filter((interval) => interval.key !== key) }
        : day)),
    })
  }, [applyStructuredChange, value.days])

  const addHoliday = React.useCallback(() => {
    applyStructuredChange({
      holidays: [...value.holidays, { key: nextBusinessHoursRowKey(), date: '' }],
    })
  }, [applyStructuredChange, value.holidays])

  const updateHoliday = React.useCallback((key: string, date: string) => {
    applyStructuredChange({
      holidays: value.holidays.map((row) => (row.key === key ? { ...row, date } : row)),
    })
  }, [applyStructuredChange, value.holidays])

  const removeHoliday = React.useCallback((key: string) => {
    applyStructuredChange({
      holidays: value.holidays.filter((row) => row.key !== key),
    })
  }, [applyStructuredChange, value.holidays])

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-sm font-medium">{label}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2 sm:max-w-sm">
        <Label htmlFor={`${id}-timezone`}>{translations.timezoneLabel}</Label>
        <ComboboxInput
          value={value.timezone}
          onChange={(timezone) => applyStructuredChange({ timezone })}
          placeholder={translations.timezonePlaceholder}
          suggestions={timezoneOptions}
          allowCustomValues
          clearable
          disabled={controlsDisabled}
        />
        <p className="text-xs text-muted-foreground">{translations.timezoneHelp}</p>
      </div>
      <div className="space-y-2">
        {value.days.map((day) => {
          const dayCheckboxId = `${id}-${day.weekday}-enabled`
          return (
            <div key={day.weekday} className="rounded-md border border-border bg-background p-3">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex w-28 items-center gap-2 pt-1.5">
                  <Checkbox
                    id={dayCheckboxId}
                    checked={day.enabled}
                    disabled={controlsDisabled}
                    onCheckedChange={(checked) => toggleDay(day.weekday, checked === true)}
                  />
                  <Label htmlFor={dayCheckboxId} className="text-sm font-normal">
                    {translations.dayLabels[day.weekday]}
                  </Label>
                </div>
                {day.enabled ? (
                  <div className="flex-1 space-y-2">
                    {day.intervals.map((interval) => {
                      const intervalError = rowErrors?.[interval.key]
                      return (
                        <div key={interval.key} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Input
                              type="time"
                              className="w-32"
                              value={interval.start}
                              disabled={controlsDisabled}
                              aria-label={translations.startLabel}
                              aria-invalid={intervalError ? true : undefined}
                              onChange={(event) => updateInterval(day.weekday, interval.key, { start: event.target.value })}
                            />
                            <span className="text-sm text-muted-foreground" aria-hidden="true">–</span>
                            <Input
                              type="time"
                              className="w-32"
                              value={interval.end}
                              disabled={controlsDisabled}
                              aria-label={translations.endLabel}
                              aria-invalid={intervalError ? true : undefined}
                              onChange={(event) => updateInterval(day.weekday, interval.key, { end: event.target.value })}
                            />
                            {day.intervals.length > 1 ? (
                              <IconButton
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={translations.removeWindow}
                                disabled={controlsDisabled}
                                onClick={() => removeInterval(day.weekday, interval.key)}
                              >
                                <Trash2 className="size-4" aria-hidden="true" />
                              </IconButton>
                            ) : null}
                          </div>
                          {intervalError ? <p className="text-sm text-status-error-text">{intervalError}</p> : null}
                        </div>
                      )
                    })}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={controlsDisabled}
                      onClick={() => addInterval(day.weekday)}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      {translations.addWindow}
                    </Button>
                  </div>
                ) : (
                  <p className="pt-1.5 text-sm text-muted-foreground">{translations.closed}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="space-y-2">
        <div className="space-y-1">
          <Label>{translations.holidaysLabel}</Label>
          <p className="text-xs text-muted-foreground">{translations.holidaysHelp}</p>
        </div>
        {value.holidays.map((row) => {
          const holidayError = rowErrors?.[row.key]
          return (
            <div key={row.key} className="space-y-1">
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  className="w-44"
                  value={row.date}
                  disabled={controlsDisabled}
                  aria-label={translations.holidayDateLabel}
                  aria-invalid={holidayError ? true : undefined}
                  onChange={(event) => updateHoliday(row.key, event.target.value)}
                />
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={translations.removeHoliday}
                  disabled={controlsDisabled}
                  onClick={() => removeHoliday(row.key)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
              {holidayError ? <p className="text-sm text-status-error-text">{holidayError}</p> : null}
            </div>
          )
        })}
        <Button type="button" variant="outline" size="sm" disabled={controlsDisabled} onClick={addHoliday}>
          <Plus className="size-4" aria-hidden="true" />
          {translations.addHoliday}
        </Button>
      </div>
      <div className="space-y-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={advancedVisible}
          aria-controls={advancedRegionId}
          disabled={disabled}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedVisible
            ? <ChevronDown className="size-4" aria-hidden="true" />
            : <ChevronRight className="size-4" aria-hidden="true" />}
          {translations.advancedToggle}
        </Button>
        {advancedVisible ? (
          <div id={advancedRegionId} className="space-y-2">
            <Label htmlFor={`${id}-raw`}>{translations.advancedLabel}</Label>
            <Textarea
              id={`${id}-raw`}
              rows={6}
              value={value.raw}
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              onChange={(event) => handleRawChange(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{translations.advancedHelp}</p>
          </div>
        ) : null}
      </div>
      {error ? <ErrorMessage label={error} /> : null}
    </div>
  )
}

function GeneralQuarantineGradesField({
  id,
  label,
  description,
  selected,
  disabled,
  onToggle,
}: {
  id: string
  label: string
  description: string
  selected: string[]
  disabled?: boolean
  onToggle: (grade: string, checked: boolean) => void
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label id={`${id}-label`}>{label}</Label>
        <p id={`${id}-description`} className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        className="grid gap-2 sm:grid-cols-4"
      >
        {QUARANTINE_GRADE_OPTIONS.map((grade) => {
          const checkboxId = `${id}-${grade.toLowerCase()}`
          return (
            <div
              key={grade}
              className="flex items-center gap-2 rounded-md border border-border bg-background p-3"
            >
              <Checkbox
                id={checkboxId}
                checked={selected.includes(grade)}
                disabled={disabled}
                onCheckedChange={(checked) => onToggle(grade, checked === true)}
              />
              <Label htmlFor={checkboxId} className="text-sm font-normal">
                {grade}
              </Label>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EscalationTiersField({
  id,
  label,
  description,
  rows,
  rowErrors,
  error,
  disabled,
  translations,
  loadStaffOptions,
  resolveStaffLabel,
  onAddRow,
  onRemoveRow,
  onAtPctChange,
  onActionChange,
  onUserChange,
}: {
  id: string
  label: string
  description: string
  rows: EscalationTierRow[]
  rowErrors?: Record<string, { atPct?: string; toUserId?: string }>
  error?: string
  disabled?: boolean
  translations: EscalationTiersFieldTranslations
  loadStaffOptions: (query?: string) => Promise<ComboboxOption[]>
  resolveStaffLabel: (userId: string) => Promise<string>
  onAddRow: () => void
  onRemoveRow: (key: string) => void
  onAtPctChange: (key: string, value: string) => void
  onActionChange: (key: string, value: EscalationTierRow['action']) => void
  onUserChange: (key: string, value: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-sm font-medium">{label}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
          {translations.empty}
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => {
            const rowError = rowErrors?.[row.key]
            const atPctFieldId = `${id}-${row.key}-atPct`
            const actionFieldId = `${id}-${row.key}-action`
            const toUserFieldId = `${id}-${row.key}-toUserId`
            return (
              <div key={row.key} className="space-y-3 rounded-md border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <h5 className="text-sm font-medium">{translations.rowLabel(index + 1)}</h5>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={translations.removeRow}
                    disabled={disabled}
                    onClick={() => onRemoveRow(row.key)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor={atPctFieldId}>{translations.atPctLabel}</Label>
                    <Input
                      id={atPctFieldId}
                      type="number"
                      min={ESCALATION_TIER_MIN_PCT}
                      max={ESCALATION_TIER_MAX_PCT}
                      value={row.atPct}
                      disabled={disabled}
                      aria-invalid={rowError?.atPct ? true : undefined}
                      onChange={(event) => onAtPctChange(row.key, event.target.value)}
                    />
                    {rowError?.atPct ? <p className="text-sm text-status-error-text">{rowError.atPct}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={actionFieldId}>{translations.actionLabel}</Label>
                    <Select
                      value={row.action}
                      onValueChange={(value) => onActionChange(row.key, value === 'reassign' ? 'reassign' : 'notify')}
                    >
                      <SelectTrigger id={actionFieldId} disabled={disabled}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="notify">{translations.actionNotify}</SelectItem>
                        <SelectItem value="reassign">{translations.actionReassign}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {row.action === 'reassign' ? (
                    <div className="space-y-2">
                      <Label htmlFor={toUserFieldId}>{translations.toUserLabel}</Label>
                      <ComboboxInput
                        value={row.toUserId}
                        onChange={(value) => onUserChange(row.key, value)}
                        placeholder={translations.toUserPlaceholder}
                        loadSuggestions={loadStaffOptions}
                        resolveLabel={resolveStaffLabel}
                        allowCustomValues={false}
                        disabled={disabled}
                      />
                      {rowError?.toUserId ? <p className="text-sm text-status-error-text">{rowError.toUserId}</p> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onAddRow}>
        <Plus className="size-4" aria-hidden="true" />
        {translations.addRow}
      </Button>
      {error ? <ErrorMessage label={error} /> : null}
    </div>
  )
}

function GeneralSettingsSubsection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </div>
  )
}

export default function WarrantyClaimSettingsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [entriesByKind, setEntriesByKind] = React.useState<Record<WarrantyDictionaryKind, DictionaryTableEntry[]>>({
    'warranty-claim-fault-code': [],
    'warranty-claim-reason': [],
    'warranty-claim-rejection-reason': [],
  })
  const [dictionaryIds, setDictionaryIds] = React.useState<Record<WarrantyDictionaryKind, string | null>>({
    'warranty-claim-fault-code': null,
    'warranty-claim-reason': null,
    'warranty-claim-rejection-reason': null,
  })
  const [loadingKind, setLoadingKind] = React.useState<Record<WarrantyDictionaryKind, boolean>>({
    'warranty-claim-fault-code': false,
    'warranty-claim-reason': false,
    'warranty-claim-rejection-reason': false,
  })
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [generalSettings, setGeneralSettings] = React.useState<GeneralSettingsResult | null>(null)
  const [generalForm, setGeneralForm] = React.useState<GeneralSettingsFormValues>(() => buildGeneralFormValues(DEFAULT_GENERAL_SETTINGS))
  const [generalLoading, setGeneralLoading] = React.useState(true)
  const [generalSaving, setGeneralSaving] = React.useState(false)
  const [generalLoadError, setGeneralLoadError] = React.useState<string | null>(null)
  const [generalSaveError, setGeneralSaveError] = React.useState<string | null>(null)
  const [generalFieldErrors, setGeneralFieldErrors] = React.useState<GeneralFieldErrors>({})

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: SAVE_CONTEXT_ID,
    blockedMessage: t('warranty_claims.common.saveBlocked'),
  })
  const mutationContext = React.useMemo(() => ({
    formId: SAVE_CONTEXT_ID,
    resourceKind: 'warranty_claims.dictionaries',
    retryLastMutation,
  }), [retryLastMutation])

  const generalMutationContext = React.useMemo(() => ({
    formId: GENERAL_SETTINGS_FORM_ID,
    resourceKind: 'warranty_claims.settings',
    retryLastMutation,
  }), [retryLastMutation])

  const generalTranslations = React.useMemo<GeneralSettingsTranslations>(() => ({
    title: t('warranty_claims.settings.general.title', 'General'),
    description: t('warranty_claims.settings.general.description', 'Configure SLA timing and light auto-approval defaults for warranty claims.'),
    loading: t('warranty_claims.settings.general.loading', 'Loading general settings...'),
    saveError: t('warranty_claims.settings.general.error.save', 'Failed to save general settings.'),
    loadError: t('warranty_claims.settings.general.error.load', 'Failed to load general settings.'),
    invalidError: t('warranty_claims.settings.general.error.invalid', 'Review the highlighted numeric and currency limits.'),
    success: t('warranty_claims.settings.general.success.save', 'General settings saved.'),
    refresh: t('warranty_claims.settings.general.actions.refresh', 'Refresh'),
    save: t('warranty_claims.settings.general.actions.save', 'Save settings'),
    saving: t('warranty_claims.settings.general.actions.saving', 'Saving...'),
    sections: {
      slaEscalation: t('warranty_claims.settings.general.sections.slaEscalation', 'SLA escalation'),
      adjudication: t('warranty_claims.settings.general.sections.adjudication', 'Adjudication'),
      receiving: t('warranty_claims.settings.general.sections.receiving', 'Receiving'),
      returns: t('warranty_claims.settings.general.sections.returns', 'Returns'),
    },
    jsonErrors: {
      businessHours: t('warranty_claims.settings.general.error.businessHoursJson', 'Invalid business hours JSON'),
      escalationTiers: t('warranty_claims.settings.general.error.escalationTiersInvalid', 'Fix the highlighted escalation tier rows.'),
    },
    fields: {
      slaHours: t('warranty_claims.settings.general.fields.slaHours.label', 'SLA hours'),
      slaHoursHelp: t('warranty_claims.settings.general.fields.slaHours.help', 'Target response window in hours, from 1 to 8760.'),
      slaPauseOnInfoRequested: t('warranty_claims.settings.general.fields.slaPauseOnInfoRequested.label', 'Pause SLA while info is requested'),
      slaPauseOnInfoRequestedHelp: t('warranty_claims.settings.general.fields.slaPauseOnInfoRequested.help', 'Stop the SLA clock when a claim waits on customer information.'),
      slaAtRiskThresholdPct: t('warranty_claims.settings.general.fields.slaAtRiskThresholdPct.label', 'SLA at-risk threshold'),
      slaAtRiskThresholdPctHelp: t('warranty_claims.settings.general.fields.slaAtRiskThresholdPct.help', 'Percent of the SLA window elapsed before a claim is marked at risk.'),
      defaultWarrantyMonths: t('warranty_claims.settings.general.fields.defaultWarrantyMonths.label', 'Default warranty months'),
      defaultWarrantyMonthsHelp: t('warranty_claims.settings.general.fields.defaultWarrantyMonths.help', 'Prefills warranty months on new claim lines and estimates portal entitlement. Leave empty to disable.'),
      returnWindowDays: t('warranty_claims.settings.returnWindowDays.label', 'Return window (days)'),
      returnWindowDaysHelp: t('warranty_claims.settings.returnWindowDays.help', 'Flag return and core-return claims submitted after this many days from order placement. Leave empty to disable.'),
      autoApproveEnabled: t('warranty_claims.settings.general.fields.autoApproveEnabled.label', 'Enable auto-approve'),
      autoApproveEnabledHelp: t('warranty_claims.settings.general.fields.autoApproveEnabled.help', 'Automatically approve eligible submitted claims when all configured limits match.'),
      autoApproveMaxAmount: t('warranty_claims.settings.general.fields.autoApproveMaxAmount.label', 'Auto-approve max amount'),
      autoApproveMaxAmountHelp: t('warranty_claims.settings.general.fields.autoApproveMaxAmount.help', 'Maximum claimed total allowed for auto-approval.'),
      autoApproveCurrencyCode: t('warranty_claims.settings.general.fields.autoApproveCurrencyCode.label', 'Auto-approve currency'),
      autoApproveCurrencyCodeHelp: t('warranty_claims.settings.general.fields.autoApproveCurrencyCode.help', 'Three-letter uppercase currency code used by the auto-approval limit.'),
      autoApproveRequireInWarranty: t('warranty_claims.settings.general.fields.autoApproveRequireInWarranty.label', 'Require in-warranty lines'),
      autoApproveRequireInWarrantyHelp: t('warranty_claims.settings.general.fields.autoApproveRequireInWarranty.help', 'Only auto-approve when every line is still in warranty.'),
      businessHours: t('warranty_claims.settings.general.fields.businessHoursEditor.label', 'Business hours'),
      businessHoursHelp: t('warranty_claims.settings.general.fields.businessHoursEditor.help', 'Working windows per weekday used by SLA timing. Leave every day unchecked to count wall-clock time.'),
      escalationTiers: t('warranty_claims.settings.general.fields.escalationTiersEditor.label', 'Escalation tiers'),
      escalationTiersHelp: t('warranty_claims.settings.general.fields.escalationTiersEditor.help', 'Notify or reassign a claim once its SLA has elapsed past a percentage threshold. Tiers apply in ascending order. Leave empty to disable.'),
      adjudicationUseRules: t('warranty_claims.settings.general.fields.adjudicationUseRules.label', 'Use business rules for adjudication'),
      adjudicationUseRulesHelp: t('warranty_claims.settings.general.fields.adjudicationUseRules.help', 'When on and the business_rules module is present, claim submission is evaluated by the rule engine; otherwise the built-in light rule is used.'),
      quarantineGrades: t('warranty_claims.settings.general.fields.quarantineGrades.label', 'Quarantine grades'),
      quarantineGradesHelp: t('warranty_claims.settings.general.fields.quarantineGrades.help', 'Grades that automatically hold a claim on receiving.'),
      returnLabelProvider: t('warranty_claims.settings.general.fields.returnLabelProvider.label', 'Return label provider'),
      returnLabelProviderHelp: t('warranty_claims.settings.general.fields.returnLabelProvider.help', 'Optional provider key for the return-label seam. Leave empty for manual entry only.'),
    },
    escalationTiers: {
      rowLabel: (index: number) => t('warranty_claims.settings.general.escalationTiers.rowLabel', 'Tier {number}', { number: index }),
      atPctLabel: t('warranty_claims.settings.general.escalationTiers.atPctLabel', 'SLA elapsed (%)'),
      actionLabel: t('warranty_claims.settings.general.escalationTiers.actionLabel', 'Action'),
      actionNotify: t('warranty_claims.settings.general.escalationTiers.action.notify', 'Notify'),
      actionReassign: t('warranty_claims.settings.general.escalationTiers.action.reassign', 'Reassign'),
      toUserLabel: t('warranty_claims.settings.general.escalationTiers.toUserLabel', 'Reassign to'),
      toUserPlaceholder: t('warranty_claims.settings.general.escalationTiers.toUserPlaceholder', 'Search staff'),
      addRow: t('warranty_claims.settings.general.escalationTiers.addRow', 'Add tier'),
      removeRow: t('warranty_claims.settings.general.escalationTiers.removeRow', 'Remove tier'),
      empty: t('warranty_claims.settings.general.escalationTiers.empty', 'No escalation tiers configured. Claims will not auto-escalate.'),
      error: {
        atPct: t('warranty_claims.settings.general.escalationTiers.error.atPct', 'Enter a whole number between 1 and 1000.'),
        toUserId: t('warranty_claims.settings.general.escalationTiers.error.toUserId', 'Select a staff member to reassign to.'),
      },
    },
    businessHours: {
      dayLabels: {
        mon: t('warranty_claims.settings.general.businessHours.day.mon', 'Monday'),
        tue: t('warranty_claims.settings.general.businessHours.day.tue', 'Tuesday'),
        wed: t('warranty_claims.settings.general.businessHours.day.wed', 'Wednesday'),
        thu: t('warranty_claims.settings.general.businessHours.day.thu', 'Thursday'),
        fri: t('warranty_claims.settings.general.businessHours.day.fri', 'Friday'),
        sat: t('warranty_claims.settings.general.businessHours.day.sat', 'Saturday'),
        sun: t('warranty_claims.settings.general.businessHours.day.sun', 'Sunday'),
      },
      timezoneLabel: t('warranty_claims.settings.general.businessHours.timezoneLabel', 'Timezone'),
      timezonePlaceholder: t('warranty_claims.settings.general.businessHours.timezonePlaceholder', 'UTC'),
      timezoneHelp: t('warranty_claims.settings.general.businessHours.timezoneHelp', 'IANA timezone the weekly windows are evaluated in. Leave empty for UTC.'),
      startLabel: t('warranty_claims.settings.general.businessHours.startLabel', 'Opens at'),
      endLabel: t('warranty_claims.settings.general.businessHours.endLabel', 'Closes at'),
      addWindow: t('warranty_claims.settings.general.businessHours.addWindow', 'Add window'),
      removeWindow: t('warranty_claims.settings.general.businessHours.removeWindow', 'Remove window'),
      closed: t('warranty_claims.settings.general.businessHours.closed', 'Closed'),
      holidaysLabel: t('warranty_claims.settings.general.businessHours.holidaysLabel', 'Holidays'),
      holidaysHelp: t('warranty_claims.settings.general.businessHours.holidaysHelp', 'Dates skipped entirely when counting SLA business hours.'),
      addHoliday: t('warranty_claims.settings.general.businessHours.addHoliday', 'Add holiday'),
      removeHoliday: t('warranty_claims.settings.general.businessHours.removeHoliday', 'Remove holiday'),
      holidayDateLabel: t('warranty_claims.settings.general.businessHours.holidayDateLabel', 'Holiday date'),
      advancedToggle: t('warranty_claims.settings.general.businessHours.advancedToggle', 'Advanced: edit raw JSON'),
      advancedLabel: t('warranty_claims.settings.general.fields.businessHours.label', 'Business hours JSON'),
      advancedHelp: t('warranty_claims.settings.general.fields.businessHours.help', 'Shape: { timezone, week: { mon:[{start,end}], ... }, holidays:[...] }. Leave empty to disable.'),
      error: {
        window: t('warranty_claims.settings.general.businessHours.error.window', 'Enter a start time earlier than the end time.'),
        holiday: t('warranty_claims.settings.general.businessHours.error.holiday', 'Pick a holiday date.'),
        rows: t('warranty_claims.settings.general.businessHours.error.rows', 'Fix the highlighted business hours entries.'),
      },
    },
  }), [t])

  const applyGeneralSettings = React.useCallback((settings: GeneralSettingsResult) => {
    setGeneralSettings(settings)
    setGeneralForm(buildGeneralFormValues(settings))
    setGeneralFieldErrors({})
  }, [])

  const loadGeneralSettings = React.useCallback(async () => {
    setGeneralLoading(true)
    setGeneralLoadError(null)
    try {
      const call = await apiCall<GeneralSettingsEnvelope>('/api/warranty_claims/settings-general')
      const settings = call.result?.result ?? null
      if (!call.ok || !settings) {
        setGeneralLoadError(translateApiErrorMessage(call, generalTranslations.loadError, t))
        return
      }
      applyGeneralSettings(settings)
      setGeneralSaveError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : generalTranslations.loadError
      setGeneralLoadError(message)
    } finally {
      setGeneralLoading(false)
    }
  }, [applyGeneralSettings, generalTranslations.loadError, t])

  const updateGeneralForm = React.useCallback((patch: Partial<GeneralSettingsFormValues>) => {
    setGeneralForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const updateBusinessHours = React.useCallback((next: BusinessHoursFormValue) => {
    setGeneralForm((prev) => ({ ...prev, businessHours: next }))
    setGeneralFieldErrors((prev) => {
      if (!prev.businessHours && !prev.businessHoursRowErrors) return prev
      return { ...prev, businessHours: undefined, businessHoursRowErrors: undefined }
    })
  }, [])

  const staffOptionLabel = React.useCallback((member: AssignableStaffMember): string => (
    member.email && member.email !== member.displayName
      ? `${member.displayName} (${member.email})`
      : member.displayName
  ), [])

  const loadEscalationStaffOptions = React.useCallback(async (query?: string): Promise<ComboboxOption[]> => {
    const page = await fetchAssignableStaffMembersPage(query ?? '', { pageSize: 24 })
    return page.items.map((member) => ({ value: member.userId, label: staffOptionLabel(member) }))
  }, [staffOptionLabel])

  const resolveStaffUserLabel = React.useCallback(async (userId: string): Promise<string> => {
    const unknownUserLabel = t('warranty_claims.detail.unknownUser')
    const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      `/api/auth/users?ids=${encodeURIComponent(userId)}`,
    )
    if (!response.ok || !response.result) return unknownUserLabel
    const user = (response.result.items ?? [])[0]
    if (!user) return unknownUserLabel
    const displayName = toStringOrNull(user.display_name)
      ?? toStringOrNull(user.displayName)
      ?? toStringOrNull(user.name)
    return displayName ?? toStringOrNull(user.email) ?? unknownUserLabel
  }, [t])

  const addEscalationTierRow = React.useCallback(() => {
    setGeneralForm((prev) => ({
      ...prev,
      escalationTiers: [
        ...prev.escalationTiers,
        { key: nextEscalationTierRowKey(), atPct: '', action: 'notify', toUserId: '' },
      ],
    }))
  }, [])

  const clearEscalationTierRowError = React.useCallback((key: string, field: 'atPct' | 'toUserId') => {
    setGeneralFieldErrors((prev) => {
      if (!prev.escalationTierRowErrors?.[key]?.[field]) return prev
      const nextRowErrors = { ...prev.escalationTierRowErrors, [key]: { ...prev.escalationTierRowErrors[key], [field]: undefined } }
      const hasRemainingErrors = Object.values(nextRowErrors).some((rowError) => rowError?.atPct || rowError?.toUserId)
      return { ...prev, escalationTierRowErrors: nextRowErrors, escalationTiers: hasRemainingErrors ? prev.escalationTiers : undefined }
    })
  }, [])

  const removeEscalationTierRow = React.useCallback((key: string) => {
    setGeneralForm((prev) => ({
      ...prev,
      escalationTiers: prev.escalationTiers.filter((row) => row.key !== key),
    }))
    setGeneralFieldErrors((prev) => {
      if (!prev.escalationTierRowErrors?.[key]) return prev
      const nextRowErrors = { ...prev.escalationTierRowErrors }
      delete nextRowErrors[key]
      const hasRemainingErrors = Object.values(nextRowErrors).some((rowError) => rowError?.atPct || rowError?.toUserId)
      return { ...prev, escalationTierRowErrors: nextRowErrors, escalationTiers: hasRemainingErrors ? prev.escalationTiers : undefined }
    })
  }, [])

  const updateEscalationTierAtPct = React.useCallback((key: string, value: string) => {
    setGeneralForm((prev) => ({
      ...prev,
      escalationTiers: prev.escalationTiers.map((row) => (row.key === key ? { ...row, atPct: value } : row)),
    }))
    clearEscalationTierRowError(key, 'atPct')
  }, [clearEscalationTierRowError])

  const updateEscalationTierAction = React.useCallback((key: string, value: EscalationTierRow['action']) => {
    setGeneralForm((prev) => ({
      ...prev,
      escalationTiers: prev.escalationTiers.map((row) => (row.key === key ? { ...row, action: value } : row)),
    }))
    clearEscalationTierRowError(key, 'toUserId')
  }, [clearEscalationTierRowError])

  const updateEscalationTierUser = React.useCallback((key: string, value: string) => {
    setGeneralForm((prev) => ({
      ...prev,
      escalationTiers: prev.escalationTiers.map((row) => (row.key === key ? { ...row, toUserId: value } : row)),
    }))
    clearEscalationTierRowError(key, 'toUserId')
  }, [clearEscalationTierRowError])

  const handleGeneralSubmit = React.useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setGeneralSaveError(null)
    setGeneralFieldErrors({})

    const slaHours = Number(generalForm.slaHours)
    const slaAtRiskThresholdPct = Number(generalForm.slaAtRiskThresholdPct)
    const amountText = generalForm.autoApproveMaxAmount.trim()
    const autoApproveMaxAmount = amountText.length ? Number(amountText) : null
    const warrantyMonthsText = generalForm.defaultWarrantyMonths.trim()
    const defaultWarrantyMonths = warrantyMonthsText.length ? Number(warrantyMonthsText) : null
    const returnWindowDaysText = generalForm.returnWindowDays.trim()
    const returnWindowDays = returnWindowDaysText.length ? Number(returnWindowDaysText) : null
    const currencyCode = toStringOrNull(generalForm.autoApproveCurrencyCode)?.toUpperCase() ?? null
    const businessHoursResult = validateBusinessHoursValue(generalForm.businessHours, generalTranslations.businessHours)
    const escalationTiersResult = validateEscalationTierRows(generalForm.escalationTiers, generalTranslations.escalationTiers)
    const returnLabelProvider = toStringOrNull(generalForm.returnLabelProvider)
    const quarantineGrades = Array.from(new Set(
      generalForm.quarantineGrades
        .map((grade) => grade.trim())
        .filter((grade) => grade.length > 0),
    ))

    if (!businessHoursResult.ok || !escalationTiersResult.ok) {
      setGeneralFieldErrors({
        businessHours: businessHoursResult.ok
          ? undefined
          : businessHoursResult.reason === 'json'
            ? generalTranslations.jsonErrors.businessHours
            : generalTranslations.businessHours.error.rows,
        businessHoursRowErrors: !businessHoursResult.ok && businessHoursResult.reason === 'rows'
          ? businessHoursResult.rowErrors
          : undefined,
        escalationTiers: escalationTiersResult.ok ? undefined : generalTranslations.jsonErrors.escalationTiers,
        escalationTierRowErrors: escalationTiersResult.ok ? undefined : escalationTiersResult.rowErrors,
      })
      return
    }

    if (
      !Number.isInteger(slaHours) ||
      slaHours < 1 ||
      slaHours > 8760 ||
      !Number.isInteger(slaAtRiskThresholdPct) ||
      slaAtRiskThresholdPct < 1 ||
      slaAtRiskThresholdPct > 100 ||
      (autoApproveMaxAmount !== null && (!Number.isFinite(autoApproveMaxAmount) || autoApproveMaxAmount < 0)) ||
      (defaultWarrantyMonths !== null && (!Number.isInteger(defaultWarrantyMonths) || defaultWarrantyMonths < 0 || defaultWarrantyMonths > 600)) ||
      (returnWindowDays !== null && (!Number.isInteger(returnWindowDays) || returnWindowDays < 1 || returnWindowDays > 3650)) ||
      (currencyCode !== null && !/^[A-Z]{3}$/.test(currencyCode))
    ) {
      setGeneralSaveError(generalTranslations.invalidError)
      return
    }

    const payload = {
      slaHours,
      slaPauseOnInfoRequested: generalForm.slaPauseOnInfoRequested,
      slaAtRiskThresholdPct,
      autoApproveEnabled: generalForm.autoApproveEnabled,
      autoApproveMaxAmount,
      autoApproveCurrencyCode: currencyCode,
      autoApproveRequireInWarranty: generalForm.autoApproveRequireInWarranty,
      defaultWarrantyMonths,
      returnWindowDays,
      businessHours: businessHoursResult.value,
      escalationTiers: escalationTiersResult.value,
      adjudicationUseRules: generalForm.adjudicationUseRules,
      quarantineGrades,
      returnLabelProvider,
    }

    setGeneralSaving(true)
    try {
      await runMutation({
        operation: async () => {
          const save = () => apiCall<GeneralSettingsEnvelope>('/api/warranty_claims/settings-general', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const updatedAt = generalSettings?.updatedAt ?? null
          const call = updatedAt
            ? await withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), save)
            : await save()
          if (!call.ok) throw buildConflictError(call, generalTranslations.saveError, t)
          const settings = call.result?.result ?? null
          if (!settings) throw new Error(generalTranslations.saveError)
          return settings
        },
        context: generalMutationContext,
        mutationPayload: payload,
      })
      flash(generalTranslations.success, 'success')
      await loadGeneralSettings()
    } catch (err) {
      if (errorStatus(err) === 409) return
      const message = err instanceof Error ? err.message : generalTranslations.saveError
      setGeneralSaveError(message)
      flash(message, 'error')
    } finally {
      setGeneralSaving(false)
    }
  }, [
    generalForm,
    generalMutationContext,
    generalSettings?.updatedAt,
    generalTranslations.businessHours,
    generalTranslations.escalationTiers,
    generalTranslations.invalidError,
    generalTranslations.jsonErrors.businessHours,
    generalTranslations.jsonErrors.escalationTiers,
    generalTranslations.saveError,
    generalTranslations.success,
    loadGeneralSettings,
    runMutation,
    t,
  ])

  React.useEffect(() => {
    void loadGeneralSettings()
  }, [loadGeneralSettings, scopeVersion])

  const loadEntries = React.useCallback(async (section: SectionDefinition) => {
    setLoadingKind((prev) => ({ ...prev, [section.kind]: true }))
    try {
      const dictionaries = await readApiResultOrThrow<{ items?: DictionaryListItem[] }>(
        '/api/dictionaries',
        undefined,
        {
          fallback: { items: [] },
          errorMessage: t('warranty_claims.settings.error.load'),
        },
      )
      const dictionary = (dictionaries.items ?? []).find((item) => item.key === section.dictionaryKey)
      const dictionaryId = dictionary?.id ?? null
      setDictionaryIds((prev) => ({ ...prev, [section.kind]: dictionaryId }))
      if (!dictionaryId) {
        setEntriesByKind((prev) => ({ ...prev, [section.kind]: [] }))
        return
      }
      const entries = await readApiResultOrThrow<{ items?: unknown[] }>(
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        undefined,
        {
          fallback: { items: [] },
          errorMessage: t('warranty_claims.settings.error.load'),
        },
      )
      setEntriesByKind((prev) => ({
        ...prev,
        [section.kind]: (entries.items ?? [])
          .map(normalizeEntry)
          .filter((entry): entry is DictionaryTableEntry => entry !== null),
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('warranty_claims.settings.error.load')
      flash(message, 'error')
    } finally {
      setLoadingKind((prev) => ({ ...prev, [section.kind]: false }))
    }
  }, [t])

  React.useEffect(() => {
    for (const section of SECTIONS) {
      void loadEntries(section)
    }
  }, [loadEntries, scopeVersion])

  const tableTranslations = React.useMemo(() => ({
    valueColumn: t('warranty_claims.settings.table.value'),
    labelColumn: t('warranty_claims.settings.table.label'),
    appearanceColumn: t('warranty_claims.settings.table.appearance'),
    addLabel: t('warranty_claims.settings.actions.add'),
    editLabel: t('warranty_claims.settings.actions.edit'),
    deleteLabel: t('warranty_claims.settings.actions.delete'),
    refreshLabel: t('warranty_claims.settings.actions.refresh'),
    inheritedLabel: t('warranty_claims.settings.table.inherited'),
    inheritedTooltip: t('warranty_claims.settings.table.inheritedTooltip'),
    emptyLabel: t('warranty_claims.settings.table.empty'),
    searchPlaceholder: t('warranty_claims.settings.table.search'),
  }), [t])

  const formTranslations = React.useMemo(() => ({
    createTitle: t('warranty_claims.settings.dialog.createTitle'),
    editTitle: t('warranty_claims.settings.dialog.editTitle'),
    valueLabel: t('warranty_claims.settings.dialog.valueLabel'),
    labelLabel: t('warranty_claims.settings.dialog.labelLabel'),
    saveLabel: t('warranty_claims.settings.dialog.save'),
    cancelLabel: t('warranty_claims.settings.dialog.cancel'),
    appearance: {
      colorLabel: t('warranty_claims.settings.dialog.colorLabel'),
      colorHelp: t('warranty_claims.settings.dialog.colorHelp'),
      colorClearLabel: t('warranty_claims.settings.dialog.colorClear'),
      iconLabel: t('warranty_claims.settings.dialog.iconLabel'),
      iconPlaceholder: t('warranty_claims.settings.dialog.iconPlaceholder'),
      iconPickerTriggerLabel: t('warranty_claims.settings.dialog.iconBrowse'),
      iconSearchPlaceholder: t('warranty_claims.settings.dialog.iconSearchPlaceholder'),
      iconSearchEmptyLabel: t('warranty_claims.settings.dialog.iconSearchEmpty'),
      iconSuggestionsLabel: t('warranty_claims.settings.dialog.iconSuggestions'),
      iconClearLabel: t('warranty_claims.settings.dialog.iconClear'),
      previewEmptyLabel: t('warranty_claims.settings.dialog.previewEmpty'),
    },
  }), [t])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
  }, [])

  const startCreate = React.useCallback((kind: WarrantyDictionaryKind) => {
    setDialog({ mode: 'create', kind })
  }, [])

  const startEdit = React.useCallback((kind: WarrantyDictionaryKind, entry: DictionaryTableEntry) => {
    setDialog({ mode: 'edit', kind, entry })
  }, [])

  const sectionByKind = React.useCallback((kind: WarrantyDictionaryKind) => {
    return SECTIONS.find((section) => section.kind === kind) ?? null
  }, [])

  const deleteEntry = React.useCallback(async (kind: WarrantyDictionaryKind, entry: DictionaryTableEntry) => {
    const section = sectionByKind(kind)
    const dictionaryId = dictionaryIds[kind]
    if (!section || !dictionaryId) return
    const confirmed = await confirm({
      title: t('warranty_claims.settings.confirm.delete', undefined, { value: entry.label || entry.value }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      let conflictSurfaced = false
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(entry.updatedAt),
            () => apiCall(`/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entry.id)}`, {
              method: 'DELETE',
            }),
          )
          if (!call.ok) {
            const errorObject = buildConflictError(call, t('warranty_claims.settings.error.save'))
            if (surfaceRecordConflict(errorObject, t, { onRefresh: () => { void loadEntries(section) } })) {
              conflictSurfaced = true
              return call
            }
            await raiseCrudError(call.response, t('warranty_claims.settings.error.delete'))
          }
          return call
        },
        context: mutationContext,
        mutationPayload: { action: 'delete', kind, id: entry.id },
      })
      if (conflictSurfaced) return
      flash(t('warranty_claims.settings.success.delete'), 'success')
      await loadEntries(section)
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: () => { void loadEntries(section) } })) return
      const message = err instanceof Error ? err.message : t('warranty_claims.settings.error.delete')
      flash(message, 'error')
    }
  }, [confirm, dictionaryIds, loadEntries, mutationContext, runMutation, sectionByKind, t])

  const submitForm = React.useCallback(async (values: DictionaryFormValues) => {
    if (!dialog) return
    const section = sectionByKind(dialog.kind)
    const dictionaryId = dictionaryIds[dialog.kind]
    if (!section || !dictionaryId) return
    setSubmitting(true)
    try {
      if (dialog.mode === 'create') {
        await runMutation({
          operation: async () => {
            const call = await apiCall(`/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(values),
            })
            if (!call.ok) await raiseCrudError(call.response, t('warranty_claims.settings.error.save'))
            return call
          },
          context: mutationContext,
          mutationPayload: { action: 'create', kind: dialog.kind, ...values },
        })
      } else {
        const entry = dialog.entry
        const payload: Record<string, unknown> = {}
        if (values.value !== entry.value) payload.value = values.value
        if (values.label !== entry.label) payload.label = values.label
        if ((values.color ?? null) !== (entry.color ?? null)) payload.color = values.color ?? null
        if ((values.icon ?? null) !== (entry.icon ?? null)) payload.icon = values.icon ?? null
        let conflictSurfaced = false
        await runMutation({
          operation: async () => {
            const call = await withScopedApiRequestHeaders(
              buildOptimisticLockHeader(entry.updatedAt),
              () => apiCall(`/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entry.id)}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              }),
            )
            if (!call.ok) {
              const errorObject = buildConflictError(call, t('warranty_claims.settings.error.save'))
              if (surfaceRecordConflict(errorObject, t, { onRefresh: () => { void loadEntries(section) } })) {
                conflictSurfaced = true
                return call
              }
              await raiseCrudError(call.response, t('warranty_claims.settings.error.save'))
            }
            return call
          },
          context: mutationContext,
          mutationPayload: { action: 'update', kind: dialog.kind, id: entry.id, ...payload },
        })
        if (conflictSurfaced) return
      }
      flash(t('warranty_claims.settings.success.save'), 'success')
      closeDialog()
      await loadEntries(section)
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: () => { void loadEntries(section) } })) return
      const message = err instanceof Error ? err.message : t('warranty_claims.settings.error.save')
      flash(message, 'error')
      throw err instanceof Error ? err : new Error(message)
    } finally {
      setSubmitting(false)
    }
  }, [closeDialog, dialog, dictionaryIds, loadEntries, mutationContext, runMutation, sectionByKind, t])

  const currentValues = React.useMemo<DictionaryFormValues>(() => {
    if (dialog?.mode === 'edit') {
      return {
        value: dialog.entry.value,
        label: dialog.entry.label,
        color: dialog.entry.color,
        icon: dialog.entry.icon,
      }
    }
    return DEFAULT_FORM_VALUES
  }, [dialog])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
            <div className="space-y-1 border-b border-border px-6 py-4">
              <h2 className="text-lg font-medium">{generalTranslations.title}</h2>
              <p className="text-sm text-muted-foreground">{generalTranslations.description}</p>
            </div>
            <div className="px-6 py-4">
              {generalLoading ? (
                <LoadingMessage label={generalTranslations.loading} />
              ) : generalLoadError ? (
                <ErrorMessage
                  label={generalLoadError}
                  action={(
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { void loadGeneralSettings() }}
                    >
                      <RefreshCw className="size-4" aria-hidden="true" />
                      {generalTranslations.refresh}
                    </Button>
                  )}
                />
              ) : (
                <form id={GENERAL_SETTINGS_FORM_ID} className="space-y-6" onSubmit={handleGeneralSubmit}>
                  {generalSaveError ? <ErrorMessage label={generalSaveError} /> : null}
                  <div className="grid gap-4 md:grid-cols-3">
                    <GeneralNumberField
                      id="warranty-claims-sla-hours"
                      label={generalTranslations.fields.slaHours}
                      description={generalTranslations.fields.slaHoursHelp}
                      value={generalForm.slaHours}
                      min={1}
                      max={8760}
                      disabled={generalSaving}
                      onChange={(value) => updateGeneralForm({ slaHours: value })}
                    />
                    <GeneralNumberField
                      id="warranty-claims-sla-threshold"
                      label={generalTranslations.fields.slaAtRiskThresholdPct}
                      description={generalTranslations.fields.slaAtRiskThresholdPctHelp}
                      value={generalForm.slaAtRiskThresholdPct}
                      min={1}
                      max={100}
                      disabled={generalSaving}
                      onChange={(value) => updateGeneralForm({ slaAtRiskThresholdPct: value })}
                    />
                    <GeneralNumberField
                      id="warranty-claims-default-warranty-months"
                      label={generalTranslations.fields.defaultWarrantyMonths}
                      description={generalTranslations.fields.defaultWarrantyMonthsHelp}
                      value={generalForm.defaultWarrantyMonths}
                      min={0}
                      max={600}
                      disabled={generalSaving}
                      onChange={(value) => updateGeneralForm({ defaultWarrantyMonths: value })}
                    />
                    <GeneralNumberField
                      id="warranty-claims-return-window-days"
                      label={generalTranslations.fields.returnWindowDays}
                      description={generalTranslations.fields.returnWindowDaysHelp}
                      value={generalForm.returnWindowDays}
                      min={1}
                      max={3650}
                      disabled={generalSaving}
                      onChange={(value) => updateGeneralForm({ returnWindowDays: value })}
                    />
                    <GeneralSwitchField
                      id="warranty-claims-sla-pause"
                      label={generalTranslations.fields.slaPauseOnInfoRequested}
                      description={generalTranslations.fields.slaPauseOnInfoRequestedHelp}
                      checked={generalForm.slaPauseOnInfoRequested}
                      disabled={generalSaving}
                      onCheckedChange={(checked) => updateGeneralForm({ slaPauseOnInfoRequested: checked })}
                    />
                  </div>

                  <GeneralSettingsSubsection title={generalTranslations.sections.slaEscalation}>
                    <div className="space-y-4">
                      <BusinessHoursField
                        id="warranty-claims-business-hours"
                        label={generalTranslations.fields.businessHours}
                        description={generalTranslations.fields.businessHoursHelp}
                        value={generalForm.businessHours}
                        rowErrors={generalFieldErrors.businessHoursRowErrors}
                        error={generalFieldErrors.businessHours}
                        disabled={generalSaving}
                        translations={generalTranslations.businessHours}
                        onChange={updateBusinessHours}
                      />
                      <EscalationTiersField
                        id="warranty-claims-escalation-tiers"
                        label={generalTranslations.fields.escalationTiers}
                        description={generalTranslations.fields.escalationTiersHelp}
                        rows={generalForm.escalationTiers}
                        rowErrors={generalFieldErrors.escalationTierRowErrors}
                        error={generalFieldErrors.escalationTiers}
                        disabled={generalSaving}
                        translations={generalTranslations.escalationTiers}
                        loadStaffOptions={loadEscalationStaffOptions}
                        resolveStaffLabel={resolveStaffUserLabel}
                        onAddRow={addEscalationTierRow}
                        onRemoveRow={removeEscalationTierRow}
                        onAtPctChange={updateEscalationTierAtPct}
                        onActionChange={updateEscalationTierAction}
                        onUserChange={updateEscalationTierUser}
                      />
                    </div>
                  </GeneralSettingsSubsection>

                  <GeneralSettingsSubsection title={generalTranslations.sections.adjudication}>
                    <GeneralSwitchField
                      id="warranty-claims-adjudication-use-rules"
                      label={generalTranslations.fields.adjudicationUseRules}
                      description={generalTranslations.fields.adjudicationUseRulesHelp}
                      checked={generalForm.adjudicationUseRules}
                      disabled={generalSaving}
                      onCheckedChange={(checked) => updateGeneralForm({ adjudicationUseRules: checked })}
                    />
                  </GeneralSettingsSubsection>

                  <div className="grid gap-4 md:grid-cols-2">
                    <GeneralSwitchField
                      id="warranty-claims-auto-approve-enabled"
                      label={generalTranslations.fields.autoApproveEnabled}
                      description={generalTranslations.fields.autoApproveEnabledHelp}
                      checked={generalForm.autoApproveEnabled}
                      disabled={generalSaving}
                      onCheckedChange={(checked) => updateGeneralForm({ autoApproveEnabled: checked })}
                    />
                    <GeneralSwitchField
                      id="warranty-claims-auto-approve-require-warranty"
                      label={generalTranslations.fields.autoApproveRequireInWarranty}
                      description={generalTranslations.fields.autoApproveRequireInWarrantyHelp}
                      checked={generalForm.autoApproveRequireInWarranty}
                      disabled={generalSaving || !generalForm.autoApproveEnabled}
                      onCheckedChange={(checked) => updateGeneralForm({ autoApproveRequireInWarranty: checked })}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <GeneralNumberField
                      id="warranty-claims-auto-approve-max-amount"
                      label={generalTranslations.fields.autoApproveMaxAmount}
                      description={generalTranslations.fields.autoApproveMaxAmountHelp}
                      value={generalForm.autoApproveMaxAmount}
                      min={0}
                      step="0.01"
                      disabled={generalSaving || !generalForm.autoApproveEnabled}
                      onChange={(value) => updateGeneralForm({ autoApproveMaxAmount: value })}
                    />
                    <GeneralTextField
                      id="warranty-claims-auto-approve-currency"
                      label={generalTranslations.fields.autoApproveCurrencyCode}
                      description={generalTranslations.fields.autoApproveCurrencyCodeHelp}
                      value={generalForm.autoApproveCurrencyCode}
                      maxLength={3}
                      disabled={generalSaving || !generalForm.autoApproveEnabled}
                      onChange={(value) => updateGeneralForm({ autoApproveCurrencyCode: normalizeCurrencyCodeInput(value) })}
                    />
                  </div>

                  <GeneralSettingsSubsection title={generalTranslations.sections.receiving}>
                    <GeneralQuarantineGradesField
                      id="warranty-claims-quarantine-grades"
                      label={generalTranslations.fields.quarantineGrades}
                      description={generalTranslations.fields.quarantineGradesHelp}
                      selected={generalForm.quarantineGrades}
                      disabled={generalSaving}
                      onToggle={(grade, checked) => updateGeneralForm({
                        quarantineGrades: checked
                          ? Array.from(new Set([...generalForm.quarantineGrades, grade]))
                          : generalForm.quarantineGrades.filter((item) => item !== grade),
                      })}
                    />
                  </GeneralSettingsSubsection>

                  <GeneralSettingsSubsection title={generalTranslations.sections.returns}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <GeneralTextField
                        id="warranty-claims-return-label-provider"
                        label={generalTranslations.fields.returnLabelProvider}
                        description={generalTranslations.fields.returnLabelProviderHelp}
                        value={generalForm.returnLabelProvider}
                        maxLength={120}
                        disabled={generalSaving}
                        onChange={(value) => updateGeneralForm({ returnLabelProvider: value })}
                      />
                    </div>
                  </GeneralSettingsSubsection>

                  <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={generalSaving}
                      onClick={() => { void loadGeneralSettings() }}
                    >
                      <RefreshCw className="size-4" aria-hidden="true" />
                      {generalTranslations.refresh}
                    </Button>
                    <Button type="submit" disabled={generalSaving}>
                      <Save className="size-4" aria-hidden="true" />
                      {generalSaving ? generalTranslations.saving : generalTranslations.save}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </section>

          {SECTIONS.map((section) => (
            <section key={section.kind} className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
              <div className="space-y-1 border-b border-border px-6 py-4">
                <h2 className="text-lg font-medium">{t(section.titleKey)}</h2>
                <p className="text-sm text-muted-foreground">{t(section.descriptionKey)}</p>
              </div>
              <div className="px-2 py-4 sm:px-4">
                <DictionaryTable
                  entries={entriesByKind[section.kind] ?? []}
                  loading={loadingKind[section.kind] ?? false}
                  canManage
                  onCreate={() => startCreate(section.kind)}
                  onEdit={(entry) => startEdit(section.kind, entry)}
                  onDelete={(entry) => { void deleteEntry(section.kind, entry) }}
                  onRefresh={() => { void loadEntries(section) }}
                  translations={{ ...tableTranslations, title: t(section.titleKey) }}
                />
              </div>
            </section>
          ))}
        </div>
      </PageBody>

      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit' ? formTranslations.editTitle : formTranslations.createTitle}
            </DialogTitle>
          </DialogHeader>
          <DictionaryForm
            mode={dialog?.mode === 'edit' ? 'edit' : 'create'}
            initialValues={currentValues}
            onSubmit={submitForm}
            onCancel={closeDialog}
            submitting={submitting}
            translations={{
              title: dialog?.mode === 'edit' ? formTranslations.editTitle : formTranslations.createTitle,
              valueLabel: formTranslations.valueLabel,
              labelLabel: formTranslations.labelLabel,
              saveLabel: formTranslations.saveLabel,
              cancelLabel: formTranslations.cancelLabel,
              appearance: formTranslations.appearance,
            }}
            iconSuggestions={ICON_SUGGESTIONS}
          />
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </Page>
  )
}
