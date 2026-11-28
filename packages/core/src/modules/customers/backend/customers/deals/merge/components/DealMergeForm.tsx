"use client"

import * as React from 'react'
import { ExternalLink, GitMerge, RefreshCw } from 'lucide-react'
import { useOptionalLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { decimalToString, isNegativeDecimal, parseDecimal } from '@open-mercato/shared/lib/decimal'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { formatDisplayDate, formatDisplayDateTime, toDateInputValue } from '@open-mercato/ui/primitives/date-format'
import { FormFooter, FormHeader } from '@open-mercato/ui/backend/forms'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { DealCustomFieldControl } from '../../../../../components/detail/create/dealCustomFieldControl'
import type { DealOwnerOption } from '../../../../../components/detail/DealOwnerSelect'
import { isWonDealStatus } from '../../../../../lib/dealStatus'
import { resolveDealMergeShortcut } from './dealMergeShortcuts'
import { useDealMergeLookups } from './useDealMergeLookups'
import {
  ClosureCustomEditor,
  PipelineCustomEditor,
  ScalarCustomEditor,
  isLostStatus,
  type ClosureCustomValue,
  type PipelineCustomValue,
} from './DealMergeValueEditors'

export type DealMergeChoice = 'left' | 'right' | 'custom'
export type DealMergeRelationChoice = 'left' | 'right' | 'union' | 'custom'

export type DealMergePerson = {
  id: string
  label: string
  subtitle: string | null
  isPrimary: boolean
}

export type DealMergeCompany = {
  id: string
  label: string
  subtitle: string | null
}

export type DealMergeRecord = {
  id: string
  updatedAt: string
  createdAt?: string | null
  fields: Record<string, unknown>
  customFields: Record<string, unknown>
  people: DealMergePerson[]
  companies: DealMergeCompany[]
  stageTransitions: Array<{
    stageId: string
    pipelineId: string
    stageLabel: string
    stageOrder: number
    transitionedAt: string
  }>
  counts: { activities: number; comments: number; interactions: number }
}

export type DealMergeParticipantPreview = {
  participantId: string
  label: string
  sourceCount: number
  survivorCount: number
  overlapCount: number
}

export type DealMergePreview = {
  left: DealMergeRecord
  right: DealMergeRecord
  participants?: DealMergeParticipantPreview[]
}

export type DealMergeDealMeta = {
  createdAt?: string | null
  owner?: DealOwnerOption | null
}

export type DealMergeRequest = {
  survivorId: string
  sourceId: string
  survivorUpdatedAt: string
  sourceUpdatedAt: string
  values: Record<string, unknown>
  customFields: Record<string, unknown>
  personIds: string[]
  companyIds: string[]
  primaryPersonEntityId: string | null
}

type Props = {
  preview: DealMergePreview
  customFieldDefinitions: CrudField[]
  dealMeta?: Record<string, DealMergeDealMeta>
  pending: boolean
  refreshing?: boolean
  shortcutsBlocked?: boolean
  submitError: string | null
  onRefresh: () => void
  onCancel: () => void
  onSubmit: (request: DealMergeRequest) => Promise<void>
}

type Side = 'left' | 'right'

const SCALAR_FIELDS = [
  'title',
  'description',
  'valueAmount',
  'valueCurrency',
  'probability',
  'expectedCloseAt',
  'ownerUserId',
  'source',
] as const

const PIPELINE_FIELDS = ['pipelineId', 'pipelineStageId', 'pipelineStage'] as const
const CLOSURE_FIELDS = ['status', 'closureOutcome', 'lossReasonId', 'lossNotes'] as const
const PIPELINE_KEY = 'group:pipeline'
const CLOSURE_KEY = 'group:closure'
const CUSTOM_PREFIX = 'custom:'

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function groupValues(fields: Record<string, unknown>, keys: readonly string[]): unknown[] {
  return keys.map((key) => fields[key] ?? null)
}

function rowDiffers(key: string, preview: DealMergePreview): boolean {
  if (key === PIPELINE_KEY) {
    return !sameValue(groupValues(preview.left.fields, PIPELINE_FIELDS), groupValues(preview.right.fields, PIPELINE_FIELDS))
  }
  if (key === CLOSURE_KEY) {
    return !sameValue(groupValues(preview.left.fields, CLOSURE_FIELDS), groupValues(preview.right.fields, CLOSURE_FIELDS))
  }
  if (key.startsWith(CUSTOM_PREFIX)) {
    const field = key.slice(CUSTOM_PREFIX.length)
    return !sameValue(preview.left.customFields[field], preview.right.customFields[field])
  }
  return !sameValue(preview.left.fields[key], preview.right.fields[key])
}

function unionById<T extends { id: string }>(left: T[], right: T[]): T[] {
  const records = new Map<string, T>()
  for (const record of [...left, ...right]) if (!records.has(record.id)) records.set(record.id, record)
  return Array.from(records.values())
}

function idsForChoice<T extends { id: string }>(
  choice: DealMergeRelationChoice,
  left: T[],
  right: T[],
  customIds: Set<string>,
): string[] {
  if (choice === 'left') return left.map((record) => record.id)
  if (choice === 'right') return right.map((record) => record.id)
  if (choice === 'union') return unionById(left, right).map((record) => record.id)
  return Array.from(customIds)
}

function toggleId(current: Set<string>, id: string, checked: boolean): Set<string> {
  const next = new Set(current)
  if (checked) next.add(id)
  else next.delete(id)
  return next
}

function restrictIds(current: Set<string>, allowed: Set<string>): Set<string> {
  const next = new Set(Array.from(current).filter((id) => allowed.has(id)))
  return next.size === current.size ? current : next
}

function readPipelineValue(value: unknown): PipelineCustomValue {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { pipelineId: asText(record.pipelineId), pipelineStageId: asText(record.pipelineStageId) }
}

function readClosureValue(value: unknown): ClosureCustomValue {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { status: asText(record.status), lossReasonId: asText(record.lossReasonId), lossNotes: asText(record.lossNotes) }
}

function closureOutcomeFor(status: string): 'won' | 'lost' | null {
  const normalized = status.trim().toLowerCase()
  if (isWonDealStatus(normalized)) return 'won'
  if (isLostStatus(normalized)) return 'lost'
  return null
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function parseOptionalDecimal(value: string): string | null {
  const parsed = parseDecimal(value.trim())
  return parsed && !isNegativeDecimal(parsed) ? decimalToString(parsed) : null
}

function scalarCustomResult(field: string, raw: string): unknown {
  const trimmed = raw.trim()
  if (field === 'valueAmount') return parseOptionalDecimal(raw)
  if (field === 'probability') return parseOptionalNumber(raw)
  if (field === 'valueCurrency') return trimmed ? trimmed.toUpperCase() : null
  if (field === 'title') return trimmed
  if (field === 'description') return raw.length ? raw : null
  return trimmed ? trimmed : null
}

function seedScalarCustomValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (field === 'expectedCloseAt') return toDateInputValue(asText(value)) ?? ''
  return String(value)
}

function formatAmount(value: unknown, currency: unknown, locale: string | undefined): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const code = typeof currency === 'string' ? currency : null
  return formatCurrency(value, code, locale, null, { showAllDigits: true })
}

export function DealMergeForm({
  preview,
  customFieldDefinitions,
  dealMeta,
  pending,
  refreshing = false,
  shortcutsBlocked = false,
  submitError,
  onRefresh,
  onCancel,
  onSubmit,
}: Props) {
  const t = useT()
  const locale = useOptionalLocale()
  const lookups = useDealMergeLookups()
  const [survivorSide, setSurvivorSide] = React.useState<Side>('left')
  const [fieldChoices, setFieldChoices] = React.useState<Record<string, DealMergeChoice>>({})
  const [customValues, setCustomValues] = React.useState<Record<string, unknown>>({})
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [onlyDifferences, setOnlyDifferences] = React.useState(true)
  const [peopleChoice, setPeopleChoice] = React.useState<DealMergeRelationChoice>('union')
  const [companyChoice, setCompanyChoice] = React.useState<DealMergeRelationChoice>('union')
  const allPeople = React.useMemo(() => unionById(preview.left.people, preview.right.people), [preview])
  const allCompanies = React.useMemo(() => unionById(preview.left.companies, preview.right.companies), [preview])
  const [customPersonIds, setCustomPersonIds] = React.useState<Set<string>>(
    () => new Set(allPeople.map((person) => person.id)),
  )
  const [customCompanyIds, setCustomCompanyIds] = React.useState<Set<string>>(
    () => new Set(allCompanies.map((company) => company.id)),
  )
  const defaultPrimary = preview.left.people.find((person) => person.isPrimary)?.id
    ?? preview.right.people.find((person) => person.isPrimary)?.id
    ?? null
  const [primaryPersonId, setPrimaryPersonId] = React.useState<string | null>(defaultPrimary)
  const formRef = React.useRef<HTMLFormElement>(null)
  const previousPreview = React.useRef(preview)

  React.useEffect(() => {
    if (previousPreview.current === preview) return
    previousPreview.current = preview
    const keepKey = (key: string) => rowDiffers(key, preview)
    setFieldChoices((current) => Object.fromEntries(Object.entries(current).filter(([key]) => keepKey(key))))
    setCustomValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => keepKey(key))))
    setFieldErrors({})
    setCustomPersonIds((current) => restrictIds(current, new Set(allPeople.map((person) => person.id))))
    setCustomCompanyIds((current) => restrictIds(current, new Set(allCompanies.map((company) => company.id))))
  }, [allCompanies, allPeople, preview])

  const scalarFields = React.useMemo(
    () => SCALAR_FIELDS.filter((field) => field in preview.left.fields || field in preview.right.fields),
    [preview],
  )
  const customFieldKeys = React.useMemo(
    () => Array.from(new Set([
      ...Object.keys(preview.left.customFields),
      ...Object.keys(preview.right.customFields),
      ...customFieldDefinitions.map((field) => field.id),
    ])).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    [customFieldDefinitions, preview],
  )
  const customFieldByKey = React.useMemo(
    () => new Map(customFieldDefinitions.map((field) => [field.id, field])),
    [customFieldDefinitions],
  )
  const ownerOptions = React.useMemo(() => {
    const owners = new Map<string, DealOwnerOption>()
    for (const meta of Object.values(dealMeta ?? {})) if (meta.owner?.id) owners.set(meta.owner.id, meta.owner)
    return owners
  }, [dealMeta])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveDealMergeShortcut(event, shortcutsBlocked)
      if (shortcut === 'cancel') {
        onCancel()
        return
      }
      if (shortcut === 'submit') {
        event.preventDefault()
        formRef.current?.requestSubmit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, shortcutsBlocked])

  const survivorRecord = survivorSide === 'left' ? preview.left : preview.right
  const emptyLabel = t('customers.deals.merge.emptyValue', 'Empty')

  const setChoice = React.useCallback((key: string, choice: DealMergeChoice, seed?: () => unknown) => {
    setFieldChoices((current) => ({ ...current, [key]: choice }))
    if (choice === 'custom' && seed) {
      setCustomValues((current) => (key in current ? current : { ...current, [key]: seed() }))
    }
  }, [])

  const setCustomValue = React.useCallback((key: string, value: unknown) => {
    setCustomValues((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])

  const choiceFor = React.useCallback(
    (key: string): DealMergeChoice => fieldChoices[key] ?? survivorSide,
    [fieldChoices, survivorSide],
  )

  const ownerLabel = (value: unknown): string | null => {
    if (isEmptyValue(value)) return null
    const owner = ownerOptions.get(String(value))
    return owner?.name?.trim() || owner?.email?.trim() || t('customers.deals.merge.unknownUser', 'Unknown user')
  }

  const displayScalar = (field: string, record: DealMergeRecord): string => {
    const value = record.fields[field]
    if (isEmptyValue(value)) return emptyLabel
    if (field === 'valueAmount') return formatAmount(value, record.fields.valueCurrency, locale) ?? emptyLabel
    if (field === 'probability') return `${asText(value)}%`
    if (field === 'expectedCloseAt') return formatDisplayDate(asText(value), locale) ?? asText(value)
    if (field === 'ownerUserId') return ownerLabel(value) ?? emptyLabel
    if (field === 'source') return lookups.sourceLabel(asText(value)) ?? asText(value)
    return asText(value)
  }

  const displayPipeline = (fields: Record<string, unknown>): string => {
    const pipelineId = asText(fields.pipelineId)
    if (!pipelineId) return emptyLabel
    const pipeline = lookups.pipelineLabel(pipelineId) ?? t('customers.deals.merge.unknownPipeline', 'Unknown pipeline')
    const stage = asText(fields.pipelineStage)
    return stage ? `${pipeline} · ${lookups.stageLabel(stage) ?? stage}` : pipeline
  }

  const displayClosure = (fields: Record<string, unknown>): string => {
    const status = asText(fields.status)
    if (!status) return emptyLabel
    const parts = [lookups.statusLabel(status) ?? status]
    const lossReasonId = asText(fields.lossReasonId)
    if (lossReasonId) parts.push(lookups.lossReasonLabel(lossReasonId) ?? t('customers.deals.merge.unknownLossReason', 'Unknown loss reason'))
    const lossNotes = asText(fields.lossNotes)
    if (lossNotes) parts.push(lossNotes)
    return parts.join(' · ')
  }

  const displayCustomField = (value: unknown): string => {
    if (isEmptyValue(value)) return emptyLabel
    if (typeof value === 'boolean') {
      return value ? t('customers.deals.merge.boolean.true', 'Yes') : t('customers.deals.merge.boolean.false', 'No')
    }
    if (Array.isArray(value)) return value.map((entry) => asText(entry)).join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return asText(value)
  }

  const resolvedCurrency = (): string => {
    const choice = choiceFor('valueCurrency')
    if (choice === 'custom') return asText(customValues.valueCurrency).toUpperCase()
    const record = rowDiffers('valueCurrency', preview) ? (choice === 'left' ? preview.left : preview.right) : preview.left
    return asText(record.fields.valueCurrency)
  }

  const rows: MergeRowModel[] = []
  rows.push({
    key: PIPELINE_KEY,
    label: t('customers.deals.merge.group.pipeline', 'Pipeline and stage'),
    left: displayPipeline(preview.left.fields),
    right: displayPipeline(preview.right.fields),
    differs: rowDiffers(PIPELINE_KEY, preview),
    forceCustom: false,
    seed: () => ({
      pipelineId: asText(survivorRecord.fields.pipelineId),
      pipelineStageId: asText(survivorRecord.fields.pipelineStageId),
    }),
    renderCustom: () => (
      <PipelineCustomEditor
        value={readPipelineValue(customValues[PIPELINE_KEY])}
        lookups={lookups}
        error={fieldErrors[PIPELINE_KEY]}
        onChange={(value) => setCustomValue(PIPELINE_KEY, value)}
      />
    ),
  })
  rows.push({
    key: CLOSURE_KEY,
    label: t('customers.deals.merge.group.closure', 'Status and closure'),
    left: displayClosure(preview.left.fields),
    right: displayClosure(preview.right.fields),
    differs: rowDiffers(CLOSURE_KEY, preview),
    forceCustom: false,
    seed: () => ({
      status: asText(survivorRecord.fields.status),
      lossReasonId: asText(survivorRecord.fields.lossReasonId),
      lossNotes: asText(survivorRecord.fields.lossNotes),
    }),
    renderCustom: () => (
      <ClosureCustomEditor
        value={readClosureValue(customValues[CLOSURE_KEY])}
        lookups={lookups}
        error={fieldErrors[CLOSURE_KEY]}
        onChange={(value) => setCustomValue(CLOSURE_KEY, value)}
      />
    ),
  })
  for (const field of scalarFields) {
    const label = t(`customers.deals.merge.field.${field}`, field)
    rows.push({
      key: field,
      label,
      left: displayScalar(field, preview.left),
      right: displayScalar(field, preview.right),
      differs: rowDiffers(field, preview),
      forceCustom: false,
      seed: () => seedScalarCustomValue(field, survivorRecord.fields[field]),
      renderCustom: () => (
        <ScalarCustomEditor
          field={field}
          label={label}
          value={asText(customValues[field])}
          currency={resolvedCurrency()}
          ownerInitialOption={ownerOptions.get(asText(customValues[field])) ?? null}
          error={fieldErrors[field]}
          onChange={(value) => setCustomValue(field, value)}
        />
      ),
    })
  }
  for (const field of customFieldKeys) {
    const key = `${CUSTOM_PREFIX}${field}`
    const definition = customFieldByKey.get(field) ?? { id: field, label: field, type: 'text' as const }
    const leftValue = preview.left.customFields[field]
    const rightValue = preview.right.customFields[field]
    const differs = !sameValue(leftValue, rightValue)
    const forceCustom = Boolean(definition.required) && !differs && isEmptyValue(leftValue)
    rows.push({
      key,
      label: definition.label,
      left: displayCustomField(leftValue),
      right: displayCustomField(rightValue),
      differs,
      forceCustom,
      renderCustom: () => (
        <DealCustomFieldControl
          field={definition}
          value={customValues[key]}
          onChange={(value) => setCustomValue(key, value)}
          error={fieldErrors[key]}
        />
      ),
    })
  }

  const visibleRows = onlyDifferences ? rows.filter((row) => row.differs || row.forceCustom) : rows
  const hiddenCount = rows.length - visibleRows.length

  const selectedPersonIds = idsForChoice(peopleChoice, preview.left.people, preview.right.people, customPersonIds)
  const selectedCompanyIds = idsForChoice(companyChoice, preview.left.companies, preview.right.companies, customCompanyIds)
  const resolvedPrimary = primaryPersonId && selectedPersonIds.includes(primaryPersonId) ? primaryPersonId : null

  const resolveSide = (key: string, leftValue: unknown, rightValue: unknown): unknown => {
    if (!rowDiffers(key, preview)) return leftValue ?? null
    return choiceFor(key) === 'right' ? rightValue ?? null : leftValue ?? null
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const survivor = survivorSide === 'left' ? preview.left : preview.right
    const source = survivorSide === 'left' ? preview.right : preview.left
    const errors: Record<string, string> = {}
    const requiredMessage = t('ui.forms.errors.required', 'Required')
    const values: Record<string, unknown> = {}

    for (const field of scalarFields) {
      const differs = rowDiffers(field, preview)
      if (differs && choiceFor(field) === 'custom') {
        values[field] = scalarCustomResult(field, asText(customValues[field]))
        if (field === 'title' && !values[field]) errors[field] = requiredMessage
        if (field === 'valueAmount' && values[field] === null && asText(customValues[field]).trim()) {
          errors[field] = t('customers.deals.merge.errors.invalid_amount', 'Enter a valid amount of zero or more.')
        }
      } else {
        values[field] = resolveSide(field, preview.left.fields[field], preview.right.fields[field])
      }
    }

    if (rowDiffers(PIPELINE_KEY, preview) && choiceFor(PIPELINE_KEY) === 'custom') {
      const custom = readPipelineValue(customValues[PIPELINE_KEY])
      const stage = lookups.stagesPipelineId === custom.pipelineId
        ? lookups.stages.find((entry) => entry.id === custom.pipelineStageId)
        : undefined
      if (custom.pipelineId && !stage) {
        errors[PIPELINE_KEY] = t('customers.deals.merge.errors.pipeline_stage', 'Choose both a pipeline and a stage, or neither.')
      }
      values.pipelineId = custom.pipelineId || null
      values.pipelineStageId = stage?.id ?? null
      values.pipelineStage = stage?.label ?? null
    } else {
      const side = choiceFor(PIPELINE_KEY) === 'right' && rowDiffers(PIPELINE_KEY, preview) ? preview.right : preview.left
      for (const field of PIPELINE_FIELDS) values[field] = side.fields[field] ?? null
    }

    if (rowDiffers(CLOSURE_KEY, preview) && choiceFor(CLOSURE_KEY) === 'custom') {
      const custom = readClosureValue(customValues[CLOSURE_KEY])
      const lost = isLostStatus(custom.status)
      if (!custom.status.trim()) errors[CLOSURE_KEY] = requiredMessage
      values.status = custom.status
      values.closureOutcome = closureOutcomeFor(custom.status)
      values.lossReasonId = lost && custom.lossReasonId ? custom.lossReasonId : null
      values.lossNotes = lost && custom.lossNotes.trim() ? custom.lossNotes : null
    } else {
      const side = choiceFor(CLOSURE_KEY) === 'right' && rowDiffers(CLOSURE_KEY, preview) ? preview.right : preview.left
      for (const field of CLOSURE_FIELDS) values[field] = side.fields[field] ?? null
    }

    const customFields: Record<string, unknown> = {}
    for (const field of customFieldKeys) {
      const key = `${CUSTOM_PREFIX}${field}`
      const leftValue = preview.left.customFields[field]
      const rightValue = preview.right.customFields[field]
      const definition = customFieldByKey.get(field)
      const forceCustom = Boolean(definition?.required) && sameValue(leftValue, rightValue) && isEmptyValue(leftValue)
      const useCustom = forceCustom || (rowDiffers(key, preview) && choiceFor(key) === 'custom')
      customFields[field] = useCustom ? customValues[key] ?? null : resolveSide(key, leftValue, rightValue)
      if (definition?.required && isEmptyValue(customFields[field])) errors[key] = requiredMessage
    }

    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      setOnlyDifferences(false)
      return
    }
    await onSubmit({
      survivorId: survivor.id,
      sourceId: source.id,
      survivorUpdatedAt: survivor.updatedAt,
      sourceUpdatedAt: source.updatedAt,
      values,
      customFields,
      personIds: selectedPersonIds,
      companyIds: selectedCompanyIds,
      primaryPersonEntityId: resolvedPrimary,
    })
  }

  const leftMeta = dealMeta?.[preview.left.id]
  const rightMeta = dealMeta?.[preview.right.id]

  return (
    <form ref={formRef} id="customers-deals-merge" className="space-y-6" onSubmit={handleSubmit}>
      <FormHeader
        mode="edit"
        titleHeadingLevel={1}
        title={t('customers.deals.merge.title', 'Merge deals')}
        backHref="/backend/customers/deals"
        backLabel={t('customers.deals.merge.back', 'Back to deals')}
      />

      <section className="space-y-3" aria-labelledby="merge-survivor-heading">
        <div>
          <h2 id="merge-survivor-heading" className="text-base font-semibold">
            {t('customers.deals.merge.survivor.title', 'Choose the deal to keep')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('customers.deals.merge.survivor.description', 'The other deal will be removed after its data is transferred.')}
          </p>
        </div>
        <RadioGroup
          value={survivorSide}
          onValueChange={(value) => setSurvivorSide(value === 'right' ? 'right' : 'left')}
          aria-label={t('customers.deals.merge.survivor.title', 'Choose the deal to keep')}
          className="grid gap-3 sm:grid-cols-2"
        >
          {(['left', 'right'] as const).map((side) => {
            const record = side === 'left' ? preview.left : preview.right
            const meta = side === 'left' ? leftMeta : rightMeta
            const selected = survivorSide === side
            return (
              <div
                key={side}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3',
                  selected ? 'border-accent-indigo bg-accent-indigo/5' : 'border-border',
                )}
              >
                <Radio
                  value={side}
                  id={`merge-survivor-${side}`}
                  aria-label={asText(record.fields.title) || record.id}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <label htmlFor={`merge-survivor-${side}`} className="block cursor-pointer text-sm font-medium">
                    {asText(record.fields.title) || record.id}
                  </label>
                  <DealIdentity
                    record={record}
                    meta={meta}
                    ownerLabel={ownerLabel(record.fields.ownerUserId)}
                    sideLabel={side === 'left'
                      ? t('customers.deals.merge.columns.left', 'Left deal')
                      : t('customers.deals.merge.columns.right', 'Right deal')}
                  />
                </div>
              </div>
            )
          })}
        </RadioGroup>
      </section>

      <section className="space-y-3" aria-labelledby="merge-fields-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="merge-fields-heading" className="text-base font-semibold">
              {t('customers.deals.merge.fields.title', 'Resolve field values')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('customers.deals.merge.fields.description', 'Identical values are kept automatically. Choose the result for every difference.')}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={onlyDifferences}
              onCheckedChange={setOnlyDifferences}
              aria-label={t('customers.deals.merge.onlyDifferences', 'Show only differences')}
            />
            <span>{t('customers.deals.merge.onlyDifferences', 'Show only differences')}</span>
          </label>
        </div>
        <div className="hidden gap-3 px-3 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-12">
          <div className="sm:col-span-2">{t('customers.deals.merge.columns.field', 'Field')}</div>
          <div className="sm:col-span-3">
            <ColumnHeading record={preview.left} label={t('customers.deals.merge.columns.left', 'Left deal')} />
          </div>
          <div className="sm:col-span-3">
            <ColumnHeading record={preview.right} label={t('customers.deals.merge.columns.right', 'Right deal')} />
          </div>
          <div className="sm:col-span-4">{t('customers.deals.merge.columns.result', 'Result')}</div>
        </div>
        <div className="space-y-2">
          {visibleRows.map((row) => (
            <MergeRow
              key={row.key}
              row={row}
              choice={row.forceCustom ? 'custom' : choiceFor(row.key)}
              onChoice={(choice) => setChoice(row.key, choice, row.seed)}
            />
          ))}
          {visibleRows.length === 0 ? (
            <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
              {t('customers.deals.merge.noDifferences', 'Both deals have identical field values.')}
            </p>
          ) : null}
          {hiddenCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('customers.deals.merge.identicalHidden', '{count} identical fields are hidden and will be kept as they are.', { count: hiddenCount })}
            </p>
          ) : null}
        </div>
      </section>

      <RelationSection
        title={t('customers.deals.merge.people.title', 'People')}
        choice={peopleChoice}
        onChoice={setPeopleChoice}
        records={allPeople}
        customIds={customPersonIds}
        onToggle={(id, checked) => setCustomPersonIds((current) => toggleId(current, id, checked))}
        primaryPersonId={resolvedPrimary}
        onPrimaryPersonId={setPrimaryPersonId}
        selectedIds={new Set(selectedPersonIds)}
      />
      <RelationSection
        title={t('customers.deals.merge.companies.title', 'Companies')}
        choice={companyChoice}
        onChoice={setCompanyChoice}
        records={allCompanies}
        customIds={customCompanyIds}
        onToggle={(id, checked) => setCustomCompanyIds((current) => toggleId(current, id, checked))}
        selectedIds={new Set(selectedCompanyIds)}
      />

      <RelatedRecordsCard preview={preview} />

      {submitError ? (
        <ErrorMessage
          label={submitError}
          action={<Button type="button" variant="outline" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className="mr-2 size-4" />
            {t('customers.deals.merge.refresh', 'Refresh comparison')}
          </Button>}
        />
      ) : null}

      <FormFooter
        actions={{
          cancelHref: '/backend/customers/deals',
          cancelLabel: t('customers.deals.merge.cancel', 'Cancel'),
          submit: {
            formId: 'customers-deals-merge',
            pending: pending || refreshing,
            label: t('customers.deals.merge.submit', 'Merge deals'),
            pendingLabel: refreshing
              ? t('customers.deals.merge.refreshing', 'Refreshing comparison…')
              : t('customers.deals.merge.submitting', 'Merging deals…'),
            icon: GitMerge,
          },
        }}
      />
    </form>
  )
}

type MergeRowModel = {
  key: string
  label: string
  left: string
  right: string
  differs: boolean
  forceCustom: boolean
  seed?: () => unknown
  renderCustom: () => React.ReactNode
}

function MergeRow({
  row,
  choice,
  onChoice,
}: {
  row: MergeRowModel
  choice: DealMergeChoice
  onChoice: (choice: DealMergeChoice) => void
}) {
  const t = useT()
  const editable = row.differs || row.forceCustom
  const leftLabel = t('customers.deals.merge.columns.left', 'Left deal')
  const rightLabel = t('customers.deals.merge.columns.right', 'Right deal')
  return (
    <div
      data-merge-field={row.key}
      data-differs={row.differs ? 'true' : 'false'}
      data-choice={editable ? choice : 'identical'}
      className={cn(
        'grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-12',
        row.differs ? 'border-status-warning-border bg-status-warning-bg' : 'border-border',
      )}
    >
      <div className="space-y-1 sm:col-span-2">
        <div className="font-medium">{row.label}</div>
        {row.differs ? (
          <div className="text-xs font-medium text-status-warning-text">
            {t('customers.deals.merge.differs', 'Different')}
          </div>
        ) : null}
      </div>
      <div className="min-w-0 break-words sm:col-span-3">
        <div className="text-xs text-muted-foreground sm:hidden">{leftLabel}</div>
        <div data-merge-side="left">{row.left}</div>
      </div>
      <div className="min-w-0 break-words sm:col-span-3">
        <div className="text-xs text-muted-foreground sm:hidden">{rightLabel}</div>
        <div data-merge-side="right">{row.right}</div>
      </div>
      <div className="min-w-0 space-y-2 sm:col-span-4">
        {editable ? (
          <>
            <SegmentedControl
              size="sm"
              value={choice}
              onValueChange={(value) => onChoice(value === 'right' ? 'right' : value === 'custom' ? 'custom' : 'left')}
              aria-label={t('customers.deals.merge.chooseValueFor', 'Choose result value for {field}', { field: row.label })}
            >
              {!row.forceCustom ? <SegmentedControlItem value="left">{t('customers.deals.merge.choice.left', 'Left')}</SegmentedControlItem> : null}
              {!row.forceCustom ? <SegmentedControlItem value="right">{t('customers.deals.merge.choice.right', 'Right')}</SegmentedControlItem> : null}
              <SegmentedControlItem value="custom">{t('customers.deals.merge.choice.custom', 'New value')}</SegmentedControlItem>
            </SegmentedControl>
            {choice === 'custom' ? row.renderCustom() : (
              <div data-merge-result>{choice === 'right' ? row.right : row.left}</div>
            )}
          </>
        ) : (
          <div data-merge-result>{row.left}</div>
        )}
      </div>
    </div>
  )
}

function ColumnHeading({ record, label }: { record: DealMergeRecord; label: string }) {
  return (
    <div className="min-w-0">
      <div>{label}</div>
      <div className="truncate text-foreground">{asText(record.fields.title) || record.id}</div>
    </div>
  )
}

function DealIdentity({
  record,
  meta,
  ownerLabel,
  sideLabel,
}: {
  record: DealMergeRecord
  meta?: DealMergeDealMeta
  ownerLabel: string | null
  sideLabel: string
}) {
  const t = useT()
  const locale = useOptionalLocale()
  const createdAt = record.createdAt ?? meta?.createdAt ?? null
  const createdLabel = createdAt ? formatDisplayDateTime(createdAt, locale) : null
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <div>{sideLabel}</div>
      {createdLabel ? (
        <div>{t('customers.deals.merge.createdAt', 'Created {date}', { date: createdLabel })}</div>
      ) : null}
      <div>
        {t('customers.deals.merge.ownerLabel', 'Owner: {owner}', {
          owner: ownerLabel ?? t('customers.deals.merge.noOwner', 'Unassigned'),
        })}
      </div>
      <a
        href={`/backend/customers/deals/${encodeURIComponent(record.id)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
      >
        <ExternalLink className="size-3" aria-hidden />
        {t('customers.deals.merge.openDeal', 'Open deal in a new tab')}
      </a>
    </div>
  )
}

function RelatedRecordsCard({ preview }: { preview: DealMergePreview }) {
  const t = useT()
  const uniqueStages = new Set([
    ...preview.left.stageTransitions.map((transition) => transition.stageId),
    ...preview.right.stageTransitions.map((transition) => transition.stageId),
  ])
  const builtIn = [
    {
      id: 'activities',
      label: t('customers.deals.merge.history.activities', 'Activities'),
      left: preview.left.counts.activities,
      right: preview.right.counts.activities,
      total: preview.left.counts.activities + preview.right.counts.activities,
    },
    {
      id: 'comments',
      label: t('customers.deals.merge.history.comments', 'Comments'),
      left: preview.left.counts.comments,
      right: preview.right.counts.comments,
      total: preview.left.counts.comments + preview.right.counts.comments,
    },
    {
      id: 'interactions',
      label: t('customers.deals.merge.history.interactions', 'Interactions'),
      left: preview.left.counts.interactions,
      right: preview.right.counts.interactions,
      total: preview.left.counts.interactions + preview.right.counts.interactions,
    },
    {
      id: 'stages',
      label: t('customers.deals.merge.history.stages', 'Stage history'),
      left: preview.left.stageTransitions.length,
      right: preview.right.stageTransitions.length,
      total: uniqueStages.size,
    },
  ]
  const participants = (preview.participants ?? []).map((participant) => ({
    id: participant.participantId,
    label: t(participant.label, participant.label),
    left: participant.survivorCount,
    right: participant.sourceCount,
    total: participant.sourceCount + participant.survivorCount - participant.overlapCount,
  }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('customers.deals.merge.history.title', 'Related records')}</CardTitle>
        <CardDescription>
          {t('customers.deals.merge.history.description', 'Records linked to the removed deal are moved to the kept deal. Records already linked to both deals are kept once, and stage history entries for the same stage are combined.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {[...builtIn, ...participants].map((entry) => (
            <li key={entry.id} data-merge-related={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
              <span className="font-medium">{entry.label}</span>
              <span className="text-muted-foreground">
                {t('customers.deals.merge.history.counts', 'Left: {left} · Right: {right} · After merge: {total}', {
                  left: entry.left,
                  right: entry.right,
                  total: entry.total,
                })}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function RelationSection<T extends { id: string; label: string; subtitle: string | null }>({
  title,
  choice,
  onChoice,
  records,
  customIds,
  onToggle,
  primaryPersonId,
  onPrimaryPersonId,
  selectedIds,
}: {
  title: string
  choice: DealMergeRelationChoice
  onChoice: (choice: DealMergeRelationChoice) => void
  records: T[]
  customIds: Set<string>
  onToggle: (id: string, checked: boolean) => void
  primaryPersonId?: string | null
  onPrimaryPersonId?: (id: string | null) => void
  selectedIds: Set<string>
}) {
  const t = useT()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{t('customers.deals.merge.relations.description', 'Choose one side, combine unique records, or select a custom result.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SegmentedControl
          value={choice}
          onValueChange={(value) => onChoice(
            value === 'left' || value === 'right' || value === 'custom' ? value : 'union',
          )}
          aria-label={title}
        >
          <SegmentedControlItem value="left">{t('customers.deals.merge.choice.left', 'Left')}</SegmentedControlItem>
          <SegmentedControlItem value="right">{t('customers.deals.merge.choice.right', 'Right')}</SegmentedControlItem>
          <SegmentedControlItem value="union">{t('customers.deals.merge.choice.union', 'Combine')}</SegmentedControlItem>
          <SegmentedControlItem value="custom">{t('customers.deals.merge.choice.customSet', 'Custom')}</SegmentedControlItem>
        </SegmentedControl>
        {choice === 'custom' ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {records.map((record) => (
              <div key={record.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <label className="flex min-w-0 items-center gap-2 text-sm">
                  <Checkbox
                    checked={customIds.has(record.id)}
                    onCheckedChange={(checked) => onToggle(record.id, checked === true)}
                  />
                  <span className="truncate">{record.label}</span>
                </label>
              </div>
            ))}
          </div>
        ) : null}
        {onPrimaryPersonId && selectedIds.size > 0 ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t('customers.deals.merge.people.primaryLabel', 'Primary person')}
            </legend>
            <RadioGroup
              value={primaryPersonId ?? ''}
              onValueChange={(value) => onPrimaryPersonId(value || null)}
              aria-label={t('customers.deals.merge.people.primaryLabel', 'Primary person')}
            >
              {records.filter((record) => selectedIds.has(record.id)).map((record) => (
                <label key={record.id} className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
                  <Radio value={record.id} aria-label={record.label} />
                  <span className="min-w-0 truncate">{record.label}</span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
        ) : null}
      </CardContent>
    </Card>
  )
}
