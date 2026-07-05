"use client"

import * as React from 'react'
import { RefreshCw, Save } from 'lucide-react'
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
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
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

type GeneralSettingsResult = {
  slaHours: number
  slaPauseOnInfoRequested: boolean
  slaAtRiskThresholdPct: number
  autoApproveEnabled: boolean
  autoApproveMaxAmount: number | null
  autoApproveCurrencyCode: string | null
  autoApproveRequireInWarranty: boolean
  defaultWarrantyMonths: number | null
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
  businessHours: string
  escalationTiers: string
  adjudicationUseRules: boolean
  quarantineGrades: string[]
  returnLabelProvider: string
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
  fields: {
    slaHours: string
    slaHoursHelp: string
    slaPauseOnInfoRequested: string
    slaPauseOnInfoRequestedHelp: string
    slaAtRiskThresholdPct: string
    slaAtRiskThresholdPctHelp: string
    defaultWarrantyMonths: string
    defaultWarrantyMonthsHelp: string
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
  escalationTiers?: string
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

function stringifyJsonValue(value: Record<string, unknown> | unknown[] | null): string {
  if (value === null) return ''
  const serialized = JSON.stringify(value, null, 2)
  return typeof serialized === 'string' ? serialized : ''
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

function parseNullableJsonObjectArray(value: string): JsonParseResult<Record<string, unknown>[]> {
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed) && parsed.every(isRecord)) return { ok: true, value: parsed }
  } catch {
    return { ok: false }
  }
  return { ok: false }
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
    businessHours: stringifyJsonValue(settings.businessHours),
    escalationTiers: stringifyJsonValue(settings.escalationTiers),
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

function GeneralJsonTextareaField({
  id,
  label,
  description,
  value,
  error,
  disabled,
  onChange,
}: {
  id: string
  label: string
  description: string
  value: string
  error?: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={6}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">{description}</p>
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
      escalationTiers: t('warranty_claims.settings.general.error.escalationTiersJson', 'Invalid escalation tiers JSON'),
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
      autoApproveEnabled: t('warranty_claims.settings.general.fields.autoApproveEnabled.label', 'Enable auto-approve'),
      autoApproveEnabledHelp: t('warranty_claims.settings.general.fields.autoApproveEnabled.help', 'Automatically approve eligible submitted claims when all configured limits match.'),
      autoApproveMaxAmount: t('warranty_claims.settings.general.fields.autoApproveMaxAmount.label', 'Auto-approve max amount'),
      autoApproveMaxAmountHelp: t('warranty_claims.settings.general.fields.autoApproveMaxAmount.help', 'Maximum claimed total allowed for auto-approval.'),
      autoApproveCurrencyCode: t('warranty_claims.settings.general.fields.autoApproveCurrencyCode.label', 'Auto-approve currency'),
      autoApproveCurrencyCodeHelp: t('warranty_claims.settings.general.fields.autoApproveCurrencyCode.help', 'Three-letter uppercase currency code used by the auto-approval limit.'),
      autoApproveRequireInWarranty: t('warranty_claims.settings.general.fields.autoApproveRequireInWarranty.label', 'Require in-warranty lines'),
      autoApproveRequireInWarrantyHelp: t('warranty_claims.settings.general.fields.autoApproveRequireInWarranty.help', 'Only auto-approve when every line is still in warranty.'),
      businessHours: t('warranty_claims.settings.general.fields.businessHours.label', 'Business hours JSON'),
      businessHoursHelp: t('warranty_claims.settings.general.fields.businessHours.help', 'Shape: { timezone, week: { mon:[{start,end}], ... }, holidays:[...] }. Leave empty to disable.'),
      escalationTiers: t('warranty_claims.settings.general.fields.escalationTiers.label', 'Escalation tiers JSON'),
      escalationTiersHelp: t('warranty_claims.settings.general.fields.escalationTiers.help', "Shape: [{ atPct, action:'notify'|'reassign', toUserId? }]. Leave empty to disable."),
      adjudicationUseRules: t('warranty_claims.settings.general.fields.adjudicationUseRules.label', 'Use business rules for adjudication'),
      adjudicationUseRulesHelp: t('warranty_claims.settings.general.fields.adjudicationUseRules.help', 'When on and the business_rules module is present, claim submission is evaluated by the rule engine; otherwise the built-in light rule is used.'),
      quarantineGrades: t('warranty_claims.settings.general.fields.quarantineGrades.label', 'Quarantine grades'),
      quarantineGradesHelp: t('warranty_claims.settings.general.fields.quarantineGrades.help', 'Grades that automatically hold a claim on receiving.'),
      returnLabelProvider: t('warranty_claims.settings.general.fields.returnLabelProvider.label', 'Return label provider'),
      returnLabelProviderHelp: t('warranty_claims.settings.general.fields.returnLabelProvider.help', 'Optional provider key for the return-label seam. Leave empty for manual entry only.'),
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
    const currencyCode = toStringOrNull(generalForm.autoApproveCurrencyCode)?.toUpperCase() ?? null
    const businessHoursResult = parseNullableJsonObject(generalForm.businessHours)
    const escalationTiersResult = parseNullableJsonObjectArray(generalForm.escalationTiers)
    const returnLabelProvider = toStringOrNull(generalForm.returnLabelProvider)
    const quarantineGrades = Array.from(new Set(
      generalForm.quarantineGrades
        .map((grade) => grade.trim())
        .filter((grade) => grade.length > 0),
    ))

    if (!businessHoursResult.ok || !escalationTiersResult.ok) {
      setGeneralFieldErrors({
        businessHours: businessHoursResult.ok ? undefined : generalTranslations.jsonErrors.businessHours,
        escalationTiers: escalationTiersResult.ok ? undefined : generalTranslations.jsonErrors.escalationTiers,
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
                    <div className="grid gap-4 md:grid-cols-2">
                      <GeneralJsonTextareaField
                        id="warranty-claims-business-hours"
                        label={generalTranslations.fields.businessHours}
                        description={generalTranslations.fields.businessHoursHelp}
                        value={generalForm.businessHours}
                        error={generalFieldErrors.businessHours}
                        disabled={generalSaving}
                        onChange={(value) => {
                          updateGeneralForm({ businessHours: value })
                          if (generalFieldErrors.businessHours) {
                            setGeneralFieldErrors((prev) => ({ ...prev, businessHours: undefined }))
                          }
                        }}
                      />
                      <GeneralJsonTextareaField
                        id="warranty-claims-escalation-tiers"
                        label={generalTranslations.fields.escalationTiers}
                        description={generalTranslations.fields.escalationTiersHelp}
                        value={generalForm.escalationTiers}
                        error={generalFieldErrors.escalationTiers}
                        disabled={generalSaving}
                        onChange={(value) => {
                          updateGeneralForm({ escalationTiers: value })
                          if (generalFieldErrors.escalationTiers) {
                            setGeneralFieldErrors((prev) => ({ ...prev, escalationTiers: undefined }))
                          }
                        }}
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
