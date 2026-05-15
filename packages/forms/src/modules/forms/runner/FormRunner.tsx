'use client'

import * as React from 'react'
import { Circle, Globe, Mail, Phone, Star, ThumbsUp, type LucideIcon } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { evaluateFormLogic, type LogicState, type JumpTarget } from '../services/form-logic-evaluator'
import { partitionPages } from '../services/form-version-compiler'
import {
  compileFieldValidationRules,
  validateFieldValue,
} from '../services/field-validation-service'
import {
  COUNTRY_OPTIONS,
  resolveCountryName,
} from '../schema/address-countries'
import { RankingField } from './RankingField'
import { MatrixField, type MatrixFieldColumn, type MatrixFieldRow } from './MatrixField'
import type { FieldNode } from '../backend/forms/[id]/studio/schema-helpers'

export type FormRunnerProps = {
  formId: string
  formVersionId: string
  schema: Record<string, unknown>
  uiSchema: Record<string, unknown>
  hidden: Record<string, unknown>
  locale: string
  /** Optional URL to POST submissions to (defaults to /api/forms/:id/run/submissions). */
  submitEndpoint?: string
}

export function FormRunner({
  formId,
  formVersionId,
  schema,
  hidden,
  locale,
  submitEndpoint,
}: FormRunnerProps) {
  const t = useT()
  const sections = React.useMemo(() => readSections(schema), [schema])
  const pages = React.useMemo(() => partitionPages(sections), [sections])
  const [answers, setAnswers] = React.useState<Record<string, unknown>>({})
  const [pageIndex, setPageIndex] = React.useState(0)
  const [endingKey, setEndingKey] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [submitted, setSubmitted] = React.useState(false)

  const state: LogicState = React.useMemo(
    () => evaluateFormLogic(schema, { answers, hidden, locale }),
    [schema, answers, hidden, locale],
  )

  const currentPage = pages[pageIndex]
  const isLastPage = pageIndex >= pages.length - 1
  const isFirstPage = pageIndex === 0

  const handleAnswerChange = React.useCallback((fieldKey: string, value: unknown) => {
    setAnswers((current) => ({ ...current, [fieldKey]: value }))
  }, [])

  const handleNext = React.useCallback(async () => {
    if (!currentPage) return
    const currentPageKey = currentPage.sectionKeys.find((key) => sections.find((s) => s.key === key && (s.kind === 'page' || s.kind === undefined))) ?? currentPage.sectionKeys[0]
    if (!currentPageKey) return
    const target: JumpTarget = state.nextTarget(currentPageKey)
    if (target.type === 'ending') {
      setEndingKey(target.endingKey)
      await submitToServer(target.endingKey)
      return
    }
    if (target.type === 'submit') {
      await submitToServer(null)
      return
    }
    if (target.type === 'page') {
      const idx = pages.findIndex((page) => page.sectionKeys.includes(target.pageKey))
      if (idx >= 0) {
        setPageIndex(idx)
        return
      }
    }
    if (isLastPage) {
      await submitToServer(null)
      return
    }
    setPageIndex((current) => Math.min(pages.length - 1, current + 1))
  }, [currentPage, isLastPage, pages, sections, state])

  const submitToServer = async (claimedEndingKey: string | null) => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const endpoint = submitEndpoint ?? `/api/forms/${encodeURIComponent(formId)}/run/submissions`
      await apiCall(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          formVersionId,
          answers,
          hidden,
          endingKey: claimedEndingKey,
          locale,
        }),
        headers: { 'content-type': 'application/json' },
      })
      setSubmitted(true)
      if (claimedEndingKey) {
        const endingSection = sections.find((entry) => entry.key === claimedEndingKey && entry.kind === 'ending')
        const redirectUrl = endingSection?.['x-om-redirect-url']
        if (typeof redirectUrl === 'string' && redirectUrl.length > 0 && typeof window !== 'undefined') {
          window.location.assign(redirectUrl)
        }
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('forms.runner.submit.error'))
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted && endingKey) {
    const endingSection = sections.find((entry) => entry.key === endingKey && entry.kind === 'ending')
    if (endingSection) {
      const title = state.resolveRecall(endingSection.title as Record<string, string>, locale)
      return (
        <article className="rounded-lg border border-border bg-card p-6 space-y-3">
          <Tag variant="success">{t('forms.runner.actions.submit')}</Tag>
          <h2 className="text-lg font-semibold text-foreground">{title || endingSection.key}</h2>
          {endingSection.fieldKeys.map((fieldKey) => {
            const node = (schema.properties as Record<string, Record<string, unknown>>)?.[fieldKey]
            if (!node) return null
            const label = state.resolveRecall(node['x-om-label'] as Record<string, string>, locale)
            const help = state.resolveRecall(node['x-om-help'] as Record<string, string>, locale)
            return (
              <div key={fieldKey} className="rounded-md border border-border bg-muted/30 p-3">
                {label ? <p className="text-sm font-medium text-foreground">{label}</p> : null}
                {help ? <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{help}</p> : null}
              </div>
            )
          })}
        </article>
      )
    }
  }

  if (submitted) {
    return (
      <article className="rounded-lg border border-border bg-card p-6 space-y-3">
        <Tag variant="success">{t('forms.runner.completion.title')}</Tag>
        <p className="text-sm text-muted-foreground">{t('forms.runner.completion.subtitle')}</p>
      </article>
    )
  }

  const visibleSections = currentPage
    ? currentPage.sectionKeys
        .map((key) => sections.find((entry) => entry.key === key))
        .filter((entry): entry is RunnerSection => Boolean(entry))
        .filter((entry) => state.visibleSectionKeys.has(entry.key) && entry.kind !== 'ending')
    : []

  return (
    <div className="space-y-4">
      {submitError ? <Alert variant="destructive">{submitError}</Alert> : null}
      {visibleSections.map((section) => {
        const title = state.resolveRecall(section.title as Record<string, string>, locale)
        return (
          <section key={section.key} className="rounded-lg border border-border bg-card p-4 space-y-2">
            {!section.hideTitle && title ? (
              <h2 className="text-base font-semibold text-foreground">{title}</h2>
            ) : null}
            <div className="space-y-3">
              {section.fieldKeys.map((fieldKey) => {
                if (!state.visibleFieldKeys.has(fieldKey)) return null
                return (
                  <FieldRunnerRow
                    key={fieldKey}
                    fieldKey={fieldKey}
                    node={(schema.properties as Record<string, Record<string, unknown>>)?.[fieldKey] ?? {}}
                    value={answers[fieldKey]}
                    onChange={(value) => handleAnswerChange(fieldKey, value)}
                    state={state}
                    locale={locale}
                    required={Array.isArray(schema.required) && (schema.required as string[]).includes(fieldKey)}
                    t={t}
                  />
                )
              })}
            </div>
          </section>
        )
      })}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={isFirstPage}
          onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
        >
          {t('forms.runner.actions.back')}
        </Button>
        <Button type="button" onClick={handleNext} disabled={submitting}>
          {isLastPage ? t('forms.runner.actions.submit') : t('forms.runner.actions.next')}
        </Button>
      </div>
    </div>
  )
}

type RunnerSection = {
  key: string
  kind?: 'page' | 'section' | 'ending'
  title?: Record<string, string>
  fieldKeys: string[]
  hideTitle?: boolean
  'x-om-redirect-url'?: string | null
}

function readSections(schema: Record<string, unknown>): RunnerSection[] {
  const raw = schema['x-om-sections']
  if (!Array.isArray(raw)) return []
  const result: RunnerSection[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.key !== 'string') continue
    result.push({
      key: candidate.key,
      kind: candidate.kind as RunnerSection['kind'],
      title: candidate.title as Record<string, string>,
      fieldKeys: Array.isArray(candidate.fieldKeys) ? (candidate.fieldKeys as string[]) : [],
      hideTitle: candidate.hideTitle === true,
      'x-om-redirect-url': typeof candidate['x-om-redirect-url'] === 'string' ? (candidate['x-om-redirect-url'] as string) : null,
    })
  }
  return result
}

type FieldRunnerRowProps = {
  fieldKey: string
  node: Record<string, unknown>
  value: unknown
  onChange: (value: unknown) => void
  state: LogicState
  locale: string
  required: boolean
  t: TranslateFn
}

function FieldRunnerRow({ fieldKey, node, value, onChange, state, locale, required, t }: FieldRunnerRowProps) {
  const omType = String(node['x-om-type'] ?? 'text')
  const label = state.resolveRecall(node['x-om-label'] as Record<string, string>, locale) || fieldKey
  const help = state.resolveRecall(node['x-om-help'] as Record<string, string>, locale)
  if (omType === 'info_block') {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3">
        {label ? <p className="text-sm font-medium text-foreground">{label}</p> : null}
        {help ? <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{help}</p> : null}
      </div>
    )
  }
  const stringValue = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
  const options = Array.isArray(node['x-om-options']) ? (node['x-om-options'] as Array<{ value: string; label?: Record<string, string> }>) : []
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-foreground" htmlFor={`runner-${fieldKey}`}>
        {label}
        {required ? <span className="ml-1 text-status-error-text" aria-hidden="true">*</span> : null}
      </label>
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
      {(() => {
        switch (omType) {
          case 'textarea':
            return <Textarea id={`runner-${fieldKey}`} rows={3} value={stringValue} onChange={(event) => onChange(event.target.value)} />
          case 'number':
            return (
              <Input
                id={`runner-${fieldKey}`}
                type="number"
                step="any"
                value={stringValue}
                onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
              />
            )
          case 'integer':
            return (
              <Input
                id={`runner-${fieldKey}`}
                type="number"
                step={1}
                value={stringValue}
                onChange={(event) => onChange(event.target.value === '' ? '' : Math.trunc(Number(event.target.value)))}
              />
            )
          case 'boolean':
            return (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={value === true} onCheckedChange={(next) => onChange(Boolean(next))} aria-label={label} />
                <span>{label}</span>
              </label>
            )
          case 'yes_no':
            return (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">No</span>
                <Switch checked={value === true} onCheckedChange={(next) => onChange(Boolean(next))} aria-label={label} />
                <span className="text-muted-foreground">Yes</span>
              </div>
            )
          case 'date':
            return <Input id={`runner-${fieldKey}`} type="date" value={stringValue} onChange={(event) => onChange(event.target.value)} />
          case 'datetime':
            return <Input id={`runner-${fieldKey}`} type="datetime-local" value={stringValue} onChange={(event) => onChange(event.target.value)} />
          case 'select_one':
            return (
              <Select value={typeof value === 'string' ? value : undefined} onValueChange={(next) => onChange(next)}>
                <SelectTrigger id={`runner-${fieldKey}`}>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label?.[locale] ?? option.label?.en ?? option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          case 'nps':
            return (
              <NpsRunnerInput
                node={node as FieldNode}
                value={value}
                onChange={(next) => onChange(next)}
                locale={locale}
              />
            )
          case 'opinion_scale':
            return (
              <OpinionScaleRunnerInput
                node={node as FieldNode}
                value={value}
                onChange={(next) => onChange(next)}
              />
            )
          case 'email':
            return (
              <FormatRunnerInput
                id={`runner-${fieldKey}`}
                format="email"
                inputType="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="off"
                Icon={Mail}
                label={label}
                value={stringValue}
                onChange={(next) => onChange(next)}
                node={node as FieldNode}
                t={t}
              />
            )
          case 'phone':
            return (
              <FormatRunnerInput
                id={`runner-${fieldKey}`}
                format="phone"
                inputType="tel"
                inputMode="tel"
                autoComplete="tel"
                Icon={Phone}
                label={label}
                value={stringValue}
                onChange={(next) => onChange(next)}
                node={node as FieldNode}
                t={t}
              />
            )
          case 'website':
            return (
              <FormatRunnerInput
                id={`runner-${fieldKey}`}
                format="website"
                inputType="url"
                inputMode="url"
                autoCapitalize="off"
                Icon={Globe}
                label={label}
                value={stringValue}
                onChange={(next) => onChange(next)}
                node={node as FieldNode}
                t={t}
              />
            )
          case 'address':
            return (
              <AddressRunnerInput
                idPrefix={`runner-${fieldKey}`}
                value={value}
                onChange={(next) => onChange(next)}
                t={t}
              />
            )
          case 'ranking': {
            const rankingOptions = options.map((option) => ({
              value: option.value,
              label: option.label?.[locale] ?? option.label?.en ?? option.value,
            }))
            const rankingValue = Array.isArray(value)
              ? (value as unknown[]).filter((entry): entry is string => typeof entry === 'string')
              : []
            return (
              <RankingField
                idPrefix={`runner-${fieldKey}`}
                options={rankingOptions}
                value={rankingValue}
                onChange={(next) => onChange(next)}
                canEdit={true}
                t={t}
              />
            )
          }
          case 'matrix': {
            const matrixRows = Array.isArray(node['x-om-matrix-rows'])
              ? (node['x-om-matrix-rows'] as MatrixFieldRow[])
              : []
            const matrixColumns = Array.isArray(node['x-om-matrix-columns'])
              ? (node['x-om-matrix-columns'] as MatrixFieldColumn[])
              : []
            return (
              <MatrixField
                idPrefix={`runner-${fieldKey}`}
                rows={matrixRows}
                columns={matrixColumns}
                value={value}
                onChange={(next) => onChange(next)}
                locale={locale}
                t={t}
              />
            )
          }
          default:
            return <Input id={`runner-${fieldKey}`} type="text" value={stringValue} onChange={(event) => onChange(event.target.value)} />
        }
      })()}
    </div>
  )
}

type FormatRunnerInputProps = {
  id: string
  format: 'email' | 'phone' | 'website'
  inputType: 'email' | 'tel' | 'url'
  inputMode: 'email' | 'tel' | 'url'
  autoComplete?: string
  autoCapitalize?: 'off' | 'none' | 'on'
  Icon: LucideIcon
  label: string
  value: string
  onChange: (value: string) => void
  node: FieldNode
  t: TranslateFn
}

function FormatRunnerInput({
  id,
  format,
  inputType,
  inputMode,
  autoComplete,
  autoCapitalize,
  Icon,
  label,
  value,
  onChange,
  node,
  t,
}: FormatRunnerInputProps) {
  const [error, setError] = React.useState<string | null>(null)
  const rules = React.useMemo(
    () => compileFieldValidationRules(node, format),
    [node, format],
  )
  const handleBlur = React.useCallback(() => {
    if (!value) {
      setError(null)
      return
    }
    const result = validateFieldValue(value, rules, 'en', undefined, node)
    if (result.valid) {
      setError(null)
      return
    }
    if (result.rule === 'format' || result.rule === 'pattern') {
      const localizedKey =
        format === 'email'
          ? 'forms.runner.validation.email.default'
          : format === 'phone'
            ? 'forms.runner.validation.phone.default'
            : 'forms.runner.validation.website.default'
      const localized = t(localizedKey)
      setError(localized && localized !== localizedKey ? localized : result.message)
      return
    }
    setError(result.message)
  }, [value, rules, format, node, t])
  return (
    <div className="space-y-1">
      <div className="relative">
        <Icon
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={id}
          type={inputType}
          inputMode={inputMode}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          className="pl-8"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setError(null)}
          onBlur={handleBlur}
        />
      </div>
      {error ? (
        <Alert variant="destructive" className="px-3 py-2 text-xs">
          {error}
        </Alert>
      ) : null}
    </div>
  )
}

type NpsRunnerInputProps = {
  node: FieldNode
  value: unknown
  onChange: (value: unknown) => void
  locale: string
}

function npsRunnerBandClass(entry: number): string {
  if (entry <= 6) {
    return 'bg-status-error-surface text-status-error-text border-status-error-border'
  }
  if (entry <= 8) {
    return 'bg-status-warning-surface text-status-warning-text border-status-warning-border'
  }
  return 'bg-status-success-surface text-status-success-text border-status-success-border'
}

function resolveNpsAnchorRunner(
  node: FieldNode,
  anchor: 'low' | 'high',
  locale: string,
): string {
  const raw = (node as Record<string, unknown>)['x-om-nps-anchors']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const target = (raw as Record<string, unknown>)[anchor]
  if (!target || typeof target !== 'object' || Array.isArray(target)) return ''
  const map = target as Record<string, unknown>
  const exact = map[locale]
  if (typeof exact === 'string' && exact.length > 0) return exact
  const en = map.en
  if (typeof en === 'string' && en.length > 0) return en
  for (const value of Object.values(map)) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

function NpsRunnerInput({ node, value, onChange, locale }: NpsRunnerInputProps) {
  const lowCaption = resolveNpsAnchorRunner(node, 'low', locale)
  const highCaption = resolveNpsAnchorRunner(node, 'high', locale)
  const currentValue = typeof value === 'number' && Number.isInteger(value) ? value : null
  const entries: number[] = []
  for (let i = 0; i <= 10; i += 1) entries.push(i)
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {entries.map((entry) => {
          const selected = currentValue === entry
          const ringClass = selected ? ' ring-2 ring-primary' : ''
          return (
            <button
              key={entry}
              type="button"
              onClick={() => onChange(entry)}
              aria-pressed={selected}
              className={
                'h-11 w-11 rounded-md border text-sm font-medium transition-colors '
                + npsRunnerBandClass(entry)
                + ringClass
              }
            >
              {entry}
            </button>
          )
        })}
      </div>
      {lowCaption || highCaption ? (
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>{lowCaption}</span>
          <span>{highCaption}</span>
        </div>
      ) : null}
    </div>
  )
}

type OpinionScaleRunnerInputProps = {
  node: FieldNode
  value: unknown
  onChange: (value: unknown) => void
}

function resolveOpinionIconRunner(node: FieldNode): 'star' | 'dot' | 'thumb' {
  const raw = (node as Record<string, unknown>)['x-om-opinion-icon']
  if (raw === 'star' || raw === 'thumb') return raw
  return 'dot'
}

function OpinionScaleRunnerInput({ node, value, onChange }: OpinionScaleRunnerInputProps) {
  const icon = resolveOpinionIconRunner(node)
  const minRaw = (node as Record<string, unknown>)['x-om-min']
  const maxRaw = (node as Record<string, unknown>)['x-om-max']
  const min = typeof minRaw === 'number' && Number.isInteger(minRaw) ? minRaw : 1
  const maxResolved = typeof maxRaw === 'number' && Number.isInteger(maxRaw) ? maxRaw : 5
  const max = maxResolved < min ? min : maxResolved
  const entries: number[] = []
  for (let i = min; i <= max; i += 1) entries.push(i)
  const currentValue = typeof value === 'number' && Number.isInteger(value) ? value : null
  const IconComponent = icon === 'star' ? Star : icon === 'thumb' ? ThumbsUp : Circle
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {entries.map((entry) => {
          const filled = icon === 'star'
            ? currentValue !== null && entry <= currentValue
            : currentValue === entry
          const iconClass = filled ? 'fill-current text-primary' : 'text-muted-foreground'
          return (
            <button
              key={entry}
              type="button"
              onClick={() => onChange(entry)}
              aria-pressed={filled}
              className={
                'inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-background transition-colors '
                + (filled ? 'border-primary' : 'hover:border-primary')
              }
            >
              <IconComponent aria-hidden="true" className={`size-7 ${iconClass}`} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

type AddressRunnerInputProps = {
  idPrefix: string
  value: unknown
  onChange: (value: unknown) => void
  t: TranslateFn
}

type AddressRunnerValue = {
  street1?: string
  street2?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
}

function readAddressSubField(value: unknown, key: keyof AddressRunnerValue): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const entry = (value as Record<string, unknown>)[key]
  return typeof entry === 'string' ? entry : ''
}

function AddressRunnerInput({ idPrefix, value, onChange, t }: AddressRunnerInputProps) {
  void resolveCountryName
  const street1 = readAddressSubField(value, 'street1')
  const street2 = readAddressSubField(value, 'street2')
  const city = readAddressSubField(value, 'city')
  const region = readAddressSubField(value, 'region')
  const postalCode = readAddressSubField(value, 'postalCode')
  const country = readAddressSubField(value, 'country')
  const labels = {
    street1: t('forms.studio.field.address.street1'),
    street2: t('forms.studio.field.address.street2'),
    city: t('forms.studio.field.address.city'),
    region: t('forms.studio.field.address.region'),
    postalCode: t('forms.studio.field.address.postalCode'),
    country: t('forms.studio.field.address.country'),
  }
  const update = (key: keyof AddressRunnerValue) => (next: string) => {
    const current: AddressRunnerValue =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as AddressRunnerValue) }
        : {}
    current[key] = next
    onChange(current)
  }
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label
          className="block text-xs font-medium text-muted-foreground"
          htmlFor={`${idPrefix}-street1`}
        >
          {labels.street1}
        </label>
        <Input
          id={`${idPrefix}-street1`}
          type="text"
          aria-label={labels.street1}
          value={street1}
          onChange={(event) => update('street1')(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label
          className="block text-xs font-medium text-muted-foreground"
          htmlFor={`${idPrefix}-street2`}
        >
          {labels.street2}
        </label>
        <Input
          id={`${idPrefix}-street2`}
          type="text"
          aria-label={labels.street2}
          value={street2}
          onChange={(event) => update('street2')(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="space-y-1">
          <label
            className="block text-xs font-medium text-muted-foreground"
            htmlFor={`${idPrefix}-city`}
          >
            {labels.city}
          </label>
          <Input
            id={`${idPrefix}-city`}
            type="text"
            aria-label={labels.city}
            value={city}
            onChange={(event) => update('city')(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label
            className="block text-xs font-medium text-muted-foreground"
            htmlFor={`${idPrefix}-region`}
          >
            {labels.region}
          </label>
          <Input
            id={`${idPrefix}-region`}
            type="text"
            aria-label={labels.region}
            value={region}
            onChange={(event) => update('region')(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label
            className="block text-xs font-medium text-muted-foreground"
            htmlFor={`${idPrefix}-postalCode`}
          >
            {labels.postalCode}
          </label>
          <Input
            id={`${idPrefix}-postalCode`}
            type="text"
            aria-label={labels.postalCode}
            value={postalCode}
            onChange={(event) => update('postalCode')(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <label
          className="block text-xs font-medium text-muted-foreground"
          htmlFor={`${idPrefix}-country`}
        >
          {labels.country}
        </label>
        <Select
          value={country.length > 0 ? country : undefined}
          onValueChange={(next) => update('country')(next)}
        >
          <SelectTrigger id={`${idPrefix}-country`} aria-label={labels.country}>
            <SelectValue placeholder={labels.country} />
          </SelectTrigger>
          <SelectContent>
            {COUNTRY_OPTIONS.map((option) => (
              <SelectItem key={option.code} value={option.code}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
