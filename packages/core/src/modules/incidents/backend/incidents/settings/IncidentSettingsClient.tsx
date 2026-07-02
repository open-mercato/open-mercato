"use client"

import * as React from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EventSelect, useAvailableEvents, type EventDefinition } from '@open-mercato/ui/backend/inputs/EventSelect'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { readJsonSafe } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { resolveCatalogLabel } from '../../../lib/catalogLabels'
import { EscalationPathPreview } from '../components/EscalationPathPreview'
import { TeamSelect, useTeamLabels } from '../components/TeamSelect'
import { UserSelect } from '../components/UserSelect'
import { useUserLabels } from '../components/useUserLabels'

type EscalationTargetType = 'user' | 'team' | 'role'

type PagedResponse<TRecord> = {
  items?: TRecord[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

type CatalogApiRecord = {
  id?: string | null
  key?: string | null
  label?: string | null
  name?: string | null
  is_active?: boolean | null
  isActive?: boolean | null
  updated_at?: string | null
  updatedAt?: string | null
}

type CatalogOption = {
  id: string
  key: string
  label: string
  isActive: boolean
  updatedAt: string | null
}

type SlaTarget = {
  response_minutes: number
  resolution_minutes: number
  at_risk_pct: number
}

type SlaTargets = Record<string, SlaTarget>

type UpdateCadenceEntry = {
  updateMinutes: number
}

type UpdateCadence = Record<string, UpdateCadenceEntry>

type IncidentSettingsApiRecord = {
  id?: string | null
  numberFormat?: string | null
  number_format?: string | null
  ackTimeoutMinutes?: number | string | null
  ack_timeout_minutes?: number | string | null
  escalationTimeoutMinutes?: number | string | null
  escalation_timeout_minutes?: number | string | null
  defaultEscalationPolicyId?: string | null
  default_escalation_policy_id?: string | null
  slaTargets?: unknown
  sla_targets?: unknown
  updateCadence?: unknown
  update_cadence?: unknown
  updatedAt?: string | null
  updated_at?: string | null
}

type IncidentTriggerCondition = {
  path: string
  equals: string | number | boolean
}

type IncidentTriggerApiRecord = {
  id?: string | null
  eventId?: string | null
  event_id?: string | null
  isEnabled?: boolean | null
  is_enabled?: boolean | null
  severityKey?: string | null
  severity_key?: string | null
  typeKey?: string | null
  type_key?: string | null
  escalationPolicyId?: string | null
  escalation_policy_id?: string | null
  conditions?: unknown
  updatedAt?: string | null
  updated_at?: string | null
}

type IncidentTrigger = {
  id: string
  eventId: string
  isEnabled: boolean
  severityKey: string | null
  typeKey: string | null
  escalationPolicyId: string | null
  conditions: IncidentTriggerCondition[]
  updatedAt: string | null
}

type TriggerEditorState = {
  mode: 'create' | 'edit'
  id: string | null
  eventId: string
  isEnabled: boolean
  severityKey: string
  typeKey: string
  escalationPolicyId: string | null
  conditions: IncidentTriggerCondition[]
  updatedAt: string | null
}

type EscalationTarget = {
  type: EscalationTargetType
  id: string
}

type EscalationStep = {
  delayMinutes: number
  targets: EscalationTarget[]
  notifyStrategy: 'all'
}

type EscalationPolicyApiRecord = {
  id?: string | null
  key?: string | null
  name?: string | null
  steps?: unknown
  repeatCount?: number | string | null
  repeat_count?: number | string | null
  isDefault?: boolean | null
  is_default?: boolean | null
  isActive?: boolean | null
  is_active?: boolean | null
  updatedAt?: string | null
  updated_at?: string | null
}

type EscalationPolicy = {
  id: string
  key: string
  name: string
  steps: EscalationStep[]
  repeatCount: number
  isDefault: boolean
  isActive: boolean
  updatedAt: string | null
}

type IncidentTypeApiRecord = {
  id?: string | null
  key?: string | null
  label?: string | null
  defaultSeverityId?: string | null
  default_severity_id?: string | null
  defaultEscalationPolicyId?: string | null
  default_escalation_policy_id?: string | null
  defaultRoleIds?: string[] | null
  default_role_ids?: string[] | null
  requiredFieldsOnResolve?: string[] | null
  required_fields_on_resolve?: string[] | null
  isDefault?: boolean | null
  is_default?: boolean | null
  isActive?: boolean | null
  is_active?: boolean | null
  updatedAt?: string | null
  updated_at?: string | null
}

type IncidentType = {
  id: string
  key: string
  label: string
  defaultSeverityId: string | null
  defaultEscalationPolicyId: string | null
  defaultRoleIds: string[] | null
  requiredFieldsOnResolve: string[] | null
  isDefault: boolean
  isActive: boolean
  updatedAt: string | null
}

type SettingsFormState = {
  id: string | null
  numberFormat: string
  ackTimeoutMinutes: number
  escalationTimeoutMinutes: number
  defaultEscalationPolicyId: string | null
  slaTargets: SlaTargets
  updateCadence: UpdateCadence
  updatedAt: string | null
}

type PolicyEditorState = {
  mode: 'create' | 'edit'
  id: string | null
  key: string
  name: string
  repeatCount: number
  isDefault: boolean
  isActive: boolean
  steps: EscalationStep[]
  updatedAt: string | null
}

type MutationResponse = {
  id?: string | null
  ok?: boolean
  updatedAt?: string | null
}

type SettingsMutationContext = Record<string, unknown> & {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

const NONE_VALUE = '__none__'
const DEFAULT_NUMBER_FORMAT = 'INC-{yyyy}{mm}{dd}-{seq:4}'
const DEFAULT_SLA_RESPONSE_MINUTES = 15
const DEFAULT_SLA_RESOLUTION_MINUTES = 240
const DEFAULT_SLA_AT_RISK_PCT = 80

const emptyPagedResponse = <TRecord,>(): PagedResponse<TRecord> => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 100,
  totalPages: 0,
})

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numericValue(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0))
}

function catalogLabel(record: CatalogApiRecord): string {
  return stringValue(record.label) ?? stringValue(record.name) ?? stringValue(record.key) ?? stringValue(record.id) ?? ''
}

function normalizeCatalogOption(record: CatalogApiRecord): CatalogOption | null {
  const id = stringValue(record.id)
  if (!id) return null
  return {
    id,
    key: stringValue(record.key) ?? id,
    label: catalogLabel(record) || id,
    isActive: record.isActive ?? record.is_active ?? true,
    updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at),
  }
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = numericValue(value, fallback)
  return Math.max(1, Math.trunc(parsed))
}

function percentInteger(value: unknown, fallback: number): number {
  return Math.min(100, positiveInteger(value, fallback))
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function normalizeSlaTargets(value: unknown): SlaTargets {
  const record = readRecord(value)
  if (!record) return {}
  const normalized: SlaTargets = {}
  for (const [key, targetValue] of Object.entries(record)) {
    const targetRecord = readRecord(targetValue)
    if (!targetRecord) continue
    normalized[key] = {
      response_minutes: positiveInteger(targetRecord.response_minutes, DEFAULT_SLA_RESPONSE_MINUTES),
      resolution_minutes: positiveInteger(targetRecord.resolution_minutes, DEFAULT_SLA_RESOLUTION_MINUTES),
      at_risk_pct: percentInteger(targetRecord.at_risk_pct, DEFAULT_SLA_AT_RISK_PCT),
    }
  }
  return normalized
}

function normalizeUpdateCadence(value: unknown): UpdateCadence {
  const record = readRecord(value)
  if (!record) return {}
  const normalized: UpdateCadence = {}
  for (const [key, cadenceValue] of Object.entries(record)) {
    const cadenceRecord = readRecord(cadenceValue)
    if (!cadenceRecord) continue
    const parsed = Number(cadenceRecord.updateMinutes ?? cadenceRecord.update_minutes)
    if (Number.isFinite(parsed) && parsed > 0) {
      normalized[key] = { updateMinutes: Math.trunc(parsed) }
    }
  }
  return normalized
}

function normalizeCondition(value: unknown): IncidentTriggerCondition | null {
  const record = readRecord(value)
  if (!record) return null
  const path = stringValue(record.path)
  const equals = record.equals
  if (!path || !['string', 'number', 'boolean'].includes(typeof equals)) return null
  return { path, equals: equals as string | number | boolean }
}

function normalizeConditions(value: unknown): IncidentTriggerCondition[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeCondition)
    .filter((condition): condition is IncidentTriggerCondition => condition !== null)
}

function normalizeTrigger(record: IncidentTriggerApiRecord): IncidentTrigger | null {
  const id = stringValue(record.id)
  const eventId = stringValue(record.eventId) ?? stringValue(record.event_id)
  if (!id || !eventId) return null
  return {
    id,
    eventId,
    isEnabled: record.isEnabled ?? record.is_enabled ?? true,
    severityKey: stringValue(record.severityKey) ?? stringValue(record.severity_key),
    typeKey: stringValue(record.typeKey) ?? stringValue(record.type_key),
    escalationPolicyId: stringValue(record.escalationPolicyId) ?? stringValue(record.escalation_policy_id),
    conditions: normalizeConditions(record.conditions),
    updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at),
  }
}

function normalizeSettings(record: IncidentSettingsApiRecord | null): SettingsFormState {
  return {
    id: stringValue(record?.id),
    numberFormat: stringValue(record?.numberFormat) ?? stringValue(record?.number_format) ?? DEFAULT_NUMBER_FORMAT,
    ackTimeoutMinutes: nonNegativeInteger(numericValue(record?.ackTimeoutMinutes ?? record?.ack_timeout_minutes, 15)),
    escalationTimeoutMinutes: nonNegativeInteger(numericValue(record?.escalationTimeoutMinutes ?? record?.escalation_timeout_minutes, 30)),
    defaultEscalationPolicyId: stringValue(record?.defaultEscalationPolicyId) ?? stringValue(record?.default_escalation_policy_id),
    slaTargets: normalizeSlaTargets(record?.slaTargets ?? record?.sla_targets),
    updateCadence: normalizeUpdateCadence(record?.updateCadence ?? record?.update_cadence),
    updatedAt: stringValue(record?.updatedAt) ?? stringValue(record?.updated_at),
  }
}

function isEscalationTargetType(value: unknown): value is EscalationTargetType {
  return value === 'user' || value === 'team' || value === 'role'
}

function normalizeEscalationTarget(value: unknown): EscalationTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  if (!id || !isEscalationTargetType(record.type)) return null
  return { type: record.type, id }
}

function normalizeEscalationStep(value: unknown): EscalationStep | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const rawTargets = Array.isArray(record.targets) ? record.targets : []
  const targets = rawTargets
    .map(normalizeEscalationTarget)
    .filter((target): target is EscalationTarget => Boolean(target))
  return {
    delayMinutes: nonNegativeInteger(numericValue(record.delayMinutes ?? record.delay_minutes, 0)),
    targets,
    notifyStrategy: 'all',
  }
}

function normalizeEscalationSteps(value: unknown): EscalationStep[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeEscalationStep)
    .filter((step): step is EscalationStep => Boolean(step))
}

function normalizePolicy(record: EscalationPolicyApiRecord): EscalationPolicy | null {
  const id = stringValue(record.id)
  if (!id) return null
  return {
    id,
    key: stringValue(record.key) ?? id,
    name: stringValue(record.name) ?? stringValue(record.key) ?? id,
    steps: normalizeEscalationSteps(record.steps),
    repeatCount: nonNegativeInteger(numericValue(record.repeatCount ?? record.repeat_count, 0)),
    isDefault: record.isDefault ?? record.is_default ?? false,
    isActive: record.isActive ?? record.is_active ?? true,
    updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at),
  }
}

function normalizeIncidentType(record: IncidentTypeApiRecord): IncidentType | null {
  const id = stringValue(record.id)
  const key = stringValue(record.key)
  const label = stringValue(record.label)
  if (!id || !key || !label) return null
  const defaultRoleIds = record.defaultRoleIds ?? record.default_role_ids ?? null
  const requiredFieldsOnResolve = record.requiredFieldsOnResolve ?? record.required_fields_on_resolve ?? null
  return {
    id,
    key,
    label,
    defaultSeverityId: stringValue(record.defaultSeverityId) ?? stringValue(record.default_severity_id),
    defaultEscalationPolicyId: stringValue(record.defaultEscalationPolicyId) ?? stringValue(record.default_escalation_policy_id),
    defaultRoleIds: Array.isArray(defaultRoleIds) ? defaultRoleIds : null,
    requiredFieldsOnResolve: Array.isArray(requiredFieldsOnResolve) ? requiredFieldsOnResolve : null,
    isDefault: record.isDefault ?? record.is_default ?? false,
    isActive: record.isActive ?? record.is_active ?? true,
    updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at),
  }
}

function createStep(defaultDelayMinutes: number, roles: readonly CatalogOption[]): EscalationStep {
  return {
    delayMinutes: nonNegativeInteger(defaultDelayMinutes),
    targets: [{ type: 'role', id: roles[0]?.id ?? '' }],
    notifyStrategy: 'all',
  }
}

function createPolicyEditor(defaultDelayMinutes: number, roles: readonly CatalogOption[]): PolicyEditorState {
  return {
    mode: 'create',
    id: null,
    key: '',
    name: '',
    repeatCount: 0,
    isDefault: false,
    isActive: true,
    steps: [createStep(defaultDelayMinutes, roles)],
    updatedAt: null,
  }
}

function editPolicyEditor(
  policy: EscalationPolicy,
  defaultDelayMinutes: number,
  roles: readonly CatalogOption[],
): PolicyEditorState {
  return {
    mode: 'edit',
    id: policy.id,
    key: policy.key,
    name: policy.name,
    repeatCount: policy.repeatCount,
    isDefault: policy.isDefault,
    isActive: policy.isActive,
    steps: policy.steps.length > 0 ? policy.steps : [createStep(defaultDelayMinutes, roles)],
    updatedAt: policy.updatedAt,
  }
}

function createTriggerEditor(
  severities: readonly CatalogOption[],
  incidentTypes: readonly IncidentType[],
): TriggerEditorState {
  return {
    mode: 'create',
    id: null,
    eventId: '',
    isEnabled: true,
    severityKey: severities[0]?.key ?? '',
    typeKey: incidentTypes[0]?.key ?? '',
    escalationPolicyId: null,
    conditions: [],
    updatedAt: null,
  }
}

function editTriggerEditor(
  trigger: IncidentTrigger,
  severities: readonly CatalogOption[],
  incidentTypes: readonly IncidentType[],
): TriggerEditorState {
  return {
    mode: 'edit',
    id: trigger.id,
    eventId: trigger.eventId,
    isEnabled: trigger.isEnabled,
    severityKey: trigger.severityKey ?? severities[0]?.key ?? '',
    typeKey: trigger.typeKey ?? incidentTypes[0]?.key ?? '',
    escalationPolicyId: trigger.escalationPolicyId,
    conditions: trigger.conditions,
    updatedAt: trigger.updatedAt,
  }
}

function coerceConditionEquals(value: string): string | number | boolean {
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed.length > 0) {
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) return numeric
  }
  return trimmed
}

function conditionInputValue(value: string | number | boolean): string {
  return String(value)
}

function triggerIsValid(editor: TriggerEditorState | null): boolean {
  if (!editor) return false
  if (!editor.eventId.trim()) return false
  return editor.conditions.every((condition) => condition.path.trim().length > 0)
}

function triggerPayload(editor: TriggerEditorState): Record<string, unknown> {
  const conditions = editor.conditions
    .filter((condition) => condition.path.trim().length > 0)
    .map((condition) => ({
      path: condition.path.trim(),
      equals: condition.equals,
    }))
  return {
    ...(editor.id ? { id: editor.id } : {}),
    eventId: editor.eventId.trim(),
    isEnabled: editor.isEnabled,
    severityKey: editor.severityKey.trim() || null,
    typeKey: editor.typeKey.trim() || null,
    escalationPolicyId: editor.escalationPolicyId,
    conditions: conditions.length > 0 ? conditions : null,
  }
}

function policyIsValid(editor: PolicyEditorState | null): boolean {
  if (!editor) return false
  if (!editor.key.trim() || !editor.name.trim()) return false
  if (!Number.isInteger(editor.repeatCount) || editor.repeatCount < 0) return false
  if (editor.steps.length < 1) return false
  return editor.steps.every((step) => (
    Number.isInteger(step.delayMinutes) &&
    step.delayMinutes >= 0 &&
    step.targets.length >= 1 &&
    step.targets.every((target) => isEscalationTargetType(target.type) && target.id.trim().length > 0)
  ))
}

function policyPayload(editor: PolicyEditorState): Record<string, unknown> {
  return {
    ...(editor.id ? { id: editor.id } : {}),
    key: editor.key.trim(),
    name: editor.name.trim(),
    repeatCount: nonNegativeInteger(editor.repeatCount),
    isDefault: editor.isDefault,
    isActive: editor.isActive,
    steps: editor.steps.map((step) => ({
      delayMinutes: nonNegativeInteger(step.delayMinutes),
      targets: step.targets.map((target) => ({ type: target.type, id: target.id.trim() })),
      notifyStrategy: 'all',
    })),
  }
}

function typePolicyPayload(incidentType: IncidentType, policyId: string | null): Record<string, unknown> {
  return {
    id: incidentType.id,
    key: incidentType.key,
    label: incidentType.label,
    defaultSeverityId: incidentType.defaultSeverityId,
    defaultEscalationPolicyId: policyId,
    defaultRoleIds: incidentType.defaultRoleIds,
    requiredFieldsOnResolve: incidentType.requiredFieldsOnResolve,
    isDefault: incidentType.isDefault,
    isActive: incidentType.isActive,
  }
}

function settingsPayload(
  settings: SettingsFormState,
  activeSeverities: readonly CatalogOption[],
): Record<string, unknown> {
  const slaTargets: SlaTargets = {}
  const updateCadence: UpdateCadence = {}

  activeSeverities.forEach((severity) => {
    const target = settings.slaTargets[severity.key] ?? {
      response_minutes: DEFAULT_SLA_RESPONSE_MINUTES,
      resolution_minutes: DEFAULT_SLA_RESOLUTION_MINUTES,
      at_risk_pct: DEFAULT_SLA_AT_RISK_PCT,
    }
    slaTargets[severity.key] = {
      response_minutes: positiveInteger(target.response_minutes, DEFAULT_SLA_RESPONSE_MINUTES),
      resolution_minutes: positiveInteger(target.resolution_minutes, DEFAULT_SLA_RESOLUTION_MINUTES),
      at_risk_pct: percentInteger(target.at_risk_pct, DEFAULT_SLA_AT_RISK_PCT),
    }

    const cadence = settings.updateCadence[severity.key]
    if (cadence && Number.isInteger(cadence.updateMinutes) && cadence.updateMinutes > 0) {
      updateCadence[severity.key] = { updateMinutes: cadence.updateMinutes }
    }
  })

  return {
    ...(settings.id ? { id: settings.id } : {}),
    numberFormat: settings.numberFormat.trim(),
    ackTimeoutMinutes: nonNegativeInteger(settings.ackTimeoutMinutes),
    escalationTimeoutMinutes: nonNegativeInteger(settings.escalationTimeoutMinutes),
    defaultEscalationPolicyId: settings.defaultEscalationPolicyId,
    slaTargets,
    updateCadence: Object.keys(updateCadence).length > 0 ? updateCadence : null,
  }
}

function targetTypeLabel(translate: ReturnType<typeof useT>, targetType: EscalationTargetType): string {
  if (targetType === 'user') return translate('incidents.settings.policies.targets.user', 'User')
  if (targetType === 'role') return translate('incidents.settings.policies.targets.role', 'Incident role')
  return translate('incidents.settings.policies.targets.team', 'Team')
}

function policyName(policy: EscalationPolicy | null | undefined, fallback: string): string {
  return policy?.name || policy?.key || fallback
}

function optionLabel(option: CatalogOption): string {
  return option.label || option.key || option.id
}

function severityOptionLabel(translate: ReturnType<typeof useT>, option: CatalogOption): string {
  return resolveCatalogLabel(translate, 'severity', option.key, optionLabel(option))
}

function roleOptionLabel(translate: ReturnType<typeof useT>, option: CatalogOption): string {
  return resolveCatalogLabel(translate, 'role', option.key, optionLabel(option))
}

function incidentTypeLabel(translate: ReturnType<typeof useT>, incidentType: IncidentType): string {
  return resolveCatalogLabel(translate, 'type', incidentType.key, incidentType.label)
}

function targetLabel(
  target: EscalationTarget,
  rolesById: ReadonlyMap<string, CatalogOption>,
  translate: ReturnType<typeof useT>,
  userLabels: Record<string, string>,
  teamLabels: Record<string, string>,
): string {
  if (target.type === 'role') {
    const role = rolesById.get(target.id)
    return role ? roleOptionLabel(translate, role) : target.id
  }
  if (target.type === 'team') {
    return teamLabels[target.id] ?? target.id
  }
  return userLabels[target.id] ?? target.id
}

export default function IncidentSettingsPage() {
  const translate = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { events: availableEvents } = useAvailableEvents({ excludeTriggerExcluded: true })
  const [settings, setSettings] = React.useState<SettingsFormState | null>(null)
  const [policies, setPolicies] = React.useState<EscalationPolicy[]>([])
  const [incidentTypes, setIncidentTypes] = React.useState<IncidentType[]>([])
  const [triggers, setTriggers] = React.useState<IncidentTrigger[]>([])
  const [severities, setSeverities] = React.useState<CatalogOption[]>([])
  const [roles, setRoles] = React.useState<CatalogOption[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [settingsPending, setSettingsPending] = React.useState(false)
  const [triggerPending, setTriggerPending] = React.useState(false)
  const [policyPending, setPolicyPending] = React.useState(false)
  const [typePendingId, setTypePendingId] = React.useState<string | null>(null)
  const [triggerEditor, setTriggerEditor] = React.useState<TriggerEditorState | null>(null)
  const [policyEditor, setPolicyEditor] = React.useState<PolicyEditorState | null>(null)

  const contextId = 'incidents-settings'
  const { runMutation, retryLastMutation } = useGuardedMutation<SettingsMutationContext>({
    contextId,
    blockedMessage: translate('incidents.settings.errors.saveBlocked', 'Save blocked by validation'),
  })

  const mutationContext = React.useCallback((resourceKind: string, resourceId: string): SettingsMutationContext => ({
    formId: contextId,
    resourceKind,
    resourceId,
    retryLastMutation,
  }), [retryLastMutation])

  const loadCatalog = React.useCallback(async (path: string): Promise<CatalogOption[]> => {
    const fallback = emptyPagedResponse<CatalogApiRecord>()
    const response = await apiCall<PagedResponse<CatalogApiRecord>>(
      `${path}?page=1&pageSize=100&isActive=true`,
      undefined,
      { fallback, parse: (apiResponse) => readJsonSafe<PagedResponse<CatalogApiRecord>>(apiResponse, fallback) },
    )
    if (!response.ok || !response.result) return []
    return (response.result.items ?? [])
      .map(normalizeCatalogOption)
      .filter((option): option is CatalogOption => Boolean(option))
  }, [])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const settingsFallback = emptyPagedResponse<IncidentSettingsApiRecord>()
    const triggerFallback = emptyPagedResponse<IncidentTriggerApiRecord>()
    const policyFallback = emptyPagedResponse<EscalationPolicyApiRecord>()
    const typeFallback = emptyPagedResponse<IncidentTypeApiRecord>()

    try {
      const [
        severitiesResult,
        rolesResult,
        policiesResult,
        typesResult,
        triggersResult,
        settingsResult,
      ] = await Promise.all([
        loadCatalog('/api/incidents/severities'),
        loadCatalog('/api/incidents/roles'),
        apiCall<PagedResponse<EscalationPolicyApiRecord>>(
          '/api/incidents/escalation-policies?page=1&pageSize=100',
          undefined,
          { fallback: policyFallback, parse: (apiResponse) => readJsonSafe<PagedResponse<EscalationPolicyApiRecord>>(apiResponse, policyFallback) },
        ),
        apiCall<PagedResponse<IncidentTypeApiRecord>>(
          '/api/incidents/types?page=1&pageSize=100',
          undefined,
          { fallback: typeFallback, parse: (apiResponse) => readJsonSafe<PagedResponse<IncidentTypeApiRecord>>(apiResponse, typeFallback) },
        ),
        apiCall<PagedResponse<IncidentTriggerApiRecord>>(
          '/api/incidents/triggers?page=1&pageSize=100',
          undefined,
          { fallback: triggerFallback, parse: (apiResponse) => readJsonSafe<PagedResponse<IncidentTriggerApiRecord>>(apiResponse, triggerFallback) },
        ),
        apiCall<PagedResponse<IncidentSettingsApiRecord>>(
          '/api/incidents/settings?page=1&pageSize=1',
          undefined,
          { fallback: settingsFallback, parse: (apiResponse) => readJsonSafe<PagedResponse<IncidentSettingsApiRecord>>(apiResponse, settingsFallback) },
        ),
      ])

      if (!policiesResult.ok || !typesResult.ok || !triggersResult.ok || !settingsResult.ok) {
        throw new Error(translate('incidents.settings.errors.load', 'Could not load incident settings.'))
      }

      const normalizedPolicies = (policiesResult.result?.items ?? [])
        .map(normalizePolicy)
        .filter((policy): policy is EscalationPolicy => Boolean(policy))
      const normalizedTypes = (typesResult.result?.items ?? [])
        .map(normalizeIncidentType)
        .filter((incidentType): incidentType is IncidentType => Boolean(incidentType))
      const normalizedTriggers = (triggersResult.result?.items ?? [])
        .map(normalizeTrigger)
        .filter((trigger): trigger is IncidentTrigger => Boolean(trigger))

      setSeverities(severitiesResult)
      setRoles(rolesResult)
      setPolicies(normalizedPolicies)
      setIncidentTypes(normalizedTypes)
      setTriggers(normalizedTriggers)
      setSettings(normalizeSettings(settingsResult.result?.items?.[0] ?? null))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : translate('incidents.settings.errors.load', 'Could not load incident settings.'))
    } finally {
      setIsLoading(false)
    }
  }, [loadCatalog, translate])

  React.useEffect(() => {
    void loadData()
  }, [loadData])

  const rolesById = React.useMemo(() => {
    const map = new Map<string, CatalogOption>()
    roles.forEach((role) => map.set(role.id, role))
    return map
  }, [roles])
  const userTargetIds = React.useMemo(() => {
    const ids: string[] = []
    const collectTargets = (targets: readonly EscalationTarget[]) => {
      targets.forEach((target) => {
        if (target.type === 'user') ids.push(target.id)
      })
    }
    policies.forEach((policy) => policy.steps.forEach((step) => collectTargets(step.targets)))
    policyEditor?.steps.forEach((step) => collectTargets(step.targets))
    return ids
  }, [policies, policyEditor?.steps])
  const userLabels = useUserLabels(userTargetIds)
  const teamTargetIds = React.useMemo(() => {
    const ids: string[] = []
    const collectTargets = (targets: readonly EscalationTarget[]) => {
      targets.forEach((target) => {
        if (target.type === 'team') ids.push(target.id)
      })
    }
    policies.forEach((policy) => policy.steps.forEach((step) => collectTargets(step.targets)))
    policyEditor?.steps.forEach((step) => collectTargets(step.targets))
    return ids
  }, [policies, policyEditor?.steps])
  const teamLabels = useTeamLabels(teamTargetIds)

  const severityKeyOptions = React.useMemo(() => severities.filter((severity) => severity.key), [severities])
  const typeKeyOptions = React.useMemo(() => incidentTypes.filter((incidentType) => incidentType.key), [incidentTypes])
  const policySelectOptions = React.useMemo(() => policies.filter((policy) => policy.isActive), [policies])
  const eventsById = React.useMemo(() => {
    const map = new Map<string, EventDefinition>()
    availableEvents.forEach((event) => map.set(event.id, event))
    return map
  }, [availableEvents])
  const severitiesByKey = React.useMemo(() => {
    const map = new Map<string, CatalogOption>()
    severityKeyOptions.forEach((severity) => map.set(severity.key, severity))
    return map
  }, [severityKeyOptions])
  const incidentTypesByKey = React.useMemo(() => {
    const map = new Map<string, IncidentType>()
    typeKeyOptions.forEach((incidentType) => map.set(incidentType.key, incidentType))
    return map
  }, [typeKeyOptions])
  const policiesById = React.useMemo(() => {
    const map = new Map<string, EscalationPolicy>()
    policies.forEach((policy) => map.set(policy.id, policy))
    return map
  }, [policies])
  const roleLabels = React.useMemo(() => {
    const labels: Record<string, string> = {}
    roles.forEach((role) => {
      labels[role.id] = roleOptionLabel(translate, role)
    })
    return labels
  }, [roles, translate])

  const handleSettingsFieldChange = React.useCallback(<TValue extends keyof SettingsFormState>(
    field: TValue,
    value: SettingsFormState[TValue],
  ) => {
    setSettings((current) => current ? { ...current, [field]: value } : current)
  }, [])

  const updateSlaTarget = React.useCallback((
    severityKey: string,
    field: keyof SlaTarget,
    value: number,
  ) => {
    setSettings((current) => {
      if (!current) return current
      const existing = current.slaTargets[severityKey] ?? {
        response_minutes: DEFAULT_SLA_RESPONSE_MINUTES,
        resolution_minutes: DEFAULT_SLA_RESOLUTION_MINUTES,
        at_risk_pct: DEFAULT_SLA_AT_RISK_PCT,
      }
      return {
        ...current,
        slaTargets: {
          ...current.slaTargets,
          [severityKey]: {
            ...existing,
            [field]: field === 'at_risk_pct'
              ? percentInteger(value, DEFAULT_SLA_AT_RISK_PCT)
              : positiveInteger(value, field === 'response_minutes' ? DEFAULT_SLA_RESPONSE_MINUTES : DEFAULT_SLA_RESOLUTION_MINUTES),
          },
        },
      }
    })
  }, [])

  const updateCadence = React.useCallback((severityKey: string, value: string) => {
    setSettings((current) => {
      if (!current) return current
      const nextCadence = { ...current.updateCadence }
      const trimmed = value.trim()
      if (!trimmed) {
        delete nextCadence[severityKey]
      } else {
        nextCadence[severityKey] = { updateMinutes: positiveInteger(Number(trimmed), 1) }
      }
      return { ...current, updateCadence: nextCadence }
    })
  }, [])

  const handleSaveSettings = React.useCallback(async () => {
    if (!settings || settingsPending || !settings.numberFormat.trim()) return
    setSettingsPending(true)
    const payload = settingsPayload(settings, severityKeyOptions)
    try {
      const response = await runMutation({
        operation: async () => apiCallOrThrow<MutationResponse>(
          '/api/incidents/settings',
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(settings.updatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: translate('incidents.settings.errors.save', 'Could not save incident settings.') },
        ),
        context: mutationContext('incidents.incident_settings', settings.id ?? 'singleton'),
        mutationPayload: payload,
      })
      const updatedAt = response.result?.updatedAt ?? settings.updatedAt
      setSettings((current) => current ? { ...current, updatedAt } : current)
      flash(translate('incidents.settings.general.saved', 'Incident settings saved.'), 'success')
    } catch (saveError) {
      if (!surfaceRecordConflict(saveError, translate, { onRefresh: () => { void loadData() } })) {
        flash(translate('incidents.settings.errors.save', 'Could not save incident settings.'), 'error')
      }
    } finally {
      setSettingsPending(false)
    }
  }, [loadData, mutationContext, runMutation, settings, settingsPending, severityKeyOptions, translate])

  const openCreateTriggerDialog = React.useCallback(() => {
    setTriggerEditor(createTriggerEditor(severityKeyOptions, typeKeyOptions))
  }, [severityKeyOptions, typeKeyOptions])

  const openEditTriggerDialog = React.useCallback((trigger: IncidentTrigger) => {
    setTriggerEditor(editTriggerEditor(trigger, severityKeyOptions, typeKeyOptions))
  }, [severityKeyOptions, typeKeyOptions])

  const updateTriggerEditor = React.useCallback((changes: Partial<TriggerEditorState>) => {
    setTriggerEditor((current) => current ? { ...current, ...changes } : current)
  }, [])

  const updateTriggerCondition = React.useCallback((
    conditionIndex: number,
    changes: Partial<IncidentTriggerCondition>,
  ) => {
    setTriggerEditor((current) => {
      if (!current) return current
      return {
        ...current,
        conditions: current.conditions.map((condition, index) => (
          index === conditionIndex ? { ...condition, ...changes } : condition
        )),
      }
    })
  }, [])

  const addTriggerCondition = React.useCallback(() => {
    setTriggerEditor((current) => current ? {
      ...current,
      conditions: [...current.conditions, { path: '', equals: '' }],
    } : current)
  }, [])

  const removeTriggerCondition = React.useCallback((conditionIndex: number) => {
    setTriggerEditor((current) => current ? {
      ...current,
      conditions: current.conditions.filter((_, index) => index !== conditionIndex),
    } : current)
  }, [])

  const handleSaveTrigger = React.useCallback(async () => {
    if (!triggerEditor || triggerPending) return
    if (!triggerIsValid(triggerEditor)) {
      flash(translate('incidents.settings.triggers.validation', 'Choose an event and complete every condition path before saving.'), 'error')
      return
    }

    setTriggerPending(true)
    const payload = triggerPayload(triggerEditor)
    const isEdit = triggerEditor.mode === 'edit'
    try {
      await runMutation({
        operation: async () => apiCallOrThrow<MutationResponse>(
          '/api/incidents/triggers',
          {
            method: isEdit ? 'PUT' : 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(triggerEditor.updatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: translate('incidents.settings.triggers.errors.save', 'Could not save incident trigger.') },
        ),
        context: mutationContext('incidents.incident_trigger', triggerEditor.id ?? 'new'),
        mutationPayload: payload,
      })
      flash(translate('incidents.settings.triggers.saved', 'Incident trigger saved.'), 'success')
      setTriggerEditor(null)
      await loadData()
    } catch (saveError) {
      if (!surfaceRecordConflict(saveError, translate, { onRefresh: () => { void loadData() } })) {
        flash(translate('incidents.settings.triggers.errors.save', 'Could not save incident trigger.'), 'error')
      }
    } finally {
      setTriggerPending(false)
    }
  }, [loadData, mutationContext, runMutation, translate, triggerEditor, triggerPending])

  const handleDeleteTrigger = React.useCallback(async (trigger: IncidentTrigger) => {
    if (triggerPending) return
    const approved = await confirm({
      title: translate('incidents.settings.triggers.delete.title', 'Delete incident trigger'),
      description: translate('incidents.settings.triggers.delete.description', 'This stops automatic incident creation for this event.'),
      confirmText: translate('incidents.settings.triggers.delete.confirm', 'Delete trigger'),
      cancelText: translate('incidents.settings.common.cancel', 'Cancel'),
      variant: 'destructive',
    })
    if (!approved) return

    setTriggerPending(true)
    const payload = { id: trigger.id }
    try {
      await runMutation({
        operation: async () => apiCallOrThrow<MutationResponse>(
          '/api/incidents/triggers',
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(trigger.updatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: translate('incidents.settings.triggers.errors.delete', 'Could not delete incident trigger.') },
        ),
        context: mutationContext('incidents.incident_trigger', trigger.id),
        mutationPayload: payload,
      })
      flash(translate('incidents.settings.triggers.deleted', 'Incident trigger deleted.'), 'success')
      await loadData()
    } catch (deleteError) {
      if (!surfaceRecordConflict(deleteError, translate, { onRefresh: () => { void loadData() } })) {
        flash(translate('incidents.settings.triggers.errors.delete', 'Could not delete incident trigger.'), 'error')
      }
    } finally {
      setTriggerPending(false)
    }
  }, [confirm, loadData, mutationContext, runMutation, translate, triggerPending])

  const handleToggleTrigger = React.useCallback(async (trigger: IncidentTrigger, isEnabled: boolean) => {
    if (triggerPending) return
    setTriggerPending(true)
    const payload = triggerPayload({
      mode: 'edit',
      id: trigger.id,
      eventId: trigger.eventId,
      isEnabled,
      severityKey: trigger.severityKey ?? '',
      typeKey: trigger.typeKey ?? '',
      escalationPolicyId: trigger.escalationPolicyId,
      conditions: trigger.conditions,
      updatedAt: trigger.updatedAt,
    })
    try {
      const response = await runMutation({
        operation: async () => apiCallOrThrow<MutationResponse>(
          '/api/incidents/triggers',
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(trigger.updatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: translate('incidents.settings.triggers.errors.save', 'Could not save incident trigger.') },
        ),
        context: mutationContext('incidents.incident_trigger', trigger.id),
        mutationPayload: payload,
      })
      setTriggers((current) => current.map((item) => (
        item.id === trigger.id
          ? { ...item, isEnabled, updatedAt: response.result?.updatedAt ?? item.updatedAt }
          : item
      )))
    } catch (saveError) {
      if (!surfaceRecordConflict(saveError, translate, { onRefresh: () => { void loadData() } })) {
        flash(translate('incidents.settings.triggers.errors.save', 'Could not save incident trigger.'), 'error')
      }
    } finally {
      setTriggerPending(false)
    }
  }, [loadData, mutationContext, runMutation, translate, triggerPending])

  const openCreatePolicyDialog = React.useCallback(() => {
    setPolicyEditor(createPolicyEditor(settings?.escalationTimeoutMinutes ?? 0, roles))
  }, [roles, settings?.escalationTimeoutMinutes])

  const openEditPolicyDialog = React.useCallback((policy: EscalationPolicy) => {
    setPolicyEditor(editPolicyEditor(policy, settings?.escalationTimeoutMinutes ?? 0, roles))
  }, [roles, settings?.escalationTimeoutMinutes])

  const updatePolicyEditor = React.useCallback((changes: Partial<PolicyEditorState>) => {
    setPolicyEditor((current) => current ? { ...current, ...changes } : current)
  }, [])

  const updatePolicyStep = React.useCallback((stepIndex: number, changes: Partial<EscalationStep>) => {
    setPolicyEditor((current) => {
      if (!current) return current
      return {
        ...current,
        steps: current.steps.map((step, index) => index === stepIndex ? { ...step, ...changes } : step),
      }
    })
  }, [])

  const updatePolicyTarget = React.useCallback((
    stepIndex: number,
    targetIndex: number,
    changes: Partial<EscalationTarget>,
  ) => {
    setPolicyEditor((current) => {
      if (!current) return current
      return {
        ...current,
        steps: current.steps.map((step, index) => {
          if (index !== stepIndex) return step
          return {
            ...step,
            targets: step.targets.map((target, currentTargetIndex) => (
              currentTargetIndex === targetIndex ? { ...target, ...changes } : target
            )),
          }
        }),
      }
    })
  }, [])

  const addPolicyStep = React.useCallback(() => {
    setPolicyEditor((current) => {
      if (!current) return current
      return {
        ...current,
        steps: [...current.steps, createStep(settings?.escalationTimeoutMinutes ?? 0, roles)],
      }
    })
  }, [roles, settings?.escalationTimeoutMinutes])

  const removePolicyStep = React.useCallback((stepIndex: number) => {
    setPolicyEditor((current) => {
      if (!current || current.steps.length <= 1) return current
      return {
        ...current,
        steps: current.steps.filter((step, index) => index !== stepIndex),
      }
    })
  }, [])

  const movePolicyStep = React.useCallback((stepIndex: number, direction: -1 | 1) => {
    setPolicyEditor((current) => {
      if (!current) return current
      const targetIndex = stepIndex + direction
      if (targetIndex < 0 || targetIndex >= current.steps.length) return current
      const steps = [...current.steps]
      const currentStep = steps[stepIndex]
      const targetStep = steps[targetIndex]
      if (!currentStep || !targetStep) return current
      steps[stepIndex] = targetStep
      steps[targetIndex] = currentStep
      return { ...current, steps }
    })
  }, [])

  const addPolicyTarget = React.useCallback((stepIndex: number) => {
    setPolicyEditor((current) => {
      if (!current) return current
      return {
        ...current,
        steps: current.steps.map((step, index) => {
          if (index !== stepIndex) return step
          return {
            ...step,
            targets: [...step.targets, { type: 'role', id: roles[0]?.id ?? '' }],
          }
        }),
      }
    })
  }, [roles])

  const removePolicyTarget = React.useCallback((stepIndex: number, targetIndex: number) => {
    setPolicyEditor((current) => {
      if (!current) return current
      return {
        ...current,
        steps: current.steps.map((step, index) => {
          if (index !== stepIndex) return step
          return {
            ...step,
            targets: step.targets.filter((target, currentTargetIndex) => currentTargetIndex !== targetIndex),
          }
        }),
      }
    })
  }, [])

  const handleSavePolicy = React.useCallback(async () => {
    if (!policyEditor || policyPending) return
    if (!policyIsValid(policyEditor)) {
      flash(translate('incidents.settings.policies.validation', 'Each policy needs a key, name, at least one step, non-negative delays, and at least one target per step.'), 'error')
      return
    }

    setPolicyPending(true)
    const payload = policyPayload(policyEditor)
    const isEdit = policyEditor.mode === 'edit'
    try {
      await runMutation({
        operation: async () => apiCallOrThrow<MutationResponse>(
          '/api/incidents/escalation-policies',
          {
            method: isEdit ? 'PUT' : 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(policyEditor.updatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: translate('incidents.settings.errors.policySave', 'Could not save escalation policy.') },
        ),
        context: mutationContext('incidents.incident_escalation_policy', policyEditor.id ?? 'new'),
        mutationPayload: payload,
      })
      flash(translate('incidents.settings.policies.saved', 'Escalation policy saved.'), 'success')
      setPolicyEditor(null)
      await loadData()
    } catch (saveError) {
      if (!surfaceRecordConflict(saveError, translate, { onRefresh: () => { void loadData() } })) {
        flash(translate('incidents.settings.errors.policySave', 'Could not save escalation policy.'), 'error')
      }
    } finally {
      setPolicyPending(false)
    }
  }, [loadData, mutationContext, policyEditor, policyPending, runMutation, translate])

  const handleDeletePolicy = React.useCallback(async (policy: EscalationPolicy) => {
    if (policyPending) return
    const approved = await confirm({
      title: translate('incidents.settings.policies.delete.title', 'Delete escalation policy'),
      description: translate('incidents.settings.policies.delete.description', 'This removes the policy from future use. Existing incidents keep their stored policy id.'),
      confirmText: translate('incidents.settings.policies.delete.confirm', 'Delete policy'),
      cancelText: translate('incidents.settings.common.cancel', 'Cancel'),
      variant: 'destructive',
    })
    if (!approved) return

    setPolicyPending(true)
    const payload = { id: policy.id }
    try {
      await runMutation({
        operation: async () => apiCallOrThrow<MutationResponse>(
          '/api/incidents/escalation-policies',
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(policy.updatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: translate('incidents.settings.errors.policyDelete', 'Could not delete escalation policy.') },
        ),
        context: mutationContext('incidents.incident_escalation_policy', policy.id),
        mutationPayload: payload,
      })
      flash(translate('incidents.settings.policies.deleted', 'Escalation policy deleted.'), 'success')
      await loadData()
    } catch (deleteError) {
      if (!surfaceRecordConflict(deleteError, translate, { onRefresh: () => { void loadData() } })) {
        flash(translate('incidents.settings.errors.policyDelete', 'Could not delete escalation policy.'), 'error')
      }
    } finally {
      setPolicyPending(false)
    }
  }, [confirm, loadData, mutationContext, policyPending, runMutation, translate])

  const handleTypePolicyChange = React.useCallback(async (incidentType: IncidentType, value: string) => {
    if (typePendingId) return
    const policyId = value === NONE_VALUE ? null : value
    setTypePendingId(incidentType.id)
    const payload = typePolicyPayload(incidentType, policyId)
    try {
      const response = await runMutation({
        operation: async () => apiCallOrThrow<MutationResponse>(
          '/api/incidents/types',
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(incidentType.updatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: translate('incidents.settings.errors.typeSave', 'Could not save incident type default policy.') },
        ),
        context: mutationContext('incidents.incident_type', incidentType.id),
        mutationPayload: payload,
      })
      setIncidentTypes((currentTypes) => currentTypes.map((currentType) => (
        currentType.id === incidentType.id
          ? { ...currentType, defaultEscalationPolicyId: policyId, updatedAt: response.result?.updatedAt ?? currentType.updatedAt }
          : currentType
      )))
      flash(translate('incidents.settings.types.saved', 'Incident type default policy saved.'), 'success')
    } catch (saveError) {
      if (!surfaceRecordConflict(saveError, translate, { onRefresh: () => { void loadData() } })) {
        flash(translate('incidents.settings.errors.typeSave', 'Could not save incident type default policy.'), 'error')
      }
    } finally {
      setTypePendingId(null)
    }
  }, [loadData, mutationContext, runMutation, translate, typePendingId])

  const handlePolicyDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSavePolicy()
    }
    if (event.key === 'Escape' && !policyPending) {
      setPolicyEditor(null)
    }
  }, [handleSavePolicy, policyPending])

  const handleTriggerDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSaveTrigger()
    }
    if (event.key === 'Escape' && !triggerPending) {
      setTriggerEditor(null)
    }
  }, [handleSaveTrigger, triggerPending])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={translate('incidents.settings.loading', 'Loading incident settings...')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !settings) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? translate('incidents.settings.errors.load', 'Could not load incident settings.')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title={translate('incidents.settings.title', 'Incident settings')}
        description={translate('incidents.settings.description', 'Configure incident numbering, automated triggers, escalation policies, and per-type defaults.')}
      />
      <PageBody>
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <SectionHeader title={translate('incidents.settings.general.title', 'General settings')} />
                <p className="text-sm text-muted-foreground">
                  {translate('incidents.settings.general.description', 'Control default incident behavior and automatic incident creation.')}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="whitespace-nowrap"
                onClick={() => void handleSaveSettings()}
                disabled={settingsPending || !settings.numberFormat.trim()}
              >
                {settingsPending ? <Spinner size="sm" /> : <Save aria-hidden="true" />}
                {translate('incidents.settings.common.save', 'Save')}
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="incident-settings-number-format">
                  {translate('incidents.settings.general.fields.numberFormat', 'Number format')}
                </Label>
                <Input
                  id="incident-settings-number-format"
                  value={settings.numberFormat}
                  onChange={(event) => handleSettingsFieldChange('numberFormat', event.currentTarget.value)}
                  disabled={settingsPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="incident-settings-default-policy">
                  {translate('incidents.settings.general.fields.defaultEscalationPolicy', 'Default escalation policy')}
                </Label>
                <Select
                  value={settings.defaultEscalationPolicyId ?? NONE_VALUE}
                  onValueChange={(value) => handleSettingsFieldChange('defaultEscalationPolicyId', value === NONE_VALUE ? null : value)}
                  disabled={settingsPending}
                >
                  <SelectTrigger id="incident-settings-default-policy">
                    <SelectValue placeholder={translate('incidents.settings.common.none', 'None')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>
                      {translate('incidents.settings.common.none', 'None')}
                    </SelectItem>
                    {policySelectOptions.map((policy) => (
                      <SelectItem key={policy.id} value={policy.id}>
                        {policyName(policy, policy.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="incident-settings-ack-timeout">
                  {translate('incidents.settings.general.fields.ackTimeoutMinutes', 'Acknowledgement timeout minutes')}
                </Label>
                <Input
                  id="incident-settings-ack-timeout"
                  type="number"
                  min={0}
                  value={String(settings.ackTimeoutMinutes)}
                  onChange={(event) => handleSettingsFieldChange('ackTimeoutMinutes', nonNegativeInteger(Number(event.currentTarget.value)))}
                  disabled={settingsPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="incident-settings-escalation-timeout">
                  {translate('incidents.settings.general.fields.escalationTimeoutMinutes', 'Default step delay for new policy steps')}
                </Label>
                <Input
                  id="incident-settings-escalation-timeout"
                  type="number"
                  min={0}
                  value={String(settings.escalationTimeoutMinutes)}
                  onChange={(event) => handleSettingsFieldChange('escalationTimeoutMinutes', nonNegativeInteger(Number(event.currentTarget.value)))}
                  disabled={settingsPending}
                />
                <p className="text-xs text-muted-foreground">
                  {translate('incidents.settings.general.help.escalationTimeoutMinutes', 'This only pre-fills new policy steps; each saved step stores its own runtime delay.')}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <SectionHeader title={translate('incidents.settings.sla.title', 'SLA targets')} />
                <p className="text-sm text-muted-foreground">
                  {translate('incidents.settings.sla.description', 'Set response, resolution, and at-risk thresholds for each active severity.')}
                </p>
              </div>
              {severityKeyOptions.length > 0 ? (
                <div className="space-y-3">
                  {severityKeyOptions.map((severity) => {
                    const target = settings.slaTargets[severity.key] ?? {
                      response_minutes: DEFAULT_SLA_RESPONSE_MINUTES,
                      resolution_minutes: DEFAULT_SLA_RESOLUTION_MINUTES,
                      at_risk_pct: DEFAULT_SLA_AT_RISK_PCT,
                    }
                    const severityLabel = severityOptionLabel(translate, severity)
                    return (
                      <div key={severity.id} className="rounded-md border border-border bg-background p-3">
                        <div className="grid gap-3 lg:grid-cols-4 lg:items-end">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground" title={severityLabel}>{severityLabel}</p>
                            <p className="truncate text-xs text-muted-foreground" title={severity.key}>{severity.key}</p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`incident-sla-response-${severity.key}`}>
                              {translate('incidents.settings.sla.responseMinutes', 'Response minutes')}
                            </Label>
                            <Input
                              id={`incident-sla-response-${severity.key}`}
                              type="number"
                              min={1}
                              value={String(target.response_minutes)}
                              onChange={(event) => updateSlaTarget(severity.key, 'response_minutes', Number(event.currentTarget.value))}
                              disabled={settingsPending}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`incident-sla-resolution-${severity.key}`}>
                              {translate('incidents.settings.sla.resolutionMinutes', 'Resolution minutes')}
                            </Label>
                            <Input
                              id={`incident-sla-resolution-${severity.key}`}
                              type="number"
                              min={1}
                              value={String(target.resolution_minutes)}
                              onChange={(event) => updateSlaTarget(severity.key, 'resolution_minutes', Number(event.currentTarget.value))}
                              disabled={settingsPending}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`incident-sla-at-risk-${severity.key}`}>
                              {translate('incidents.settings.sla.atRiskPct', 'At-risk percent')}
                            </Label>
                            <Input
                              id={`incident-sla-at-risk-${severity.key}`}
                              type="number"
                              min={1}
                              max={100}
                              value={String(target.at_risk_pct)}
                              onChange={(event) => updateSlaTarget(severity.key, 'at_risk_pct', Number(event.currentTarget.value))}
                              disabled={settingsPending}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <EmptyState
                  variant="subtle"
                  title={translate('incidents.settings.sla.empty.title', 'No active severities')}
                  description={translate('incidents.settings.sla.empty.description', 'Create active severities before configuring SLA targets.')}
                />
              )}
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <SectionHeader title={translate('incidents.settings.cadence.title', 'Customer update cadence')} />
                <p className="text-sm text-muted-foreground">
                  {translate('incidents.settings.cadence.description', 'Optionally set how often customers should receive updates for each severity.')}
                </p>
              </div>
              {severityKeyOptions.length > 0 ? (
                <div className="space-y-3">
                  {severityKeyOptions.map((severity) => {
                    const severityLabel = severityOptionLabel(translate, severity)
                    const cadence = settings.updateCadence[severity.key]?.updateMinutes
                    return (
                      <div key={severity.id} className="rounded-md border border-border bg-background p-3">
                        <div className="grid gap-3 md:grid-cols-2 md:items-end">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground" title={severityLabel}>{severityLabel}</p>
                            <p className="truncate text-xs text-muted-foreground" title={severity.key}>{severity.key}</p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`incident-cadence-${severity.key}`}>
                              {translate('incidents.settings.cadence.updateMinutes', 'Update every minutes')}
                            </Label>
                            <Input
                              id={`incident-cadence-${severity.key}`}
                              type="number"
                              min={1}
                              value={cadence ? String(cadence) : ''}
                              onChange={(event) => updateCadence(severity.key, event.currentTarget.value)}
                              placeholder={translate('incidents.settings.cadence.offPlaceholder', 'Off')}
                              disabled={settingsPending}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <EmptyState
                  variant="subtle"
                  title={translate('incidents.settings.cadence.empty.title', 'No active severities')}
                  description={translate('incidents.settings.cadence.empty.description', 'Create active severities before configuring update cadence.')}
                />
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <SectionHeader title={translate('incidents.settings.triggers.title', 'Automatic incident triggers')} />
                <p className="text-sm text-muted-foreground">
                  {translate('incidents.settings.triggers.description', 'Create incidents from selected platform events and optional payload conditions.')}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="whitespace-nowrap"
                onClick={openCreateTriggerDialog}
                disabled={triggerPending}
              >
                <Plus aria-hidden="true" />
                {translate('incidents.settings.triggers.create', 'Add trigger')}
              </Button>
            </div>

            {triggers.length > 0 ? (
              <ul className="space-y-3">
                {triggers.map((trigger) => {
                  const event = eventsById.get(trigger.eventId)
                  const eventLabel = event?.label ?? trigger.eventId
                  const severity = trigger.severityKey ? severitiesByKey.get(trigger.severityKey) : null
                  const incidentType = trigger.typeKey ? incidentTypesByKey.get(trigger.typeKey) : null
                  const policy = trigger.escalationPolicyId ? policiesById.get(trigger.escalationPolicyId) : null
                  const severityLabel = severity
                    ? severityOptionLabel(translate, severity)
                    : trigger.severityKey ?? translate('incidents.settings.common.none', 'None')
                  const typeLabel = incidentType
                    ? incidentTypeLabel(translate, incidentType)
                    : trigger.typeKey ?? translate('incidents.settings.common.none', 'None')
                  const policyLabel = trigger.escalationPolicyId
                    ? policyName(policy, trigger.escalationPolicyId)
                    : translate('incidents.settings.common.none', 'None')
                  return (
                    <li key={trigger.id} className="rounded-md border border-border bg-background p-3">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-foreground" title={eventLabel}>{eventLabel}</p>
                            {!event ? (
                              <StatusBadge variant="warning" dot>
                                <AlertTriangle className="size-3" aria-hidden="true" />
                                {translate('incidents.settings.triggers.unknownEvent', 'Unknown event')}
                              </StatusBadge>
                            ) : null}
                          </div>
                          <p className="truncate text-xs text-muted-foreground" title={trigger.eventId}>{trigger.eventId}</p>
                          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-muted-foreground">{translate('incidents.settings.triggers.severityKey', 'Severity')}</p>
                              <p className="truncate text-sm text-foreground" title={severityLabel}>{severityLabel}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-muted-foreground">{translate('incidents.settings.triggers.typeKey', 'Type')}</p>
                              <p className="truncate text-sm text-foreground" title={typeLabel}>{typeLabel}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-muted-foreground">{translate('incidents.settings.triggers.policy', 'Policy')}</p>
                              <p className="truncate text-sm text-foreground" title={policyLabel}>{policyLabel}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-muted-foreground">{translate('incidents.settings.triggers.conditions', 'Conditions')}</p>
                              <p className="truncate text-sm text-foreground" title={String(trigger.conditions.length)}>
                                {trigger.conditions.length > 0
                                  ? translate('incidents.settings.triggers.conditionCount', '{count} conditions', { count: trigger.conditions.length })
                                  : translate('incidents.settings.triggers.noConditions', 'Always fires')}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                            <Switch
                              id={`incident-trigger-enabled-${trigger.id}`}
                              checked={trigger.isEnabled}
                              onCheckedChange={(checked) => void handleToggleTrigger(trigger, checked === true)}
                              disabled={triggerPending}
                            />
                            <Label htmlFor={`incident-trigger-enabled-${trigger.id}`}>
                              {translate('incidents.settings.triggers.enabled', 'Enabled')}
                            </Label>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="whitespace-nowrap"
                            onClick={() => openEditTriggerDialog(trigger)}
                            disabled={triggerPending}
                          >
                            <Pencil aria-hidden="true" />
                            {translate('incidents.settings.common.edit', 'Edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="whitespace-nowrap"
                            onClick={() => void handleDeleteTrigger(trigger)}
                            disabled={triggerPending}
                          >
                            <Trash2 aria-hidden="true" />
                            {translate('incidents.settings.common.delete', 'Delete')}
                          </Button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <EmptyState
                variant="subtle"
                title={translate('incidents.settings.triggers.empty.title', 'No automatic triggers')}
                description={translate('incidents.settings.triggers.empty.description', 'Add a trigger to create incidents from platform events.')}
              />
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <SectionHeader title={translate('incidents.settings.policies.title', 'Escalation policies')} />
                <p className="text-sm text-muted-foreground">
                  {translate('incidents.settings.policies.description', 'Create ordered escalation steps with explicit delays and targets.')}
                </p>
              </div>
              <Button type="button" size="sm" className="whitespace-nowrap" onClick={openCreatePolicyDialog} disabled={policyPending}>
                <Plus aria-hidden="true" />
                {translate('incidents.settings.policies.create', 'Create policy')}
              </Button>
            </div>

            {policies.length > 0 ? (
              <ul className="space-y-3">
                {policies.map((policy) => (
                  <li key={policy.id} className="rounded-md border border-border bg-background p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-foreground" title={policy.name}>{policy.name}</h3>
                          {policy.isDefault ? (
                            <StatusBadge variant="info" dot>
                              {translate('incidents.settings.policies.defaultBadge', 'Default')}
                            </StatusBadge>
                          ) : null}
                          <StatusBadge variant={policy.isActive ? 'success' : 'neutral'} dot>
                            {policy.isActive
                              ? translate('incidents.settings.policies.activeBadge', 'Active')
                              : translate('incidents.settings.policies.inactiveBadge', 'Inactive')}
                          </StatusBadge>
                        </div>
                        <p className="truncate text-xs text-muted-foreground" title={policy.key}>{policy.key}</p>
                        <div className="space-y-1">
                          {policy.steps.map((step, stepIndex) => (
                            <p key={`${policy.id}:step:${stepIndex}`} className="text-sm text-muted-foreground">
                              <span className="font-medium text-foreground">
                                {translate('incidents.settings.policies.stepLabel', 'Step {number}', { number: stepIndex + 1 })}
                              </span>
                              {' '}
                              {translate('incidents.settings.policies.stepSummary', '{delay} min -> {targets}', {
                                delay: step.delayMinutes,
                                targets: step.targets.map((target) => targetLabel(target, rolesById, translate, userLabels, teamLabels)).join(', '),
                              })}
                            </p>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {translate('incidents.settings.policies.repeatSummary', 'Repeats after final step: {count}', {
                            count: policy.repeatCount,
                          })}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => openEditPolicyDialog(policy)} disabled={policyPending}>
                          <Pencil aria-hidden="true" />
                          {translate('incidents.settings.common.edit', 'Edit')}
                        </Button>
                        <Button type="button" variant="destructive" size="sm" className="whitespace-nowrap" onClick={() => void handleDeletePolicy(policy)} disabled={policyPending}>
                          <Trash2 aria-hidden="true" />
                          {translate('incidents.settings.common.delete', 'Delete')}
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                variant="subtle"
                title={translate('incidents.settings.policies.empty.title', 'No escalation policies')}
                description={translate('incidents.settings.policies.empty.description', 'Create a policy before assigning defaults to settings or incident types.')}
              />
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="space-y-1">
              <SectionHeader title={translate('incidents.settings.types.title', 'Per-type default policy')} />
              <p className="text-sm text-muted-foreground">
                {translate('incidents.settings.types.description', 'Choose the escalation policy that new incidents of each type should use.')}
              </p>
            </div>

            {incidentTypes.length > 0 ? (
              <ul className="space-y-2">
                {incidentTypes.map((incidentType) => {
                  const label = incidentTypeLabel(translate, incidentType)
                  return (
                    <li key={incidentType.id} className="rounded-md border border-border bg-background p-3">
                      <div className="grid gap-3 md:grid-cols-2 md:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground" title={label}>{label}</p>
                          <p className="truncate text-xs text-muted-foreground" title={incidentType.key}>{incidentType.key}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={incidentType.defaultEscalationPolicyId ?? NONE_VALUE}
                            onValueChange={(value) => void handleTypePolicyChange(incidentType, value)}
                            disabled={typePendingId !== null}
                          >
                            <SelectTrigger aria-label={translate('incidents.settings.types.policySelectLabel', 'Default escalation policy for {type}', { type: label })}>
                              <SelectValue placeholder={translate('incidents.settings.common.none', 'None')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE_VALUE}>
                                {translate('incidents.settings.common.none', 'None')}
                              </SelectItem>
                              {policySelectOptions.map((policy) => (
                                <SelectItem key={policy.id} value={policy.id}>
                                  {policyName(policy, policy.id)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {typePendingId === incidentType.id ? <Spinner size="sm" /> : null}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <EmptyState
                variant="subtle"
                title={translate('incidents.settings.types.empty.title', 'No incident types')}
                description={translate('incidents.settings.types.empty.description', 'Incident types are seeded by the incidents module setup.')}
              />
            )}
          </section>
        </div>
      </PageBody>

      <Dialog open={triggerEditor !== null} onOpenChange={(open) => {
        if (!open && !triggerPending) setTriggerEditor(null)
      }}>
        <DialogContent className="sm:max-w-3xl" onKeyDown={handleTriggerDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>
              {triggerEditor?.mode === 'edit'
                ? translate('incidents.settings.triggers.dialog.editTitle', 'Edit incident trigger')
                : translate('incidents.settings.triggers.dialog.createTitle', 'Create incident trigger')}
            </DialogTitle>
            <DialogDescription>
              {translate('incidents.settings.triggers.dialog.description', 'Choose the source event and optional payload conditions that should open an incident.')}
            </DialogDescription>
          </DialogHeader>

          {triggerEditor ? (
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault()
                void handleSaveTrigger()
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label>{translate('incidents.settings.triggers.fields.eventId', 'Event')}</Label>
                  <EventSelect
                    value={triggerEditor.eventId}
                    onChange={(eventId) => updateTriggerEditor({ eventId })}
                    excludeModules={['incidents']}
                    excludeTriggerExcluded
                    placeholder={translate('incidents.settings.triggers.fields.eventPlaceholder', 'Select event')}
                    disabled={triggerPending}
                  />
                  {triggerEditor.eventId && !eventsById.has(triggerEditor.eventId) ? (
                    <p className="flex items-center gap-2 text-xs text-status-warning-text">
                      <AlertTriangle className="size-3" aria-hidden="true" />
                      {translate('incidents.settings.triggers.fields.unknownEventHelp', 'This event is not in the current event catalog, but the trigger can stay configured.')}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="incident-trigger-severity">
                    {translate('incidents.settings.triggers.severityKey', 'Severity')}
                  </Label>
                  <Select
                    value={triggerEditor.severityKey || undefined}
                    onValueChange={(value) => updateTriggerEditor({ severityKey: value })}
                    disabled={triggerPending || severityKeyOptions.length === 0}
                  >
                    <SelectTrigger id="incident-trigger-severity">
                      <SelectValue placeholder={translate('incidents.settings.triggers.selectSeverity', 'Select severity')} />
                    </SelectTrigger>
                    <SelectContent>
                      {severityKeyOptions.map((severity) => (
                        <SelectItem key={severity.id} value={severity.key}>
                          {severityOptionLabel(translate, severity)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="incident-trigger-type">
                    {translate('incidents.settings.triggers.typeKey', 'Type')}
                  </Label>
                  <Select
                    value={triggerEditor.typeKey || undefined}
                    onValueChange={(value) => updateTriggerEditor({ typeKey: value })}
                    disabled={triggerPending || typeKeyOptions.length === 0}
                  >
                    <SelectTrigger id="incident-trigger-type">
                      <SelectValue placeholder={translate('incidents.settings.triggers.selectType', 'Select type')} />
                    </SelectTrigger>
                    <SelectContent>
                      {typeKeyOptions.map((incidentType) => (
                        <SelectItem key={incidentType.id} value={incidentType.key}>
                          {incidentTypeLabel(translate, incidentType)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="incident-trigger-policy">
                    {translate('incidents.settings.triggers.policy', 'Policy')}
                  </Label>
                  <Select
                    value={triggerEditor.escalationPolicyId ?? NONE_VALUE}
                    onValueChange={(value) => updateTriggerEditor({ escalationPolicyId: value === NONE_VALUE ? null : value })}
                    disabled={triggerPending}
                  >
                    <SelectTrigger id="incident-trigger-policy">
                      <SelectValue placeholder={translate('incidents.settings.common.none', 'None')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>
                        {translate('incidents.settings.common.none', 'None')}
                      </SelectItem>
                      {policies.map((policy) => (
                        <SelectItem key={policy.id} value={policy.id}>
                          {policyName(policy, policy.id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2 md:self-end">
                  <Switch
                    id="incident-trigger-enabled"
                    checked={triggerEditor.isEnabled}
                    onCheckedChange={(checked) => updateTriggerEditor({ isEnabled: checked === true })}
                    disabled={triggerPending}
                  />
                  <Label htmlFor="incident-trigger-enabled">
                    {translate('incidents.settings.triggers.enabled', 'Enabled')}
                  </Label>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <SectionHeader title={translate('incidents.settings.triggers.conditions.title', 'Conditions')} />
                    <p className="text-sm text-muted-foreground">
                      {translate('incidents.settings.triggers.conditions.description', 'All conditions must match the event payload before a trigger fires.')}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="whitespace-nowrap"
                    onClick={addTriggerCondition}
                    disabled={triggerPending}
                  >
                    <Plus aria-hidden="true" />
                    {translate('incidents.settings.triggers.conditions.add', 'Add condition')}
                  </Button>
                </div>

                {triggerEditor.conditions.length > 0 ? (
                  <div className="space-y-2">
                    {triggerEditor.conditions.map((condition, conditionIndex) => (
                      <div key={`trigger-condition-${conditionIndex}`} className="grid gap-2 md:grid-cols-3 md:items-end">
                        <div className="space-y-2">
                          <Label htmlFor={`incident-trigger-condition-path-${conditionIndex}`}>
                            {translate('incidents.settings.triggers.conditions.path', 'Payload path')}
                          </Label>
                          <Input
                            id={`incident-trigger-condition-path-${conditionIndex}`}
                            value={condition.path}
                            onChange={(event) => updateTriggerCondition(conditionIndex, { path: event.currentTarget.value })}
                            placeholder={translate('incidents.settings.triggers.conditions.pathPlaceholder', 'payload.path')}
                            disabled={triggerPending}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`incident-trigger-condition-value-${conditionIndex}`}>
                            {translate('incidents.settings.triggers.conditions.value', 'Value')}
                          </Label>
                          <Input
                            id={`incident-trigger-condition-value-${conditionIndex}`}
                            value={conditionInputValue(condition.equals)}
                            onChange={(event) => updateTriggerCondition(conditionIndex, { equals: coerceConditionEquals(event.currentTarget.value) })}
                            placeholder={translate('incidents.settings.triggers.conditions.valuePlaceholder', 'true, false, 10, or text')}
                            disabled={triggerPending}
                          />
                        </div>
                        <IconButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={translate('incidents.settings.triggers.conditions.remove', 'Remove condition')}
                          onClick={() => removeTriggerCondition(conditionIndex)}
                          disabled={triggerPending}
                        >
                          <X aria-hidden="true" />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {translate('incidents.settings.triggers.conditions.empty', 'No conditions. This trigger fires for every matching event.')}
                  </p>
                )}
              </div>
            </form>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" className="whitespace-nowrap" onClick={() => setTriggerEditor(null)} disabled={triggerPending}>
              {translate('incidents.settings.common.cancel', 'Cancel')}
            </Button>
            <Button type="button" className="whitespace-nowrap" onClick={() => void handleSaveTrigger()} disabled={triggerPending || !triggerIsValid(triggerEditor)}>
              {triggerPending ? <Spinner size="sm" /> : <Save aria-hidden="true" />}
              {translate('incidents.settings.common.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={policyEditor !== null} onOpenChange={(open) => {
        if (!open && !policyPending) setPolicyEditor(null)
      }}>
        <DialogContent className="sm:max-w-3xl" onKeyDown={handlePolicyDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>
              {policyEditor?.mode === 'edit'
                ? translate('incidents.settings.policies.dialog.editTitle', 'Edit escalation policy')
                : translate('incidents.settings.policies.dialog.createTitle', 'Create escalation policy')}
            </DialogTitle>
            <DialogDescription>
              {translate('incidents.settings.policies.dialog.description', 'Steps run in order. Each step stores its own delay and notifies all targets.')}
            </DialogDescription>
          </DialogHeader>

          {policyEditor ? (
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault()
                void handleSavePolicy()
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="incident-policy-key">
                    {translate('incidents.settings.policies.fields.key', 'Policy key')}
                  </Label>
                  <Input
                    id="incident-policy-key"
                    value={policyEditor.key}
                    onChange={(event) => updatePolicyEditor({ key: event.currentTarget.value })}
                    disabled={policyPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="incident-policy-name">
                    {translate('incidents.settings.policies.fields.name', 'Policy name')}
                  </Label>
                  <Input
                    id="incident-policy-name"
                    value={policyEditor.name}
                    onChange={(event) => updatePolicyEditor({ name: event.currentTarget.value })}
                    disabled={policyPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="incident-policy-repeat-count">
                    {translate('incidents.settings.policies.fields.repeatCount', 'Repeat count')}
                  </Label>
                  <Input
                    id="incident-policy-repeat-count"
                    type="number"
                    min={0}
                    value={String(policyEditor.repeatCount)}
                    onChange={(event) => updatePolicyEditor({ repeatCount: nonNegativeInteger(Number(event.currentTarget.value)) })}
                    disabled={policyPending}
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="incident-policy-is-default"
                      checked={policyEditor.isDefault}
                      onCheckedChange={(checked) => updatePolicyEditor({ isDefault: checked === true })}
                      disabled={policyPending}
                    />
                    <Label htmlFor="incident-policy-is-default">
                      {translate('incidents.settings.policies.fields.isDefault', 'Default policy')}
                    </Label>
                  </div>
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="incident-policy-is-active"
                      checked={policyEditor.isActive}
                      onCheckedChange={(checked) => updatePolicyEditor({ isActive: checked === true })}
                      disabled={policyPending}
                    />
                    <Label htmlFor="incident-policy-is-active">
                      {translate('incidents.settings.policies.fields.isActive', 'Active')}
                    </Label>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <SectionHeader title={translate('incidents.settings.policies.steps.title', 'Policy steps')} />
                  <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={addPolicyStep} disabled={policyPending}>
                    <Plus aria-hidden="true" />
                    {translate('incidents.settings.policies.steps.add', 'Add step')}
                  </Button>
                </div>

                <div className="space-y-3">
                  {policyEditor.steps.map((step, stepIndex) => (
                    <div key={`editor-step-${stepIndex}`} className="rounded-md border border-border bg-background p-3 space-y-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h3 className="text-sm font-semibold text-foreground">
                          {translate('incidents.settings.policies.stepLabel', 'Step {number}', { number: stepIndex + 1 })}
                        </h3>
                        <div className="flex items-center gap-2">
                          <IconButton
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={translate('incidents.settings.policies.steps.moveUp', 'Move step up')}
                            onClick={() => movePolicyStep(stepIndex, -1)}
                            disabled={policyPending || stepIndex === 0}
                          >
                            <ChevronUp aria-hidden="true" />
                          </IconButton>
                          <IconButton
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={translate('incidents.settings.policies.steps.moveDown', 'Move step down')}
                            onClick={() => movePolicyStep(stepIndex, 1)}
                            disabled={policyPending || stepIndex === policyEditor.steps.length - 1}
                          >
                            <ChevronDown aria-hidden="true" />
                          </IconButton>
                          <IconButton
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={translate('incidents.settings.policies.steps.remove', 'Remove step')}
                            onClick={() => removePolicyStep(stepIndex)}
                            disabled={policyPending || policyEditor.steps.length <= 1}
                          >
                            <Trash2 aria-hidden="true" />
                          </IconButton>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`incident-policy-step-delay-${stepIndex}`}>
                          {translate('incidents.settings.policies.steps.delayMinutes', 'Delay minutes')}
                        </Label>
                        <Input
                          id={`incident-policy-step-delay-${stepIndex}`}
                          type="number"
                          min={0}
                          value={String(step.delayMinutes)}
                          onChange={(event) => updatePolicyStep(stepIndex, { delayMinutes: nonNegativeInteger(Number(event.currentTarget.value)) })}
                          disabled={policyPending}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <Label>{translate('incidents.settings.policies.steps.targets', 'Targets')}</Label>
                          <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => addPolicyTarget(stepIndex)} disabled={policyPending}>
                            <Plus aria-hidden="true" />
                            {translate('incidents.settings.policies.targets.add', 'Add target')}
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {step.targets.map((target, targetIndex) => (
                            <div key={`editor-target-${stepIndex}-${targetIndex}`} className="grid gap-2 md:grid-cols-3 md:items-end">
                              <div className="space-y-2">
                                <Label htmlFor={`incident-policy-target-type-${stepIndex}-${targetIndex}`}>
                                  {translate('incidents.settings.policies.targets.type', 'Target type')}
                                </Label>
                                <Select
                                  value={target.type}
                                  onValueChange={(value) => {
                                    if (value === 'user' || value === 'role' || value === 'team') {
                                      updatePolicyTarget(stepIndex, targetIndex, {
                                        type: value,
                                        id: value === 'role' ? roles[0]?.id ?? '' : '',
                                      })
                                    }
                                  }}
                                  disabled={policyPending}
                                >
                                  <SelectTrigger id={`incident-policy-target-type-${stepIndex}-${targetIndex}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="user">
                                      {targetTypeLabel(translate, 'user')}
                                    </SelectItem>
                                    <SelectItem value="role">
                                      {targetTypeLabel(translate, 'role')}
                                    </SelectItem>
                                    <SelectItem value="team">
                                      {targetTypeLabel(translate, 'team')}
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`incident-policy-target-id-${stepIndex}-${targetIndex}`}>
                                  {target.type === 'role'
                                    ? translate('incidents.settings.policies.targets.roleId', 'Incident role')
                                    : target.type === 'user'
                                      ? targetTypeLabel(translate, 'user')
                                      : translate('incidents.settings.policies.targets.id', 'Target id')}
                                </Label>
                                {target.type === 'role' ? (
                                  <Select
                                    value={target.id}
                                    onValueChange={(value) => updatePolicyTarget(stepIndex, targetIndex, { id: value })}
                                    disabled={policyPending || roles.length === 0}
                                  >
                                    <SelectTrigger id={`incident-policy-target-id-${stepIndex}-${targetIndex}`}>
                                      <SelectValue placeholder={translate('incidents.settings.policies.targets.selectRole', 'Select role')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {roles.map((role) => (
                                        <SelectItem key={role.id} value={role.id}>
                                          {roleOptionLabel(translate, role)}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : target.type === 'user' ? (
                                  <UserSelect
                                    id={`incident-policy-target-id-${stepIndex}-${targetIndex}`}
                                    value={target.id}
                                    onChange={(value) => updatePolicyTarget(stepIndex, targetIndex, { id: value ?? '' })}
                                    disabled={policyPending}
                                  />
                                ) : (
                                  <TeamSelect
                                    id={`incident-policy-target-id-${stepIndex}-${targetIndex}`}
                                    value={target.id}
                                    onChange={(value) => updatePolicyTarget(stepIndex, targetIndex, { id: value ?? '' })}
                                    placeholder={translate('incidents.settings.policies.targets.teamPlaceholder', 'Team UUID')}
                                    disabled={policyPending}
                                  />
                                )}
                              </div>
                              <IconButton
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={translate('incidents.settings.policies.targets.remove', 'Remove target')}
                                onClick={() => removePolicyTarget(stepIndex, targetIndex)}
                                disabled={policyPending}
                              >
                                <X aria-hidden="true" />
                              </IconButton>
                            </div>
                          ))}
                          {step.targets.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              {translate('incidents.settings.policies.targets.empty', 'Add at least one target before saving.')}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                <SectionHeader title={translate('incidents.escalation.preview.title', 'Escalation path preview')} />
                <EscalationPathPreview
                  steps={policyEditor.steps}
                  repeatCount={policyEditor.repeatCount}
                  userLabels={userLabels}
                  roleLabels={roleLabels}
                  teamLabels={teamLabels}
                />
              </div>
            </form>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" className="whitespace-nowrap" onClick={() => setPolicyEditor(null)} disabled={policyPending}>
              {translate('incidents.settings.common.cancel', 'Cancel')}
            </Button>
            <Button type="button" className="whitespace-nowrap" onClick={() => void handleSavePolicy()} disabled={policyPending || !policyIsValid(policyEditor)}>
              {policyPending ? <Spinner size="sm" /> : <Save aria-hidden="true" />}
              {translate('incidents.settings.common.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </Page>
  )
}
